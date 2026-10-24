import type { PublishedClue } from "../../lib/contracts";
import { isUnconfirmedObservation } from "./text";

export const FASHION_SAMPLE_TTL_MS = 24 * 60 * 60 * 1000;
export function fashionSeed(clues: Array<Pick<PublishedClue, "id" | "kind" | "text" | "status">>) {
  const matching = clues.filter(c => c.status === "active" && ["interest", "explicit_wish"].includes(c.kind)
    && !isUnconfirmedObservation(c.text) && !/^maybe\b/i.test(c.text.trim()) && /\bdenim\b/i.test(c.text));
  if (!matching.length) return null;
  const vintage = matching.some(c => /\bvintage\b/i.test(c.text));
  const supporting = matching.filter(c => !vintage || /\bvintage\b/i.test(c.text));
  return { seedTerm: vintage ? "vintage denim outfit" : "denim outfit", supportingPublishedClueIds: supporting.map(c => c.id).sort() };
}
export function isFashionSampleFresh(retrievedAt: number, now: number): boolean {
  return Number.isSafeInteger(retrievedAt) && Number.isSafeInteger(now) && retrievedAt > 0
    && now >= retrievedAt && now - retrievedAt <= FASHION_SAMPLE_TTL_MS;
}
