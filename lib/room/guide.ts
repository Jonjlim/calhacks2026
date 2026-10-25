import type { PublishedClue } from "../contracts";
import { isGiftIdea } from "../map/rings";

/** Guidance only observes published, room-visible memories. Private proposals never count. */
export function guideMemories(clues: readonly PublishedClue[]) {
  return clues.filter((c) => c.status === "active" && !isGiftIdea(c.text));
}

/** A connection is named only when the live council actually groups both memories. */
export function sharedGuideTheme(
  ownIds: ReadonlySet<string>, peerId: string,
  themes: readonly { id: string; label: string; clueIds: readonly string[] }[],
) {
  return themes.find((t) => t.clueIds.includes(peerId) && t.clueIds.some((id) => ownIds.has(id))) ?? null;
}

/**
 * The guide teaches the first island, then runs alongside the live room ("live") and pauses
 * exactly once ("connect") when a friend's memory first lands next to yours.
 */
export type GuideStep = "arrival" | "welcome" | "help" | "compose" | "saved" | "live" | "connect";
export function initialGuideStep(saved: string | null, hasMemory: boolean): GuideStep | null {
  if (saved === "done") return null;
  if (hasMemory) return saved === "started" ? "live" : null;
  return "welcome";
}

/** How long the connection pause holds before the room continues on its own. */
export const CONNECT_HOLD_MS = 9000;

export const MOSS_QUESTIONS = [
  { title: "What do they do with an hour to themselves?", label: "Their free time", prompt: "Think of a quiet weekend. What would they choose to do?" },
  { title: "What did they last get excited telling you about?", label: "A recent conversation", prompt: "What were they talking about? A hobby, a place, something they wanted to try…" },
  { title: "What little thing is very them?", label: "A little habit", prompt: "Something they always carry, borrow, make, wear, or talk about…" },
] as const;

export function mossWritingCue(length: number, helped: boolean) {
  if (length === 0) return helped ? "No perfect answer needed. Think of the last time you saw them enjoying something." : "A hobby, a little habit, something they wished for. One sentence is enough.";
  if (length < 18) return "There’s a beginning. Can you add one little detail from a real moment?";
  return "That’s something we can build on. Keep it when it sounds like you.";
}
