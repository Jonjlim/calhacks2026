/**
 * Search provenance for recommendations. Owner: Dev 4. Pure functions.
 * Every research pool comes from exactly one search (provider.start uses the
 * first query term), so each listing in it was found by that query. This says
 * how a listing was found; it never cites a clue or changes a score.
 */
import type { PublishedClue, SearchOrigin } from "../../lib/contracts";
import { shoppingPhrases } from "./text";

export function searchOrigin(input: {
  query: string | undefined;
  clues: Pick<PublishedClue, "id" | "text" | "status">[];
  poolClueIds: string[];
  trendClueId?: string | null;
}): SearchOrigin | undefined {
  const query = input.query?.trim();
  if (!query) return undefined;
  const active = new Set(input.clues.filter((c) => c.status === "active").map((c) => c.id));
  if (input.trendClueId !== undefined && input.trendClueId !== null) {
    return { query, source: "trend", ...(active.has(input.trendClueId) ? { publishedClueId: input.trendClueId } : {}) };
  }
  const pool = new Set(input.poolClueIds);
  const from = input.clues.find((c) => active.has(c.id) && pool.has(c.id) && shoppingPhrases(c.text).includes(query));
  return from ? { query, source: "memory", publishedClueId: from.id } : { query, source: "discovery" };
}

/**
 * A listing no clue names gets a plain account of how it was found. Matched
 * listings already explain themselves; trend finds get their own caption on the map.
 */
export function withSearchNote(
  explanation: string,
  citedClueIds: string[],
  origin: SearchOrigin | undefined,
  clues: Pick<PublishedClue, "id" | "text">[],
): string {
  if (citedClueIds.length || origin?.source !== "memory") return explanation;
  const memory = clues.find((c) => c.id === origin.publishedClueId);
  return memory ? `Found by searching “${origin.query}” from “${memory.text}”. ${explanation}` : explanation;
}
