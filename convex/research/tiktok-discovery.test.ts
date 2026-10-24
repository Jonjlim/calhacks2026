import { expect, it } from "vitest";
import fashion from "../../lib/research/fixtures/tiktok-fashion.json";
import shopping from "../../lib/research/fixtures/tiktok-shopping.json";
import { discoverFashionIdeas, normalizeTikTokPosts } from "../../lib/research/tiktok";
import { normalizeDataset } from "./normalize";

it("replays caption-supported clothing discovery into the existing shopping source without inventing item claims", () => {
  const ideas = discoverFashionIdeas(normalizeTikTokPosts(fashion.data, fashion.context), fashion.context);
  expect(ideas.find(idea => idea.searchQuery === shopping.provenance.query)?.distinctCreators).toBe(3);
  const listings = normalizeDataset(shopping.data, shopping.provenance.retrievedAt);
  expect(listings).toHaveLength(5);
  expect(listings.every(listing => listing.source === "apify" && listing.priceStatus === "observed" && listing.sourceUrl && listing.imageUrl)).toBe(true);
  expect(listings[0]).toMatchObject({ title: "Old Navy Men's 90'S Loose Jeans", priceMinor: 2749, currency: "USD", availability: "unknown", shippingStatus: "unknown" });
  // Retrieval association never establishes SKU popularity, genuine vintage age, or recipient size.
  expect(listings[0]).not.toHaveProperty("trendSignal");
  expect(listings[0]).not.toHaveProperty("size");
  expect(ideas[0]).not.toHaveProperty("publishedClueIds");
});
