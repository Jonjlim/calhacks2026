/**
 * Deterministic verifier. Owner: Dev 3. No model call: code owns the facts.
 *
 * Before a recommendation or reply is posted, every listing it relies on is
 * checked against its stored record, and any money or availability claim in
 * model-written prose is checked against those records too.
 */
import { formatMinor } from "../../lib/money";
import type { BuyerSnapshot } from "./engine";

type Listing = BuyerSnapshot["listings"][number];

/** A price observed longer ago than this is shown with a freshness warning, not dropped. */
export const PRICE_FLAG_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type ListingVerdict =
  | { status: "ok" }
  | { status: "flag"; notes: string[] }
  | { status: "drop"; reason: string };

export function verifyListing(
  listing: Listing,
  options: { budgetMinor?: number; now?: number },
): ListingVerdict {
  const now = options.now ?? Date.now();
  if (listing.currency !== undefined && listing.currency !== "USD")
    return { status: "drop", reason: "Listing is not priced in USD." };
  if (listing.availability === "unavailable")
    return { status: "drop", reason: "Listing is unavailable." };
  if (
    options.budgetMinor !== undefined &&
    listing.priceStatus === "observed" &&
    listing.priceMinor !== undefined &&
    listing.priceMinor > options.budgetMinor
  )
    return { status: "drop", reason: "Observed price is over the room budget." };
  const notes: string[] = [];
  if (listing.priceStatus !== "observed" || listing.priceMinor === undefined)
    notes.push("Price could not be confirmed.");
  else if (now - listing.retrievedAt > PRICE_FLAG_AFTER_MS)
    notes.push("Price was observed more than a week ago.");
  if (listing.availability === "limited") notes.push("Availability is limited.");
  if (listing.availability === undefined || listing.availability === "unknown")
    notes.push("Availability is unconfirmed.");
  if (
    options.budgetMinor !== undefined &&
    listing.priceStatus === "observed" &&
    listing.priceMinor !== undefined &&
    listing.shippingStatus === "observed" &&
    listing.shippingMinor !== undefined &&
    listing.priceMinor + listing.shippingMinor > options.budgetMinor
  )
    notes.push("With shipping this is over the room budget.");
  return notes.length ? { status: "flag", notes } : { status: "ok" };
}

const MONEY = /(?:\$|usd\s?|us\$)\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s?(?:usd|dollars?|bucks)\b/gi;
const AVAILABILITY_CLAIM =
  /\b(?:in stock|out of stock|sold out|back ?order(?:ed)?|ships? (?:today|tomorrow|in \d+)|free shipping|on sale|discount(?:ed)?|\d+% off)\b/i;
const URL = /https?:\/\/|www\./i;

/** Amounts a reply may mention: only values that appear in the stored records. */
function knownAmounts(snapshot: BuyerSnapshot): Set<number> {
  const amounts = new Set<number>();
  if (snapshot.budgetMinor !== undefined) amounts.add(snapshot.budgetMinor);
  for (const listing of snapshot.listings) {
    if (listing.priceMinor !== undefined) amounts.add(listing.priceMinor);
    if (listing.shippingMinor !== undefined) amounts.add(listing.shippingMinor);
  }
  return amounts;
}

/**
 * Model-written replies may not state prices, availability, promotions, or
 * links of their own. Amounts that match a stored record are allowed.
 */
export function verifyReplyText(
  text: string,
  snapshot: BuyerSnapshot,
): { ok: true } | { ok: false; reason: string } {
  if (URL.test(text)) return { ok: false, reason: "Reply contained a link." };
  if (AVAILABILITY_CLAIM.test(text))
    return { ok: false, reason: "Reply made an availability or promotion claim." };
  const known = knownAmounts(snapshot);
  for (const match of text.matchAll(MONEY)) {
    const major = Number((match[1] ?? match[2])!.replace(/,/g, ""));
    if (!Number.isFinite(major) || !known.has(Math.round(major * 100)))
      return { ok: false, reason: "Reply stated an amount that is not in the records." };
  }
  return { ok: true };
}

/** Observed facts for one listing, rendered from the record only. */
export function listingFacts(listing: Listing): string {
  const price =
    listing.priceStatus === "observed" && listing.priceMinor !== undefined
      ? `${formatMinor(listing.priceMinor)} observed item price`
      : "Item price unknown";
  const when = new Date(listing.retrievedAt);
  const observed = Number.isFinite(when.getTime()) ? when.toISOString() : "unknown";
  return `“${listing.title.length > 120 ? listing.title.slice(0, 119) + "…" : listing.title}” — ${price} (observed ${observed}). Availability: ${listing.availability ?? "unknown"}.`;
}
