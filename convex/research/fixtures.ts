/**
 * Maya pottery demo fixtures for Dev 4 tests and offline rehearsal.
 * Every listing is `manual_fixture` and must be labeled as such in the UI.
 * Never promote these to `apify`.
 */
import type { ProductListing, PublishedClue } from "../../lib/contracts";

export const FIXTURE_ROOM_ID = "room_maya";
export const FIXTURE_JOB_ID = "rj_fixture";
export const FIXTURE_BUDGET_MINOR = 12_000;

const T0 = Date.UTC(2026, 9, 24, 18, 0, 0);

function listing(
  id: string,
  title: string,
  fields: Partial<ProductListing> = {},
): ProductListing {
  return {
    id,
    roomId: FIXTURE_ROOM_ID,
    jobId: FIXTURE_JOB_ID,
    source: "manual_fixture",
    sourceUrl: `https://example.com/fixture/${id}`,
    title,
    currency: "USD",
    priceStatus: "observed",
    availability: "unknown",
    shippingStatus: "unknown",
    retrievedAt: T0 + 300_000,
    status: "active",
    ...fields,
  };
}

export const fixtureListings: ProductListing[] = [
  listing("fx_starter_kit", "Beginner Pottery Starter Kit with Air-Dry Clay and Tools", {
    priceMinor: 3_499,
    availability: "in_stock",
  }),
  listing("fx_trim_tools", "Pottery Trimming Tool Set, 8 Piece Stainless Steel", {
    priceMinor: 2_899,
    shippingMinor: 599,
    shippingStatus: "observed",
  }),
  listing("fx_wheel_class", "Intro to Wheel Throwing Pottery Class (4 Sessions)", {
    priceMinor: 9_500,
  }),
  listing("fx_glaze", "Pottery Glaze Sampler, 12 Colors", {
    priceStatus: "unknown",
    shippingStatus: "unresolved",
  }),
  listing("fx_electric_wheel", "Electric Pottery Wheel 350W with Foot Pedal", {
    priceMinor: 21_999,
  }),
  listing("fx_mugs", "Stoneware Coffee Mug Set of 4", { priceMinor: 3_200 }),
  listing("fx_sold_out", "Pottery Apron with Tool Pockets", {
    priceMinor: 2_400,
    availability: "unavailable",
  }),
];

function clue(
  id: string,
  kind: PublishedClue["kind"],
  text: string,
  publisherId: string,
  offsetMs: number,
): PublishedClue {
  return {
    id,
    roomId: FIXTURE_ROOM_ID,
    publisherId,
    kind,
    text,
    sourceKind: "paste",
    sourceMessageIds: [],
    status: "active",
    publishedAt: T0 + offsetMs,
  };
}

export const clueLikesPottery = clue("c_pottery", "interest", "Interested in pottery", "p_alex", 100_000);
export const clueWantsClass = clue(
  "c_class",
  "explicit_wish",
  "Wants to take a wheel-throwing class this year",
  "p_alex",
  110_000,
);
export const clueOwnsStarterKit = clue(
  "c_owns_kit",
  "ownership",
  "Already owns a pottery starter kit",
  "p_jordan",
  200_000,
);

/** Before Jordan publishes the ownership clue. */
export const cluesBeforeOwnership: PublishedClue[] = [clueLikesPottery, clueWantsClass];

/** After Jordan publishes "already owns a pottery starter kit". */
export const cluesAfterOwnership: PublishedClue[] = [
  clueLikesPottery,
  clueWantsClass,
  clueOwnsStarterKit,
];
