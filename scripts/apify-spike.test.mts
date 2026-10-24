import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectDataset } from "./apify-spike.mts";

test("requires actual product URL and numeric observed price for candidate pass", () => {
  const result = inspectDataset([{ shopping_results: [
    { title: "Pottery tools", product_link: "https://example.com/tools", extracted_price: 29.99 },
    { title: "Invalid", product_link: "javascript:alert(1)", extracted_price: 10 },
    { title: "Unknown price", product_link: "https://example.com/unknown" },
  ] }]);
  assert.equal(result.productCount, 3);
  assert.equal(result.linkedProductCount, 2);
  assert.equal(result.pricedProductCount, 1);
  assert.equal(result.verdict, "candidate_pass_needs_link_and_currency_review");
});
test("empty and unfamiliar shapes fail instead of pretending success", () => {
  assert.equal(inspectDataset([]).verdict, "fail");
  assert.equal(inspectDataset([{ results: [{ title: "Wrong shape" }] }]).productCount, 0);
  assert.throws(() => inspectDataset({ error: "no data" }));
});
test("invalid and negative numeric prices do not pass", () => {
  const products = [-1, NaN, Infinity, "20"].map(price => ({
    title: "Tools", product_link: "https://example.com/tools", extracted_price: price,
  }));
  assert.equal(inspectDataset([{ shopping_results: products }]).pricedProductCount, 0);
});
