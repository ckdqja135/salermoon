// Read-only connectivity probe. No login cookies, API keys, or browser automation.
// A successful HTTP response alone does not prove that product search works.
import { parseShoppingState, productsFromPages, summarizeProducts, pagingRequest } from "./lib/shopping-state.mjs";

const deep = process.argv.includes("--deep");
const query = process.argv.slice(2).find((arg) => arg !== "--deep")?.trim() || "생수";
if (query.length > 100) throw new Error("검색어는 100자 이하여야 합니다.");

const sources = [
  ["shopping", "https://search.shopping.naver.com/search/all"],
  ["integrated-search", "https://search.naver.com/search.naver"],
];

async function readLimitedBody(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return html + decoder.decode();
      size += value.byteLength;
      if (size > 3_000_000) throw new Error("응답이 진단 크기 제한(3 MB)을 초과했습니다.");
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

for (const [source, endpoint] of sources) {
  const url = new URL(endpoint);
  url.searchParams.set("query", query);
  if (source === "integrated-search") url.searchParams.set("where", "shopping");
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    const html = await readLimitedBody(response);
    const loginRequired = new URL(response.url).hostname === "nid.naver.com";
    const blocked = response.status === 418 || response.status === 429 ||
      html.includes("쇼핑 서비스 접속이 일시적으로 제한되었습니다");
    // Count only the embedded shopping state, not duplicate markup elsewhere.
    // These are diagnostic markers, not a validated product parser.
    const marker = 'naver.search.ext.newshopping["shopping"]._INITIAL_STATE=';
    const start = html.indexOf(marker);
    const state = start < 0 ? "" : html.slice(start + marker.length).split("</script>", 1)[0];
    const cardTypes = [...state.matchAll(/"cardType"\s*:\s*"([A-Z_]+)"/g)]
      .reduce((counts, [, type]) => {
        counts[type] = (counts[type] || 0) + 1;
        return counts;
      }, {});
    console.log(JSON.stringify({
      source,
      query,
      status: response.status,
      finalHost: new URL(response.url).hostname,
      title: html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim(),
      loginRequired,
      blocked,
      hasNextData: /<script\b[^>]*\bid=["']__NEXT_DATA__["']/.test(html),
      shoppingCardTypes: cardTypes,
      conclusion: loginRequired || blocked || !response.ok
        ? "상품 수집 불가: 로그인 또는 접근 제한 응답"
        : "HTML 수신: 상품 수, 페이지 이동, 정렬 및 가격 정확도는 별도 검증 필요",
    }, null, 2));
    if (deep && source === "integrated-search" && response.ok && !blocked && !loginRequired) {
      const parsed = parseShoppingState(html);
      if (!parsed) {
        console.log(JSON.stringify({ source, extraction: "쇼핑 상태 없음" }));
        process.exitCode = 1;
        continue;
      }
      const first = productsFromPages(parsed.initProps.pagedSlot);
      console.log(JSON.stringify({ source, query, extraction: summarizeProducts(first) }, null, 2));
      const seenIds = new Set(first.map((p) => String(p.nvMid)));
      for (const requestedPage of [2, 4]) {
        const { url: nextUrl, headers } = pagingRequest(parsed, requestedPage);
        const next = await fetch(nextUrl, { headers, signal: AbortSignal.timeout(15_000) });
        const body = await readLimitedBody(next);
        if (!next.ok) {
          console.log(JSON.stringify({ source, query, requestedPage, status: next.status, pagination: "다음 페이지 요청 실패" }, null, 2));
          process.exitCode = 1;
          break;
        }
        const json = JSON.parse(body);
        const pages = json.data;
        const products = productsFromPages(pages);
        const newOrdinaryIds = new Set(products.filter((p) => p.sourceType === "SAS" && !seenIds.has(String(p.nvMid))).map((p) => String(p.nvMid)));
        for (const product of products) seenIds.add(String(product.nvMid));
        console.log(JSON.stringify({
          source, query, requestedPage, status: next.status,
          returnedPages: pages.map((p) => p.page),
          newOrdinaryProducts: newOrdinaryIds.size,
          extraction: summarizeProducts(products),
        }, null, 2));
      }
    }
    if (source === "shopping" && (loginRequired || blocked || !response.ok)) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ source, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
