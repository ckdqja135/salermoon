/**
 * 네이버 통합검색(where=shopping) 쇼핑 영역 데이터 해석 코어 (순수 함수)
 *
 * - HTML에 내장된 `naver.search.ext.newshopping["shopping"]._INITIAL_STATE`와
 *   ns-portal `shopping-paged-slot` 응답을 정적 데이터로만 해석한다.
 * - 원격 페이지의 JavaScript는 절대 실행하지 않는다 (eval/Function 금지, acorn AST만 사용).
 * - fetch/캐시는 상위 레이어(src/lib/shoppingSource.ts) 담당. 이 파일은 node --test로 직접 검증한다.
 *
 * 2026-09-13 관측 기준 (docs/crawling-feasibility.md):
 * - 카드 유형: ORGANIC_CARD(판매처·직접 링크 있음), CATALOG_CARD(가격비교 묶음,
 *   개별 판매처명·직접 구매 링크 없음), AD_CARD/SUPER_POINT_CARD(광고·프로모션).
 * - 일반 상품은 sourceType === "SAS". 광고는 sourceType으로 구분한다.
 * - page=N 요청 한 번에 1~N페이지가 누적 반환되므로 상품 ID로 중복을 제거한다.
 */
import { parseExpressionAt } from "acorn";

/** 페이지 이동 API가 반환할 수 있는 최대 페이지 (2026-09-13 실측: 11 이상은 빈 응답) */
export const SOURCE_MAX_PAGES = 10;

// ==================== 정적 AST 해석 ====================

function readValue(node, depth = 0) {
  if (!node || depth > 80) throw new Error("지원하지 않는 상품 상태 구조입니다.");
  const read = (value) => readValue(value, depth + 1);
  switch (node.type) {
    case "Literal":
      if (node.regex || node.bigint) throw new Error("지원하지 않는 리터럴입니다.");
      return node.value;
    case "Identifier":
      if (node.name === "undefined") return null;
      break;
    case "ArrayExpression":
      return node.elements.map(read);
    case "ObjectExpression":
      return Object.fromEntries(node.properties.map((property) => {
        if (property.type !== "Property" || property.computed || property.method || property.kind !== "init") {
          throw new Error("실행 가능한 속성은 해석하지 않습니다.");
        }
        return [property.key.name ?? property.key.value, read(property.value)];
      }));
    case "UnaryExpression":
      if (node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number") {
        return -node.argument.value;
      }
      break;
    case "NewExpression":
      if (node.callee.type === "Identifier" && node.callee.name === "Date" &&
          node.arguments.length === 1 && node.arguments[0].type === "Literal" &&
          typeof node.arguments[0].value === "string") {
        return node.arguments[0].value;
      }
      break;
  }
  throw new Error(`실행 가능한 표현식은 해석하지 않습니다: ${node.type}`);
}

/** 통합검색 HTML에서 쇼핑 초기 상태를 추출한다. 없으면 null. */
export function parseShoppingState(html) {
  const marker = /naver\.search\.ext\.newshopping\["shopping"\]\._INITIAL_STATE\s*=\s*/.exec(html);
  if (!marker) return null;
  return readValue(parseExpressionAt(html, marker.index + marker[0].length, { ecmaVersion: "latest" }));
}

// ==================== 페이지/카드 해석 ====================

/** pagedSlot 페이지 배열에서 카드 목록을 꺼낸다. 구조가 다르면 throw (형식 변경 감지). */
export function cardsFromPages(pages) {
  if (!Array.isArray(pages)) throw new Error("상품 페이지 배열이 없습니다.");
  return pages.flatMap((page) => {
    if (!page || !Array.isArray(page.slots)) throw new Error("상품 슬롯 배열이 없습니다.");
    return page.slots.flatMap((slot) =>
      slot && slot.slotType === "HORIZONTAL_LIST" ? (Array.isArray(slot.data) ? slot.data : []) : [slot?.data]
    );
  }).filter((card) => card && typeof card.productName === "string");
}

/** shopping-paged-slot JSON 응답에서 페이지 배열을 꺼낸다. 형식이 다르면 null. */
export function pagesFromPagedResponse(json) {
  if (!json || !Array.isArray(json.data)) return null;
  for (const page of json.data) {
    if (!page || typeof page.page !== "number" || !Array.isArray(page.slots)) return null;
  }
  return json.data;
}

/**
 * 공개 클라이언트가 사용하는 페이지 이동 요청 구성 (2026-09-13 관측 형식 반영).
 * 개인 로그인 쿠키나 비밀키는 사용하지 않는다.
 */
export function pagingRequest(state, page) {
  const url = new URL("https://ns-portal.shopping.naver.com/api/v2/shopping-paged-slot");
  const params = {
    ...state.initProps.byPassBFFParams,
    isFastDelivery: false, isArriveGuarantee: false,
    query: state.query, source: state.areaCode, page,
  };
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers = { "Content-Type": "application/json" };
  for (const [name, value] of Object.entries({
    "x-ns-rev": state.rev,
    "x-ns-page-id": state.pageId,
    "x-ns-session-id": state.sessionId,
    "x-ns-device-type": state.device?.type,
    "x-ns-view-type": state.viewType,
    "x-ns-referer": state.nxReferer,
    "x-ns-route": state.route,
  })) {
    if (typeof value === "string" && value) headers[name] = value;
  }
  return { url, headers };
}

// ==================== 카드 → 기존 내부 형식 매핑 ====================

