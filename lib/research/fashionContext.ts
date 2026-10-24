import type { FashionAgentContext, PublishedClue } from "../contracts";
import recorded from "./fixtures/tiktok-fashion.json";
import { discoverFashionIdeas, normalizeTikTokPosts } from "./tiktok";
import { isUnconfirmedObservation } from "../../convex/research/text";

const MAX_SAMPLE_AGE_MS = 24 * 60 * 60 * 1000;

/** Demo-only recorded evidence. No external calls or private evidence access. */
export function recordedFashionContext(input: {
  enabled: boolean;
  clues: Array<Pick<PublishedClue, "id" | "kind" | "text" | "status">>;
  now: number;
}): FashionAgentContext | undefined {
  const age = input.now - recorded.context.retrievedAt;
  if (!input.enabled || !Number.isSafeInteger(input.now) || age < 0 || age > MAX_SAMPLE_AGE_MS) return undefined;
  const supportingPublishedClueIds = input.clues.filter(clue =>
    clue.status === "active" && ["interest", "explicit_wish"].includes(clue.kind)
    && !isUnconfirmedObservation(clue.text)
    && /\bvintage\b/i.test(clue.text) && /\bdenim\b/i.test(clue.text),
  ).map(clue => clue.id).sort();
  if (!supportingPublishedClueIds.length) return undefined;
  const context = recorded.context;
  const directions = discoverFashionIdeas(normalizeTikTokPosts(recorded.data, context), context, 3);
  if (!directions.length) return undefined;
  return {
    mode: "recorded_sample",
    label: "Recorded TikTok sample; not live discovery or platform-wide popularity",
    context,
    supportingPublishedClueIds,
    directions,
  };
}
