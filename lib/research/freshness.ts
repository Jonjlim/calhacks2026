import type { PriceFreshness, ProductListing } from "../contracts";

export const RECENT_PRICE_WINDOW_MS = 30 * 60 * 1000;
export const STALE_PRICE_WINDOW_MS = 6 * 60 * 60 * 1000;

type PriceObservation = Pick<ProductListing, "priceStatus" | "priceMinor" | "retrievedAt" | "status">;

/** Pure presentation data. Never treats an observed price as a merchant price lock. */
export function getPriceFreshness(
  listing: PriceObservation,
  now: number,
  options: { sourceFailed?: boolean } = {},
): PriceFreshness {
  if (listing.status === "invalid") {
    return { kind: "unavailable", label: "Listing unavailable", needsRefresh: false };
  }
  if (listing.priceStatus !== "observed" || listing.priceMinor === undefined
    || !Number.isSafeInteger(listing.priceMinor) || listing.priceMinor < 0) {
    return { kind: "unknown", label: "Price unknown", needsRefresh: true };
  }
  if (!Number.isSafeInteger(now) || now <= 0
    || !Number.isSafeInteger(listing.retrievedAt) || listing.retrievedAt <= 0
    || listing.retrievedAt > now) {
    return { kind: "unknown", label: "Price observation time unknown", needsRefresh: true };
  }
  const ageMs = now - listing.retrievedAt;
  const observation = { observedAt: listing.retrievedAt, ageMs };
  if (options.sourceFailed || listing.status === "stale" || ageMs >= STALE_PRICE_WINDOW_MS) {
    return { ...observation, kind: "stale", label: "Price needs refresh", needsRefresh: true };
  }
  const recent = ageMs < RECENT_PRICE_WINDOW_MS;
  const nextChangeAt = listing.retrievedAt + (recent ? RECENT_PRICE_WINDOW_MS : STALE_PRICE_WINDOW_MS);
  return {
    ...observation,
    kind: recent ? "recent" : "aging",
    label: recent ? "Price observed recently" : "Price observed earlier",
    needsRefresh: false,
    ...(Number.isSafeInteger(nextChangeAt) ? { nextChangeAt } : {}),
  };
}