/** http(s) URL만 통과시킨다. javascript: 등은 null. */
export function httpUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

/**
 * 상품명 HTML 정리: 검색어 강조 <mark>만 <b>로 바꾸고 나머지 꺾쇠는 모두 이스케이프.
 * (UI가 title을 HTML로 렌더링하므로 원격 마크업을 그대로 통과시키지 않는다)
 */
export function sanitizeTitleHtml(name) {
  return String(name)
    .replaceAll("<mark>", "\u0001").replaceAll("</mark>", "\u0002")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\u0001", "<b>").replaceAll("\u0002", "</b>");
}

/** 표시 가격 선택: 할인가(KRW) → 할인가 → 정가 순. 양수 정수가 아니면 null. */
function pickPrice(card) {
  for (const value of [card.discountedKRWSalePrice, card.discountedSalePrice, card.salePrice]) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return null;
}

/**
 * 일반(SAS) 카드 1건을 기존 NaverShopRawItem 호환 형식으로 변환.
 * 가격이나 링크를 검증할 수 없으면 null (지어내지 않고 버린다).
 *
 * - ORGANIC_CARD: 판매처 직접 상품 링크(productUrl) 우선.
 * - CATALOG_CARD: 직접 구매 링크·판매처명이 없다. 실제로 존재하는 가격비교
 *   링크(productClickUrl)를 링크로 쓰고, mallName은 비워 두며 sellerCount(판매처 수)만 전달한다.
 */
export function mapCardToRawItem(card) {
  const price = pickPrice(card);
  if (price === null) return null;
  if (typeof card.productName !== "string" || !card.productName.trim()) return null;

  const directUrl = httpUrl(card.productUrl?.pcUrl);
  const comparisonUrl = httpUrl(card.productClickUrl?.pcUrl);
  const link = card.cardType === "CATALOG_CARD" ? comparisonUrl : (directUrl ?? comparisonUrl);
  if (!link) return null;

  return {
    title: sanitizeTitleHtml(card.productName),
    link,
    image: httpUrl(card.images?.[0]?.imageUrl) ?? "",
    lprice: String(price),
    hprice: "0",
    mallName: typeof card.mallName === "string" ? card.mallName : "",
    productId: card.nvMid !== null && card.nvMid !== undefined ? String(card.nvMid) : "",
    productType: card.cardType === "CATALOG_CARD" ? "1" : "2",
    brand: "",
    maker: "",
    category1: "",
    category2: "",
    category3: "",
    category4: "",
    sellerCount: typeof card.mallCount === "number" && card.mallCount > 0 ? card.mallCount : 0,
    isOversea: card.isOverseaProduct === true,
  };
}

/**
 * 수집된 카드들(초기 HTML + 페이지 이동 응답)을 병합해 상품 목록과 수집 메타를 만든다.
 *
 * @param primaryCards 노출 순서를 대표하는 카드 목록 (pages>1이면 paged-slot의 1~N페이지, 아니면 HTML 1페이지)
 * @param extraCards   같은 검색의 다른 응답에서 나온 추가 카드 (광고 로테이션으로 구성이 달라짐). 뒤에 덧붙인다.
 * @param pagesRequested 사용자가 요청한 페이지 수
 * @param pagesReturned  실제 응답에 포함된 페이지 번호 목록
 * @param warnings       상위 레이어가 수집 중 기록한 경고
 */
export function buildCollection({ primaryCards, extraCards = [], pagesRequested, pagesReturned, warnings = [] }) {
  const meta = {
    source: "naver-integrated-search",
    order: "relevance",
    pagesRequested,
    pagesCollected: pagesReturned.length,
    totalCards: 0,
    adCards: 0,
    organicCards: 0,
    catalogCards: 0,
    droppedCards: 0,
    warnings,
  };

  const items = [];
  const seen = new Set();
  for (const card of [...primaryCards, ...extraCards]) {
    meta.totalCards += 1;
    if (card.sourceType !== "SAS") {
      meta.adCards += 1; // 광고·프로모션(AD, SUPER_POINT 등)은 일반 결과에서 제외
      continue;
    }
    const key = card.nvMid !== null && card.nvMid !== undefined ? `id:${card.nvMid}` : `nm:${card.productName}`;
    if (seen.has(key)) continue; // 누적 페이지 응답 특성상 같은 상품이 반복 등장
    seen.add(key);
    if (card.cardType === "CATALOG_CARD") meta.catalogCards += 1;
    else meta.organicCards += 1;
    const item = mapCardToRawItem(card);
    if (!item) {
      meta.droppedCards += 1; // 가격·링크를 검증할 수 없는 카드는 버린다
      continue;
    }
    items.push(item);
  }
  return { items, meta };
}

// ==================== 차단/로그인 감지 ====================

/** 응답이 접속 제한/로그인 요구인지 판별한다. */
export function detectBlocked({ status, finalHost, html }) {
  if (finalHost === "nid.naver.com") return "네이버 로그인 페이지로 이동되었습니다.";
  if (status === 418 || status === 429) return `접속 제한 응답(HTTP ${status})을 받았습니다.`;
  // 주의: 정상 HTML의 스크립트에도 "captcha" 문자열이 있으므로 안내 문구만 정확히 검사한다.
  if (typeof html === "string" && html.includes("쇼핑 서비스 접속이 일시적으로 제한되었습니다")) {
    return "접속 제한 안내 페이지를 받았습니다.";
  }
  return null;
}
