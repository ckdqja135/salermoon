import test from "node:test";
import assert from "node:assert/strict";
import {
  parseShoppingState,
  cardsFromPages,
  pagesFromPagedResponse,
  pagingRequest,
  sanitizeTitleHtml,
  mapCardToRawItem,
  buildCollection,
  detectBlocked,
} from "../core.mjs";

const wrap = (value) => `<script>naver.search.ext.newshopping["shopping"]._INITIAL_STATE=${value};</script>`;

// ==================== 정적 해석 ====================

test("초기 상태를 실행 없이 해석하고 문자열 안의 특수 텍스트를 훼손하지 않는다", () => {
  const result = parseShoppingState(wrap('{"title":"undefined new Date(hi)","missing":undefined,"date":new Date("2026-09-13"),"price":-1}'));
  assert.deepEqual(result, { title: "undefined new Date(hi)", missing: null, date: "2026-09-13", price: -1 });
});

test("함수 호출/getter 등 실행 가능한 코드는 거부한다", () => {
  assert.throws(() => parseShoppingState(wrap('{"value":process.exit(1)}')), /실행 가능한/);
  assert.throws(() => parseShoppingState(wrap('{get value(){return 1}}')), /실행 가능한/);
  assert.equal(parseShoppingState("<html>로그인</html>"), null);
});

// ==================== 제목 정리 ====================

test("제목의 <mark>만 <b>로 바꾸고 다른 마크업은 이스케이프한다", () => {
  assert.equal(
    sanitizeTitleHtml('수달리<mark>커피</mark> <img src=x onerror=alert(1)> 1kg'),
    "수달리<b>커피</b> &lt;img src=x onerror=alert(1)&gt; 1kg"
  );
});

// ==================== 카드 매핑 ====================

const organicCard = {
  cardType: "ORGANIC_CARD",
  sourceType: "SAS",
  nvMid: 82886816041,
  productName: "수달리<mark>커피 원두</mark> 1kg",
  productUrl: { pcUrl: "https://smartstore.naver.com/main/products/5342323206" },
  productClickUrl: { pcUrl: "https://cr3.shopping.naver.com/v2/bridge/searchGate?nv_mid=1" },
  images: [{ imageUrl: "https://shopping-phinf.pstatic.net/main_8288681/82886816041.36.jpg" }],
  mallName: "수달리커피",
  mallCount: 0,
  salePrice: 31900,
  discountedSalePrice: 23900,
  discountedKRWSalePrice: 23900,
  isOverseaProduct: false,
};

const catalogCard = {
  cardType: "CATALOG_CARD",
  sourceType: "SAS",
  nvMid: 51929205741,
  productName: "스파클 무라벨 <mark>생수</mark> 2L, 30개",
  productUrl: { pcUrl: "" }, // 카탈로그는 직접 구매 링크가 없다
  productClickUrl: { pcUrl: "https://cr3.shopping.naver.com/v2/bridge/searchGate?nv_mid=51929205741" },
  images: [{ imageUrl: "https://shopping-phinf.pstatic.net/main_5192920/51929205741.jpg" }],
  mallName: "",
  mallCount: 745,
  salePrice: 0,
  discountedSalePrice: 12090,
  discountedKRWSalePrice: 12090,
  isOverseaProduct: false,
};

test("일반 카드는 판매처 직접 링크와 할인가를 사용한다", () => {
  const item = mapCardToRawItem(organicCard);
  assert.equal(item.link, "https://smartstore.naver.com/main/products/5342323206");
  assert.equal(item.lprice, "23900");
  assert.equal(item.mallName, "수달리커피");
  assert.equal(item.productType, "2");
  assert.equal(item.isOversea, false);
});

test("카탈로그 카드는 판매처명을 지어내지 않고 가격비교 링크와 판매처 수만 전달한다", () => {
  const item = mapCardToRawItem(catalogCard);
  assert.equal(item.mallName, "");
  assert.equal(item.sellerCount, 745);
  assert.equal(item.productType, "1");
  assert.equal(item.link, "https://cr3.shopping.naver.com/v2/bridge/searchGate?nv_mid=51929205741");
  assert.equal(item.lprice, "12090"); // salePrice 0이어도 할인가로 검증
});

test("가격이나 링크를 검증할 수 없는 카드는 버린다", () => {
  assert.equal(mapCardToRawItem({ ...organicCard, salePrice: 0, discountedSalePrice: 0, discountedKRWSalePrice: undefined }), null);
  assert.equal(mapCardToRawItem({ ...organicCard, productUrl: { pcUrl: "javascript:alert(1)" }, productClickUrl: { pcUrl: "javascript:alert(1)" } }), null);
  assert.equal(mapCardToRawItem({ ...catalogCard, productClickUrl: { pcUrl: "" } }), null);
});

