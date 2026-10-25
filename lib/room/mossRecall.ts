/**
 * Room recall for Moss, the guide (MAP-024). Pure helpers shared by the Convex
 * action and tests: keyword fallback ranking, choosing a friend's memory, and
 * the line Moss says. Moss (the SDK) only ever ranks room-visible memories.
 */

export interface RecallDoc {
  id: string;
  text: string;
  authorId: string;
  author: string;
}

export type RecallMatch = "moss" | "keyword" | "recent";

export interface MossNudgeView {
  clueId: string;
  text: string;
  author: string;
  match: RecallMatch;
  ms: number;
}

/** Most memories a room index holds, newest first. */
export const RECALL_DOC_LIMIT = 256;

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "they", "them", "their", "what", "would", "when", "she", "her", "his", "him",
  "you", "your", "are", "was", "were", "have", "has", "had", "about", "something", "think", "choose", "always", "very",
  "last", "little", "from", "into", "like", "just", "some", "will", "can", "out", "all", "one",
]);

/** Lower-case word stems of 3+ letters, minus filler words. */
export function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    if (STOP.has(raw)) continue;
    out.add(raw.replace(/(ing|ed|es|s)$/, "") || raw);
  }
  return out;
}

/** Docs ranked by shared word stems with the query; only docs with at least one shared stem. */
export function keywordRank(query: string, docs: readonly RecallDoc[]): string[] {
  const q = stems(query);
  return docs
    .map((d, i) => ({ id: d.id, i, score: [...stems(d.text)].filter((w) => q.has(w)).length }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((d) => d.id);
}

/**
 * The first ranked memory shared by someone other than the asker. With no
 * ranked friend memory, the newest friend memory is offered as "recent".
 * Docs are newest first. Returns null when no friend has shared anything.
 */
export function pickNudge(ranked: readonly string[], docs: readonly RecallDoc[], askerId: string, match: Exclude<RecallMatch, "recent">): { doc: RecallDoc; match: RecallMatch } | null {
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const id of ranked) {
    const doc = byId.get(id);
    if (doc && doc.authorId !== askerId) return { doc, match };
  }
  const newest = docs.find((d) => d.authorId !== askerId);
  return newest ? { doc: newest, match: "recent" } : null;
}

/** What Moss says. Quotes the shared memory as written; never adds a claim about the recipient. */
export function nudgeLine(nudge: Pick<MossNudgeView, "author" | "text">): string {
  const text = nudge.text.trim().replace(/[.!?]+$/, "");
  return `${nudge.author} remembered “${text}.” Does that remind you of anything?`;
}

/** Small caption under the line, so the search itself is visible. */
export function matchCaption(nudge: Pick<MossNudgeView, "match" | "ms">): string {
  if (nudge.match === "moss") return `found with Moss · ${Math.max(1, Math.round(nudge.ms))} ms`;
  if (nudge.match === "keyword") return "found by matching words";
  return "a friend’s latest memory";
}
