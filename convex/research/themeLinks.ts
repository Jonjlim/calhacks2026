/** MAP-011: computed links only. Callers establish membership before projecting a room. */
import type { MapTheme, PublishedClue, Recommendation } from "../../lib/contracts";

export function recommendationThemeIds(input: {
  roomId: string;
  knowledgeRevision: number;
  recommendation: Pick<Recommendation, "roomId" | "publishedClueIds">;
  themes: MapTheme[];
  clues: Pick<PublishedClue, "id" | "roomId" | "status">[];
}): string[] {
  if (input.recommendation.roomId !== input.roomId) return [];
  const active = new Set(input.clues.filter(c => c.roomId === input.roomId && c.status === "active").map(c => c.id));
  const cited = new Set(input.recommendation.publishedClueIds.filter(id => active.has(id)));
  return [...new Set(input.themes.filter(theme => theme.roomId === input.roomId
    && theme.knowledgeRevision === input.knowledgeRevision
    && (theme.status === "suggested" || theme.status === "accepted")
    && theme.clueIds.length > 0 && theme.clueIds.every(id => active.has(id))
    && theme.clueIds.some(id => cited.has(id))).map(theme => theme.id))].sort();
}
