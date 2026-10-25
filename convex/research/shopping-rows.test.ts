import { describe, expect, it } from "vitest";
import scrapewise from "./fixtures/scrapewise-shopping.json";
import recorded from "./fixtures/automation-lab-missing-links.json";
import { normalizeDataset, normalizeShoppingRow, normalizeScrapewiseRow, providerNotice } from "./normalize";

// Shaped like automation-lab/google-shopping-scraper's documented output (D24). A documented example, not a recorded live run.
const row = (over: Record<string, unknown> = {}) => ({
  title: "Sony WF-1000XM5 Truly Wireless Noise Cancelling Earbuds", price: "$228.00", priceNumeric: 228.0, currency: "USD",
  merchant: "Amazon.com", productUrl: "https://www.amazon.com/dp/B0C8S9FMHD",
  imageUrl: "https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc", rating: 4.5, reviewCount: 12847,
  delivery: "Free delivery", position: 1, query: "wireless earbuds", scrapedAt: "2026-03-22T12:00:00.000Z", ...over,
});
const at = 1_792_900_000_000;

describe("the current shopping source's product rows", () => {
  it("keeps the store's own link, the exact US price, seller and image", () => {
    expect(normalizeShoppingRow(row(), at)).toEqual({
      source: "apify", sourceUrl: "https://www.amazon.com/dp/B0C8S9FMHD", title: "Sony WF-1000XM5 Truly Wireless Noise Cancelling Earbuds",
      currency: "USD", priceMinor: 22800, priceStatus: "observed", availability: "unknown", shippingStatus: "unknown",
      imageUrl: "https://encrypted-tbn0.gstatic.com/shopping?q=tbn:abc", sellerName: "Amazon.com", retrievedAt: at,
    });
  });

  it("never guesses a price: ranges, 'from' prices and disagreeing numbers stay unknown", () => {
    expect(normalizeShoppingRow(row({ price: "$20 - $40", priceNumeric: 20 }), at)).toMatchObject({ priceStatus: "unknown" });
    expect(normalizeShoppingRow(row({ price: "from $19.99", priceNumeric: 19.99 }), at)).toMatchObject({ priceStatus: "unknown" });
    expect(normalizeShoppingRow(row({ price: "$228.00", priceNumeric: 199 }), at)).toMatchObject({ priceStatus: "unknown" });
    expect(normalizeShoppingRow(row({ price: undefined, priceNumeric: 42.5 }), at)).toMatchObject({ priceStatus: "observed", priceMinor: 4250 });
  });

  it("drops rows without a public link or in another currency", () => {
    expect(normalizeShoppingRow(row({ productUrl: null }), at)).toBeNull();
    expect(normalizeShoppingRow(row({ productUrl: "http://localhost/x" }), at)).toBeNull();
    expect(normalizeShoppingRow(row({ currency: "EUR" }), at)).toBeNull();
    expect(normalizeShoppingRow(row({ currency: undefined }), at)).toBeNull();
  });

  it("reads a whole dataset of rows and drops exact repeats", () => {
    const listings = normalizeDataset([row(), row(), row({ title: "Other earbuds", productUrl: "https://www.bestbuy.com/site/123" })], at);
    expect(listings.map((l) => l.title)).toEqual(["Sony WF-1000XM5 Truly Wireless Noise Cancelling Earbuds", "Other earbuds"]);
  });
});

describe("a source that answers with a notice instead of products", () => {
  const notice = [{ message: "You've used this Actor's full free monthly allowance ($1.00). We're glad it's been useful! To keep going, upgrade to a paid Apify account." }];

  it("finds no products in it, and says why", () => {
    expect(normalizeDataset(notice, at)).toEqual([]);
    expect(providerNotice(notice)).toContain("full free monthly allowance");
  });

  it("stays quiet when products came back", () => {
    expect(providerNotice([row()])).toBeNull();
  });
});

// Actual single paid run, 2026-10-25. SUCCEEDED at Apify but unusable for gifts.
it("rejects the recorded missing-link response and explains the source failure", () => {
  expect(recorded.raw).toHaveLength(16);
  expect(recorded.raw.every(item => item.productUrl === "")).toBe(true);
  expect(normalizeDataset(recorded.raw, recorded.retrievedAt)).toEqual([]);
  expect(providerNotice(recorded.raw)).toContain("16 products without usable product links");
});

// Documented D25 shape; the recorded integration test below verifies actual output.
describe("Scrapewise row semantics", () => {
  const product = { title: "Hiking backpack", productUrl: "https://www.google.com/search?ibp=oshop&q=backpack",
    price: 59.35, priceText: "$59.35", currency: "USD", store: "Outdoor store", country: "us", errorCode: null };
  it("pairs the observed card price with its Google product link, without borrowing an offer", () => {
    expect(normalizeScrapewiseRow({ ...product, storeUrl: "https://retailer.com/other", storeUrlPrice: 90 }, at))
      .toMatchObject({ sourceUrl: product.productUrl, priceMinor: 5935, priceStatus: "observed", sellerName: product.store });
  });
  it("rejects blocked, foreign and missing-link rows and keeps inconsistent prices unknown", () => {
    expect(normalizeScrapewiseRow({ ...product, errorCode: "BLOCKED" }, at)).toBeNull();
    expect(normalizeScrapewiseRow({ ...product, country: "gb" }, at)).toBeNull();
    expect(normalizeScrapewiseRow({ ...product, productUrl: "" }, at)).toBeNull();
    expect(normalizeScrapewiseRow({ ...product, priceText: "$10.00" }, at)).toMatchObject({ priceStatus: "unknown" });
  });
});

it("normalizes all 20 products from the single recorded Scrapewise run", () => {
  const listings = normalizeDataset(scrapewise.raw, scrapewise.retrievedAt);
  expect(listings).toHaveLength(20);
  expect(listings.every(item => item.priceStatus === "observed" && item.imageUrl && item.sourceUrl)).toBe(true);
  expect(listings[0]).toMatchObject({ title: "REI Co-op Tarn 18 Pack Blue", priceMinor: 5995, sellerName: "REI" });
});
