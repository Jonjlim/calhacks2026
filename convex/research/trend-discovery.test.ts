import { expect, it } from "vitest";
import type { ProductListing, TrendContext } from "../../lib/contracts";
import trends from "../../lib/research/fixtures/google-trends.json";
import shopping from "../../lib/research/fixtures/trend-shopping.json";
import { discoverShoppingQueries, normalizeTrendDataset } from "../../lib/research/trends";
import { normalizeDataset } from "./normalize";
import { rankListings } from "./score";
import { clueLikesPottery, clueOwnsStarterKit, fixtureListings } from "./fixtures/maya";

it("replays the recorded trend → real shopping response handoff with purchase facts intact", () => {
  const sample = trends[1]!;
  const discoveries = discoverShoppingQueries(normalizeTrendDataset(sample.data, sample.context as TrendContext));
  expect(discoveries.some(item => item.query === shopping.provenance.query)).toBe(true);
  const listings: ProductListing[] = normalizeDataset(shopping.data, shopping.provenance.retrievedAt)
    .map((row, index) => ({ ...row, id: `recorded_${index}`, roomId: "room_maya", jobId: "local_spike", status: "active" }));
  expect(listings).toHaveLength(5);
  const roller = listings.find(row => row.title === "BHR-051 Big Hand Roller – Zig Zag Spiral")!;
  expect(roller).toMatchObject({ priceStatus: "observed", priceMinor: 2095, currency: "USD", availability: "unknown", shippingStatus: "unknown" });
  expect(roller.sourceUrl).toMatch(/^https:\/\/www\.google\.com\//);
  expect(roller.imageUrl).toMatch(/^https:/);
  // A category/brand search trend cannot establish that every returned SKU is trending.
  const ranked = rankListings({ listings: [...listings, ...fixtureListings], clues: [clueLikesPottery, clueOwnsStarterKit], budgetMinor: 12000, limit: 30 });
  expect(ranked.some(row => row.listingId === "fx_starter_kit")).toBe(false);
  expect(ranked.every(row => row.trendSignal === 0)).toBe(true);
  // This exposes a real integration limitation: seller/query context is not title evidence.
  expect(ranked.find(row => row.listingId === roller.id)?.personalRelevance).toBe(0);
});
