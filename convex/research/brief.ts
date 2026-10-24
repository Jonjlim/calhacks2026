/**
 * Published clues → SearchBrief, in plain code. Owner: Dev 4.
 * Dev 3 may replace this with a model-generated brief that keeps the same
 * signature. Positive clues become query terms; ownership and exclusion clues
 * become terms the search and ranking must avoid.
 */
import type { PublishedClue, SearchBrief } from "../../lib/contracts";
import { cluePhrase, isUnconfirmedObservation, shoppingPhrase } from "./text";

export const DEFAULT_LISTING_LIMIT = 12;
const MAX_LISTING_LIMIT = 24;
const MAX_QUERY_TERMS = 3;

export type BriefClue = Pick<PublishedClue, "id" | "kind" | "text" | "status">;

export interface BuildSearchBriefInput {
  roomId: string;
  knowledgeRevision: number;
  clues: BriefClue[];
  budgetMinor?: number;
  occasion?: string;
  listingLimit?: number;
}

/**
 * An empty `queryTerms` means there is nothing to search for yet; the caller
 * should not start a provider run rather than invent a generic query.
 */
export function buildSearchBrief(input: BuildSearchBriefInput): SearchBrief {
  const active = input.clues.filter((c) => c.status === "active" && !isUnconfirmedObservation(c.text));
  // Explicit wishes are stronger signals than general interests, so they lead.
  const positive = [
    ...active.filter((c) => c.kind === "explicit_wish"),
    ...active.filter((c) => c.kind === "interest"),
  ];
  const negative = active.filter((c) => c.kind === "ownership" || c.kind === "exclusion");

  const limit = Math.min(
    MAX_LISTING_LIMIT,
    Math.max(1, Math.floor(input.listingLimit ?? DEFAULT_LISTING_LIMIT)),
  );

  return {
    roomId: input.roomId,
    knowledgeRevision: input.knowledgeRevision,
    queryTerms: uniquePhrases(positive, true).slice(0, MAX_QUERY_TERMS),
    mustExclude: uniquePhrases(negative),
    ...(input.budgetMinor !== undefined && { budgetMinor: input.budgetMinor }),
    ...(input.occasion !== undefined && { occasion: input.occasion }),
    listingLimit: limit,
  };
}

function uniquePhrases(clues: BriefClue[], positive = false): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const c of clues) {
    const phrase = positive ? shoppingPhrase(c.text) : cluePhrase(c.text);
    if (phrase && !seen.has(phrase)) {
      seen.add(phrase);
      phrases.push(phrase);
    }
  }
  return phrases;
}
