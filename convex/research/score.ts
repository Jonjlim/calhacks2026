/**
 * Deterministic recommendation scoring. Owner: Dev 4 (RC-005).
 * score = personalRelevance * 0.7 + budgetFit * 0.2 + trendSignal * 0.1
 * trendSignal stays 0 unless a sourced TrendObservation exists.
 *
 * Ownership and exclusion clues filter listings out entirely. Unknown prices
 * are never treated as fitting the budget. Pure functions: callers pass the
 * room's current active clues so re-ranking needs no new provider run.
 */
import type { ClueKind, ProductListing, PublishedClue } from "../../lib/contracts";
import { formatMinor } from "../../lib/money";
import { cluePhrase, contentTokens } from "./text";

export const SCORE_WEIGHTS = {
  personalRelevance: 0.7,
  budgetFit: 0.2,
  trendSignal: 0.1,
} as const;

export const DEFAULT_RANK_LIMIT = 12;

/** How strongly one fully matching clue of each kind counts toward relevance. */
const CLUE_WEIGHT: Partial<Record<ClueKind, number>> = {
  explicit_wish: 0.8,
  interest: 0.7,
};

/** A clue supports a listing when at least this share of its words appear. */
const SUPPORT_THRESHOLD = 0.5;
const UNKNOWN_PRICE_BUDGET_FIT = 0.5;

export function combineScore(parts: {
  personalRelevance: number;
  budgetFit: number;
  trendSignal: number;
}): number {
  return (
    parts.personalRelevance * SCORE_WEIGHTS.personalRelevance +
    parts.budgetFit * SCORE_WEIGHTS.budgetFit +
    parts.trendSignal * SCORE_WEIGHTS.trendSignal
  );
}

export interface RankedRecommendation {
  listingId: string;
  publishedClueIds: string[];
  score: number;
  personalRelevance: number;
  budgetFit: number;
  trendSignal: 0;
  explanation: string;
}

export interface ExcludedListing {
  listingId: string;
  reason: "excluded_by_clue" | "unavailable" | "inactive";
  clueId?: string;
}

export interface RankListingsInput {
  listings: ProductListing[];
  clues: PublishedClue[];
  budgetMinor?: number;
  limit?: number;
}

/** Splits listings into those eligible for ranking and those filtered out, with reasons. */
export function filterListings(input: Pick<RankListingsInput, "listings" | "clues">): {
  kept: ProductListing[];
  excluded: ExcludedListing[];
} {
  const blocking = input.clues
    .filter((c) => c.status === "active" && (c.kind === "ownership" || c.kind === "exclusion"))
    .map((c) => ({ id: c.id, tokens: contentTokens(cluePhrase(c.text)) }))
    .filter((c) => c.tokens.length > 0);

  const kept: ProductListing[] = [];
  const excluded: ExcludedListing[] = [];

  for (const listing of input.listings) {
    if (listing.status !== "active") {
      excluded.push({ listingId: listing.id, reason: "inactive" });
      continue;
    }
    if (listing.availability === "unavailable") {
      excluded.push({ listingId: listing.id, reason: "unavailable" });
      continue;
    }
    const titleTokens = new Set(listingTokens(listing));
    const hit = blocking.find((c) => blocks(c.tokens, titleTokens));
    if (hit) {
      excluded.push({ listingId: listing.id, reason: "excluded_by_clue", clueId: hit.id });
      continue;
    }
    kept.push(listing);
  }
  return { kept, excluded };
}

export function rankListings(input: RankListingsInput): RankedRecommendation[] {
  const { kept } = filterListings(input);
  const positive = input.clues
    .filter((c) => c.status === "active" && CLUE_WEIGHT[c.kind] !== undefined)
    .map((c) => ({ clue: c, tokens: contentTokens(cluePhrase(c.text)) }))
    .filter((c) => c.tokens.length > 0);

  const ranked = kept.map((listing): RankedRecommendation => {
    const titleTokens = new Set(listingTokens(listing));
    const supporting: PublishedClue[] = [];
    let missProduct = 1;
    for (const { clue, tokens } of positive) {
      const share = tokens.filter((t) => titleTokens.has(t)).length / tokens.length;
      if (share >= SUPPORT_THRESHOLD) {
        supporting.push(clue);
        // Noisy-or: each additional supporting clue raises relevance without exceeding 1.
        missProduct *= 1 - (CLUE_WEIGHT[clue.kind] ?? 0) * share;
      }
    }
    const personalRelevance = round(1 - missProduct);
    const budget = budgetFitFor(listing, input.budgetMinor);
    const parts = { personalRelevance, budgetFit: budget.fit, trendSignal: 0 as const };
    return {
      listingId: listing.id,
      publishedClueIds: supporting.map((c) => c.id),
      score: round(combineScore(parts)),
      ...parts,
      explanation: explain(supporting, budget.note),
    };
  });

  ranked.sort((a, b) => b.score - a.score || a.listingId.localeCompare(b.listingId));
  return ranked.slice(0, Math.max(0, input.limit ?? DEFAULT_RANK_LIMIT));
}

function listingTokens(listing: ProductListing): string[] {
  return contentTokens(`${listing.title} ${listing.variant ?? ""}`);
}

/**
 * The clue's last word is treated as its head noun ("kit" in "pottery starter
 * kit") and must appear, plus two thirds of the remaining words. Otherwise
 * "owns a pottery starter kit" would hide every pottery item, including classes.
 */
function blocks(clueTokens: string[], titleTokens: Set<string>): boolean {
  const head = clueTokens[clueTokens.length - 1];
  if (head === undefined || !titleTokens.has(head)) return false;
  const matched = clueTokens.filter((t) => titleTokens.has(t)).length;
  return matched >= Math.ceil((clueTokens.length * 2) / 3);
}

function budgetFitFor(
  listing: ProductListing,
  budgetMinor: number | undefined,
): { fit: number; note?: string } {
  if (listing.priceStatus !== "observed" || listing.priceMinor === undefined) {
    return { fit: UNKNOWN_PRICE_BUDGET_FIT, note: "price unknown" };
  }
  if (budgetMinor === undefined || budgetMinor <= 0) return { fit: 1 };
  const shipping =
    listing.shippingStatus === "observed" && listing.shippingMinor !== undefined
      ? listing.shippingMinor
      : 0;
  const total = listing.priceMinor + shipping;
  if (total <= budgetMinor) return { fit: 1 };
  const over = total - budgetMinor;
  return {
    fit: round(Math.max(0, 1 - over / budgetMinor)),
    note: `${formatMinor(over)} over budget`,
  };
}

function explain(supporting: PublishedClue[], budgetNote: string | undefined): string {
  const base =
    supporting.length > 0
      ? `Matches: ${supporting.map((c) => `"${c.text}"`).join(", ")}`
      : "No published clue matches this directly";
  return budgetNote ? `${base} (${budgetNote})` : base;
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
