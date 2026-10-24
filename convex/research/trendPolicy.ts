import type { PublishedClue } from "../../lib/contracts";
import { isUnconfirmedObservation, shoppingPhrase } from "./text";

export const TREND_SAMPLE_TTL_MS = 24 * 60 * 60 * 1000;
// Letters only: no digits keeps addresses, phone numbers and dates out of the query.
const SEED = /^[a-z]+(?: [a-z]+){0,3}$/;

export function isSafeTrendSeed(seed: string): boolean {
  return seed.length <= 40 && SEED.test(seed);
}

/**
 * Derives the public Google Trends phrase for one confirmed published interest/wish.
 * Phrases containing a participant or recipient name token are refused, not rewritten.
 */
export function trendSeed(clue: Pick<PublishedClue, "kind" | "text" | "status">, blockedNames: string[]): string | null {
  if (clue.status !== "active" || !["interest", "explicit_wish"].includes(clue.kind)
    || isUnconfirmedObservation(clue.text) || /^maybe\b/i.test(clue.text.trim())) return null;
  const seed = shoppingPhrase(clue.text).replace(/\s+/g, " ").trim();
  if (!isSafeTrendSeed(seed)) return null;
  const blocked = new Set(blockedNames.flatMap(name => name.toLowerCase().match(/[a-z]+/g) ?? []).filter(token => token.length > 1));
  return seed.split(" ").some(token => blocked.has(token)) ? null : seed;
}

export function isTrendSampleFresh(retrievedAt: number, now: number): boolean {
  return Number.isSafeInteger(retrievedAt) && Number.isSafeInteger(now) && retrievedAt > 0
    && now >= retrievedAt && now - retrievedAt <= TREND_SAMPLE_TTL_MS;
}
