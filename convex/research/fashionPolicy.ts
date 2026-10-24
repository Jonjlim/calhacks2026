import type { PublishedClue } from "../../lib/contracts";
import { STYLE_CATEGORIES } from "../../lib/research/styleCategories";
import { isUnconfirmedObservation } from "./text";

export const FASHION_SAMPLE_TTL_MS = 24 * 60 * 60 * 1000;
/** One seed per request (one paid run). The category with the most confirmed clues wins; ties keep table order. */
export function fashionSeed(clues: Array<Pick<PublishedClue, "id" | "kind" | "text" | "status">>) {
  const confirmed = clues.filter(c => c.status === "active" && ["interest", "explicit_wish"].includes(c.kind)
    && !isUnconfirmedObservation(c.text) && !/^maybe\b/i.test(c.text.trim()));
  let best: { baseSeed: string; matching: typeof confirmed } | null = null;
  for (const category of STYLE_CATEGORIES) {
    const matching = confirmed.filter(c => category.cluePattern.test(c.text));
    if (matching.length && (!best || matching.length > best.matching.length)) best = { baseSeed: category.baseSeed, matching };
  }
  if (!best) return null;
  const vintage = best.matching.some(c => /\bvintage\b/i.test(c.text));
  const supporting = best.matching.filter(c => !vintage || /\bvintage\b/i.test(c.text));
  return { seedTerm: vintage ? `vintage ${best.baseSeed}` : best.baseSeed, supportingPublishedClueIds: supporting.map(c => c.id).sort() };
}
export function isFashionSampleFresh(retrievedAt: number, now: number): boolean {
  return Number.isSafeInteger(retrievedAt) && Number.isSafeInteger(now) && retrievedAt > 0
    && now >= retrievedAt && now - retrievedAt <= FASHION_SAMPLE_TTL_MS;
}
