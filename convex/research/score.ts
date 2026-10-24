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
import { hasProductImageUrl } from "../../lib/research/images";
import {
  cluePhrase, contentTokens, isHandsOnItem, isUnconfirmedObservation, shoppingMatchTokens, shoppingPhrase,
  withoutBrandPhrases,
} from "./text";

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

/** Longer preferences permit partial matches; short preferences require every term. */
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
    .filter((c) => c.status === "active" && !isUnconfirmedObservation(c.text)
      && (c.kind === "ownership" || c.kind === "exclusion"))
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
    .filter((c) => c.status === "active" && !isUnconfirmedObservation(c.text) && CLUE_WEIGHT[c.kind] !== undefined)
    .map((c) => ({ clue: c, tokens: shoppingMatchTokens(shoppingPhrase(c.text)) }))
    .filter((c) => c.tokens.length > 0);

  const ranked = kept.map((listing): RankedRecommendation => {
    const titleTokens = new Set(shoppingMatchTokens(withoutBrandPhrases(listing.title + " " + (listing.variant ?? ""))));
    const supporting: PublishedClue[] = [];
    const matchedPreferences = new Map<string, number>();
    for (const { clue, tokens } of positive) {
      const share = tokens.filter((t) => titleTokens.has(t)).length / tokens.length;
      const threshold = tokens.length <= 3 ? 1 : SUPPORT_THRESHOLD;
      if (share >= threshold) {
        supporting.push(clue);
        // Repeated photos/phrases are not independent preference evidence.
        const key = [...tokens].sort().join("|");
        const strength = (CLUE_WEIGHT[clue.kind] ?? 0) * share;
        matchedPreferences.set(key, Math.max(matchedPreferences.get(key) ?? 0, strength));
      }
    }
    const missProduct = [...matchedPreferences.values()].reduce((miss, strength) => miss * (1 - strength), 1);
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

  const images = new Map(kept.map(listing => [listing.id, hasProductImageUrl(listing)]));
  const handsOn = new Map(kept.map(listing => [listing.id, isHandsOnItem(`${listing.title} ${listing.variant ?? ""}`)]));
  ranked.sort((a, b) => b.score - a.score
    || b.personalRelevance - a.personalRelevance
    || b.budgetFit - a.budgetFit
    || Number(handsOn.get(b.listingId)) - Number(handsOn.get(a.listingId))
    || Number(images.get(b.listingId)) - Number(images.get(a.listingId))
    || a.listingId.localeCompare(b.listingId));
  return ranked.slice(0, Math.max(0, input.limit ?? DEFAULT_RANK_LIMIT));
}

function listingTokens(listing: ProductListing): string[] {
  return contentTokens(`${listing.title} ${listing.variant ?? ""}`);
}

/**
 * Short clues (up to three words, e.g. "pottery starter kit") must match every
 * word, so owning a starter kit hides starter kits but keeps tool kits and
 * classes. Longer clues need their last word (usually the head noun) plus two
 * thirds of the rest, so wordy clues still block close matches.
 */
function blocks(clueTokens: string[], titleTokens: Set<string>): boolean {
  const head = clueTokens[clueTokens.length - 1];
  if (head === undefined || !titleTokens.has(head)) return false;
  const matched = clueTokens.filter((t) => titleTokens.has(t)).length;
  if (clueTokens.length <= 3) return matched === clueTokens.length;
  return matched >= Math.ceil((clueTokens.length * 2) / 3);
}

/**
 * Ranking signal only. A neutral 0.5 for unknown prices orders results; it
 * never establishes affordability or proposal feasibility.
 */
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
