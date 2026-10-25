/**
 * Search provenance for recommendations. Owner: Dev 4. Pure functions.
 * Every research pool comes from exactly one search (provider.start uses the
 * first query term), so each listing in it was found by that query. This says
 * how a listing was found; it never cites a clue or changes a score.
 */
import type { PublishedClue, SearchOrigin } from "../../lib/contracts";
import { contentTokens, shoppingPhrases } from "./text";

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
  const pool = input.clues.filter((c) => active.has(c.id) && input.poolClueIds.includes(c.id));
  const from = pool.find((c) => shoppingPhrases(c.text).includes(query)) ?? containedIn(query, pool);
  return from ? { query, source: "memory", publishedClueId: from.id } : { query, source: "discovery" };
}

// Words a search adds around a memory ("hiking gifts", "matcha gift ideas") that say nothing about it.
const GENERIC = new Set(["gift", "idea", "present", "birthday", "best", "unique", "cool", "fun", "cute"]);

/**
 * A query written around a memory (the buyer agent writes "hiking gifts") is
 * credited to the memory whose every search word it contains; the most
 * specific memory wins. Nothing is credited when no memory is fully inside.
 */
function containedIn<C extends Pick<PublishedClue, "text">>(query: string, clues: C[]): C | undefined {
  const words = new Set(contentTokens(query).filter((w) => !GENERIC.has(w)));
  let best: { clue: C; size: number } | undefined;
  for (const clue of clues) {
    for (const phrase of shoppingPhrases(clue.text)) {
      const need = contentTokens(phrase).filter((w) => !GENERIC.has(w));
      if (need.length && need.every((w) => words.has(w)) && need.length > (best?.size ?? 0)) best = { clue, size: need.length };
    }
  }
  return best?.clue;
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