test("해외직구 상품 플래그를 전달한다", () => {
  assert.equal(mapCardToRawItem({ ...organicCard, isOverseaProduct: true }).isOversea, true);
});

// ==================== 수집 병합 ====================

test("광고를 제외하고 누적 페이지의 중복 상품을 ID로 제거한다", () => {
  const ad = { cardType: "AD_CARD", sourceType: "AD", nvMid: 999, productName: "광고", discountedSalePrice: 100, productClickUrl: { pcUrl: "https://ad.example" } };
  const superPoint = { cardType: "SUPER_POINT_CARD", sourceType: "SUPER_POINT", nvMid: 998, productName: "프로모션", discountedSalePrice: 100 };
  const { items, meta } = buildCollection({
    primaryCards: [ad, organicCard, catalogCard, { ...organicCard }, superPoint], // 같은 nvMid 반복(누적 응답)
    extraCards: [{ ...organicCard, nvMid: 777, productName: "다른 상품" }],
    pagesRequested: 4,
    pagesReturned: [1, 2, 3, 4],
  });
  assert.equal(meta.adCards, 2);
  assert.equal(meta.organicCards, 2);
  assert.equal(meta.catalogCards, 1);
  assert.equal(items.length, 3);
  assert.deepEqual([...new Set(items.map((p) => p.productId))].length, items.length);
  assert.equal(meta.pagesCollected, 4);
});

test("검증 실패 카드는 droppedCards로 집계된다", () => {
  const broken = { ...organicCard, nvMid: 555, productUrl: { pcUrl: "" }, productClickUrl: { pcUrl: "" } };
  const { items, meta } = buildCollection({ primaryCards: [broken], pagesRequested: 1, pagesReturned: [1] });
  assert.equal(items.length, 0);
  assert.equal(meta.droppedCards, 1);
});

// ==================== 페이지 응답 해석 ====================

test("페이지 응답 형식 검증: 올바른 형식만 통과", () => {
  assert.equal(pagesFromPagedResponse({ data: "html" }), null);
  assert.equal(pagesFromPagedResponse({ data: [{ slots: [] }] }), null); // page 번호 없음
  const pages = pagesFromPagedResponse({ data: [{ page: 1, slots: [{ slotType: "CARD", data: organicCard }] }] });
  assert.equal(pages.length, 1);
  assert.equal(cardsFromPages(pages).length, 1);
});

test("HORIZONTAL_LIST 슬롯은 배열 데이터를 펼친다", () => {
  const cards = cardsFromPages([{ page: 1, slots: [{ slotType: "HORIZONTAL_LIST", data: [organicCard, catalogCard] }, { slotType: "CARD", data: organicCard }] }]);
  assert.equal(cards.length, 3);
});

// ==================== 요청 구성 / 차단 감지 ====================

test("페이지 이동 요청은 초기 상태 값만으로 구성된다 (쿠키/비밀키 없음)", () => {
  const state = {
    initProps: { byPassBFFParams: { rev: "4", ssc: "tab.nx.all", empty: null } },
    query: "생수", areaCode: "srch.shopping", rev: "4", pageId: "p1", sessionId: "s1",
    viewType: "pc", nxReferer: "", route: "r", device: { type: "pc" },
  };
  const { url, headers } = pagingRequest(state, 4);
  assert.equal(url.hostname, "ns-portal.shopping.naver.com");
  assert.equal(url.searchParams.get("page"), "4");
  assert.equal(url.searchParams.get("query"), "생수");
  assert.equal(url.searchParams.has("empty"), false);
  assert.equal(headers["x-ns-session-id"], "s1");
  assert.equal("cookie" in headers || "Cookie" in headers, false);
});

test("로그인 이동과 접속 제한 응답을 구분해 감지한다", () => {
  assert.match(detectBlocked({ status: 200, finalHost: "nid.naver.com" }), /로그인/);
  assert.match(detectBlocked({ status: 418, finalHost: "search.shopping.naver.com" }), /418/);
  assert.match(detectBlocked({ status: 200, finalHost: "search.naver.com", html: "쇼핑 서비스 접속이 일시적으로 제한되었습니다" }), /제한/);
  assert.equal(detectBlocked({ status: 200, finalHost: "search.naver.com", html: "<html>정상</html>" }), null);
});
