import test from "node:test";
import assert from "node:assert/strict";
import { parseShoppingState, productsFromPages, summarizeProducts } from "./shopping-state.mjs";

const wrap = (value) => `<script>naver.search.ext.newshopping["shopping"]._INITIAL_STATE=${value};</script>`;

test("reads static values without corrupting undefined/date text inside strings", () => {
  const result = parseShoppingState(wrap('{"title":"undefined new Date(hi)","missing":undefined,"date":new Date("2026-09-13"),"price":-1}'));
  assert.deepEqual(result, { title: "undefined new Date(hi)", missing: null, date: "2026-09-13", price: -1 });
});

test("rejects calls and getters instead of executing remote code", () => {
  assert.throws(() => parseShoppingState(wrap('{"value":process.exit(1)}')), /실행 가능한/);
  assert.throws(() => parseShoppingState(wrap('{get value(){return 1}}')), /실행 가능한/);
  assert.equal(parseShoppingState("<html>로그인</html>"), null);
});

test("separates ads and catalog prices from actual seller offers", () => {
  const products = productsFromPages([{ slots: [
    { slotType: "CARD", data: { sourceType: "AD", cardType: "AD_CARD", productName: "광고", discountedSalePrice: 1 } },
    { slotType: "HORIZONTAL_LIST", data: [
      { sourceType: "SAS", cardType: "CATALOG_CARD", nvMid: 1, productName: "묶음", discountedSalePrice: 9000, mallCount: 100 },
      { sourceType: "SAS", cardType: "ORGANIC_CARD", nvMid: 2, productName: "판매", discountedSalePrice: 10000, mallName: "판매처", productUrl: { pcUrl: "https://example.com/product" } },
      { sourceType: "SAS", cardType: "ORGANIC_CARD", nvMid: 3, productName: "잘못된 링크", discountedSalePrice: 10000, mallName: "판매처", productUrl: { pcUrl: "javascript:alert(1)" } },
    ] },
  ] }]);
  const summary = summarizeProducts(products);
  assert.equal(summary.total, 4);
  assert.equal(summary.ordinaryCount, 3);
  assert.equal(summary.ordinaryWithSellerAndDirectLink, 1);
  assert.equal(summary.samples[0].seller, null);
  assert.equal(summary.samples[2].directUrl, null);
});
