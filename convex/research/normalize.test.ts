import { describe, expect, it } from "vitest";
import fixture from "./fixtures/johnvc-shopping.json";
import { normalizeDataset, normalizeListing } from "./normalize";
import { normalizedListingSchema } from "../../lib/validation";

const T = 1_792_826_186_205;
const row = {
  title: "Pottery tools", product_link: "https://www.example.com/tools",
  currency: "USD", price: "$22.30", extracted_price: 22.3,
};
const page = (products: unknown[], gl = "us") => [{
  search_parameters: { gl }, shopping_results: products,
}];

describe("Apify normalization", () => {
  it("normalizes a reviewed real response without leaking provider helper fields", () => {
    const results = normalizeDataset(fixture.pages, fixture.retrievedAt);
    expect(results).toHaveLength(4);
    expect(results[0]).toMatchObject({
      title: "Kemper Pottery Tool Kit", priceMinor: 2230,
      source: "apify", currency: "USD", priceStatus: "observed",
      availability: "unknown", shippingStatus: "unknown",
    });
    expect(results[3]?.title).toContain("(4 pack)");
    for (const listing of results) {
      expect(normalizedListingSchema.safeParse(listing).success).toBe(true);
      expect(listing).not.toHaveProperty("shippingMinor");
      expect(listing).not.toHaveProperty("serpapi_product_api");
      expect(listing).not.toHaveProperty("immersive_product_page_token");
      expect(listing.retrievedAt).toBe(fixture.retrievedAt);
    }
  });

  it.each([
    ["$0.00", 0, 0], ["$0.29", 0.29, 29],
    ["$1,234.56", 1234.56, 123456], ["USD 25.50", 25.5, 2550],
    ["US$25.50", 25.5, 2550], ["25.50 USD", 25.5, 2550],
  ])("converts exact observed price %s to cents", (price, extracted_price, cents) => {
    expect(normalizeListing({ ...row, price, extracted_price }, T)?.priceMinor).toBe(cents);
  });

  it.each([
    { price: undefined, extracted_price: undefined },
    { price: "$19–$29", extracted_price: 19 },
    { price: "From $19", extracted_price: 19 },
    { price: "$4/month", extracted_price: 4 },
    { price: "$22.30", extracted_price: 20 },
    { price: "$20.123", extracted_price: 20.123 },
    { price: "$-2", extracted_price: -2 },
    { price: undefined, extracted_price: Infinity },
    { price: undefined, extracted_price: Number.MAX_SAFE_INTEGER },
    { price: "$20.00", extracted_price: "20" },
  ])("keeps ambiguous/malformed prices unknown: %j", (fields) => {
    const result = normalizeListing({ ...row, ...fields }, T);
    expect(result?.priceStatus).toBe("unknown");
    expect(result).not.toHaveProperty("priceMinor");
  });

  it("accepts numeric-only prices only with established USD context", () => {
    expect(normalizeListing({ ...row, price: undefined }, T)?.priceMinor).toBe(2230);
    expect(normalizeListing({ ...row, currency: undefined }, T)).toBeNull();
    expect(normalizeDataset(page([{ ...row, currency: undefined }]), T)).toHaveLength(1);
  });

  it.each(["EUR", "CAD", "AUD", "GBP"])("drops explicit non-USD currency %s", currency => {
    expect(normalizeDataset(page([{ ...row, currency }]), T)).toEqual([]);
  });

  it.each(["€20", "CA$20", "A$20", "GBP 20"])("rejects contradictory currency label %s", price => {
    expect(normalizeListing({ ...row, price }, T)).toBeNull();
  });

  it.each(["", "javascript:alert(1)", "https://user:pass@example.com/tools",
    "http://localhost/a", "http://127.0.0.1/a", "http://169.254.169.254/a",
    "http://[::1]/a", "not a url",
  ])("drops invalid/non-public source URLs %s", product_link => {
    expect(normalizeListing({ ...row, product_link }, T)).toBeNull();
  });

  it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid retrieval timestamp %s", timestamp => {
    expect(normalizeListing(row, timestamp)).toBeNull();
  });

  it("drops bad optional images but preserves useful listings", () => {
    const result = normalizeListing({ ...row, thumbnail: "javascript:alert(1)", source: 42 }, T);
    expect(result?.title).toBe("Pottery tools");
    expect(result).not.toHaveProperty("imageUrl");
    expect(result).not.toHaveProperty("sellerName");
  });

  it("does not infer availability or shipping from source prose", () => {
    const result = normalizeListing({ ...row, delivery: "Free delivery on $89+", availability: "in_stock" }, T);
    expect(result?.shippingStatus).toBe("unknown");
    expect(result?.availability).toBe("unknown");
    expect(result).not.toHaveProperty("shippingMinor");
  });

  it("deduplicates identical observations while retaining different sellers and variants", () => {
    const product = { ...row, product_id: "123", source: "Seller A" };
    const results = normalizeDataset(page([
      product, { ...product }, { ...product, source: "Seller B" },
      { ...product, title: "Pottery tools (4 pack)" },
    ]), T);
    expect(results).toHaveLength(3);
  });

  it("drops invalid rows independently and rejects unverified page localization", () => {
    expect(normalizeDataset(page([null, {}, row]), T)).toHaveLength(1);
    expect(normalizeDataset(page([row], "ca"), T)).toEqual([]);
    expect(normalizeDataset([{ shopping_results: [row] }], T)).toEqual([]);
    expect(normalizeDataset({ error: "provider failed" }, T)).toEqual([]);
    expect(normalizeListing({ ...row, title: " " }, T)).toBeNull();
  });

  it("validates output status/amount consistency", () => {
    const valid = normalizeListing(row, T);
    expect(normalizedListingSchema.safeParse({ ...valid, priceMinor: undefined }).success).toBe(false);
    expect(normalizedListingSchema.safeParse({ ...valid, priceStatus: "unknown" }).success).toBe(false);
    expect(normalizedListingSchema.safeParse({ ...valid, secret: "extra" }).success).toBe(false);
  });
});
