/** The one-line reveal summary (D26). Pure. Numbers come from story.summary; nothing is estimated. */
export interface SentenceStats { memories: number; directions: number; thrownOut: number; searches: number; products: number; votes: number }

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function storySentence(s: SentenceStats, { gifts = 1 }: { gifts?: number } = {}): string {
  const parts = [`The council read ${n(s.memories, "memory", "memories")}`];
  if (s.directions) parts.push(`proposed ${n(s.directions, "direction")}${s.thrownOut ? ` and threw out ${s.thrownOut}` : ""}`);
  else if (s.thrownOut) parts.push(`threw out ${n(s.thrownOut, "idea")}`);
  if (s.searches) parts.push(`searched ${n(s.searches, "time")} across ${n(s.products, "product")}`);
  const head = parts.length > 2 ? `${parts.slice(0, -1).join(", ")}, ${parts.at(-1)}` : parts.join(" and ");
  const votes = s.votes ? `; your group voted ${n(s.votes, "time")}` : "";
  return `${head}${votes} → ${gifts > 1 ? "these gifts" : "this gift"}.`;
}
