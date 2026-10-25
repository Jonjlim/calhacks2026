/** Bounded basket helpers. Convex remains authoritative for money and selection. */
import type { Doc } from "../_generated/dataModel";

export const MAX_GIFT_BOX_ITEMS = 12;
export type StoredGiftBoxItem = NonNullable<Doc<"giftSelections">["items"]>[number];

export function boxItem(listing: Doc<"productListings">): StoredGiftBoxItem {
  return { listingId: listing._id, quantity: 1, listingSnapshot: {
    title: listing.title, sourceUrl: listing.sourceUrl,
    priceMinor: listing.priceMinor, priceStatus: listing.priceStatus,
    currency: listing.currency, shippingMinor: listing.shippingMinor,
    shippingStatus: listing.shippingStatus, imageUrl: listing.imageUrl,
    retrievedAt: listing.retrievedAt,
  } };
}

export function boxListingIds(selection: Doc<"giftSelections">) {
  return selection.items?.map(item => item.listingId) ?? [selection.listingId];
}

/** Stable across object key ordering in stored Convex values. */
export function boxFingerprint(items: StoredGiftBoxItem[] | undefined): string {
  return JSON.stringify(items?.map(({ listingId, quantity, listingSnapshot: s }) => [
    listingId, quantity, s.title, s.sourceUrl, s.priceMinor, s.priceStatus,
    s.currency, s.shippingMinor, s.shippingStatus, s.imageUrl, s.retrievedAt,
  ]));
}
