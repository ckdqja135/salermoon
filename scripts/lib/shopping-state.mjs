import { parseExpressionAt } from "acorn";

// Parse data syntax only. Never evaluate JavaScript supplied by a remote page.
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

export function parseShoppingState(html) {
  const marker = /naver\.search\.ext\.newshopping\["shopping"\]\._INITIAL_STATE\s*=\s*/.exec(html);
  if (!marker) return null;
  return readValue(parseExpressionAt(html, marker.index + marker[0].length, { ecmaVersion: "latest" }));
}

export function productsFromPages(pages) {
  if (!Array.isArray(pages)) throw new Error("상품 페이지 배열이 없습니다.");
  return pages.flatMap((page) => {
    if (!Array.isArray(page.slots)) throw new Error("상품 슬롯 배열이 없습니다.");
    return page.slots.flatMap((slot) => slot.slotType === "HORIZONTAL_LIST" ? slot.data : [slot.data]);
  }).filter((product) => product && typeof product.productName === "string");
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function summarizeProducts(products) {
  const ordinary = products.filter((p) => p.sourceType === "SAS");
  const mapped = ordinary.map((p) => ({
    id: String(p.nvMid),
    title: p.productName.replace(/<[^>]*>/g, ""),
    price: p.discountedKRWSalePrice ?? p.discountedSalePrice ?? p.salePrice,
    seller: p.mallName || null,
    sellerCount: p.mallCount || 0,
    directUrl: httpUrl(p.productUrl?.pcUrl),
    comparisonLinkAvailable: Boolean(httpUrl(p.productClickUrl?.pcUrl)),
    type: p.cardType,
  }));
  return {
    total: products.length,
    cardTypes: products.reduce((counts, p) => {
      counts[p.cardType] = (counts[p.cardType] || 0) + 1;
      return counts;
    }, {}),
    ordinaryCount: ordinary.length,
    ordinaryWithPrice: mapped.filter((p) => Number.isFinite(p.price) && p.price > 0).length,
    ordinaryWithSellerAndDirectLink: mapped.filter((p) => p.seller && p.directUrl).length,
    // Advertised prices, not checkout prices or verified stock availability.
    samples: mapped.slice(0, 3),
  };
}

// Mirrors the public shopping component's request format observed on 2026-09-13.
// Fixed host/path; no logged-in session or secret key is used.
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
