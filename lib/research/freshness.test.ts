import { describe, expect, it } from "vitest";
import type { ProductListing } from "../contracts";
import { getPriceFreshness, RECENT_PRICE_WINDOW_MS, STALE_PRICE_WINDOW_MS } from "./freshness";

const NOW = 1_800_000_000_000;
const observation = (ageMs: number): Pick<ProductListing, "priceStatus" | "priceMinor" | "retrievedAt" | "status"> => ({
  priceStatus: "observed", priceMinor: 2230, retrievedAt: NOW - ageMs, status: "active",
});

describe("price observation freshness", () => {
  it.each([
    [0, "recent"], [RECENT_PRICE_WINDOW_MS - 1, "recent"],
    [RECENT_PRICE_WINDOW_MS, "aging"], [STALE_PRICE_WINDOW_MS - 1, "aging"],
    [STALE_PRICE_WINDOW_MS, "stale"], [STALE_PRICE_WINDOW_MS + 1, "stale"],
  ] as const)("classifies a %s ms old observation as %s", (age, kind) => {
    const result = getPriceFreshness(observation(age), NOW);
    expect(result.kind).toBe(kind);
    expect(result.ageMs).toBe(age);
    expect(result.needsRefresh).toBe(kind === "stale");
  });

  it("provides exact next-change times and advances without a new provider result", () => {
    const listing = observation(0);
    expect(getPriceFreshness(listing, NOW).nextChangeAt).toBe(NOW + RECENT_PRICE_WINDOW_MS);
    expect(getPriceFreshness(listing, NOW + RECENT_PRICE_WINDOW_MS).nextChangeAt)
      .toBe(NOW + STALE_PRICE_WINDOW_MS);
    expect(getPriceFreshness(listing, NOW + STALE_PRICE_WINDOW_MS).nextChangeAt).toBeUndefined();
    expect(getPriceFreshness(listing, NOW + STALE_PRICE_WINDOW_MS).kind).toBe("stale");
  });

  it("keeps missing or malformed amounts unknown regardless of retrieval age", () => {
    for (const priceMinor of [undefined, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(getPriceFreshness({ ...observation(0), priceMinor }, NOW)).toEqual({
        kind: "unknown", label: "Price unknown", needsRefresh: true,
      });
    }
    expect(getPriceFreshness({ ...observation(0), priceStatus: "unknown" }, NOW).kind).toBe("unknown");
    expect(getPriceFreshness({ ...observation(0), priceMinor: 0 }, NOW).kind).toBe("recent");
  });

  it.each([0, -1, NaN, Infinity, 1.5, NOW + 1])("does not treat timestamp %s as current", retrievedAt => {
    const result = getPriceFreshness({ ...observation(0), retrievedAt }, NOW);
    expect(result.kind).toBe("unknown");
    expect(result.needsRefresh).toBe(true);
    expect(result.observedAt).toBeUndefined();
    expect(result.nextChangeAt).toBeUndefined();
  });

  it("handles invalid clocks and explicit stale/source-failure states", () => {
    expect(getPriceFreshness(observation(0), NaN).kind).toBe("unknown");
    expect(getPriceFreshness({ ...observation(0), status: "stale" }, NOW).kind).toBe("stale");
    expect(getPriceFreshness(observation(0), NOW, { sourceFailed: true })).toMatchObject({
      kind: "stale", needsRefresh: true,
    });
    expect(getPriceFreshness({ ...observation(0), status: "invalid" }, NOW)).toEqual({
      kind: "unavailable", label: "Listing unavailable", needsRefresh: false,
    });
  });

  it("is deterministic and does not change the listing or price", () => {
    const listing = Object.freeze(observation(STALE_PRICE_WINDOW_MS));
    const first = getPriceFreshness(listing, NOW);
    expect(getPriceFreshness(listing, NOW)).toEqual(first);
    expect(listing.priceMinor).toBe(2230);
    expect(listing.status).toBe("active");
  });
});
