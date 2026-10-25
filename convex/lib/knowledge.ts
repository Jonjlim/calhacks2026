import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { enqueueKnowledgeTurn } from "../agents/runtime";
import { enqueueTwinCheck } from "../giftTwin/lib";

/**
 * Bumps room.knowledgeRevision. Call on publish, withdraw, manual clue, and
 * source deletion that touches published clues. Research and agent jobs
 * compare against this to detect stale input.
 */
export async function bumpKnowledgeRevision(ctx: MutationCtx, roomId: Id<"rooms">): Promise<number> {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error("bumpKnowledgeRevision: room missing");
  const next = room.knowledgeRevision + 1;
  await ctx.db.patch(roomId, { knowledgeRevision: next });
  await enqueueKnowledgeTurn(ctx, roomId);
  await enqueueTwinCheck(ctx, roomId);
  // Themes regroup on their own a few seconds after memories change; a later change supersedes this run (D23 trial).
  await ctx.scheduler.runAfter(AUTO_THEME_DELAY_MS, internal.agents.themes.autoRegroup, { roomId, revision: next });
  return next;
}

/** Wait this long after the last memory change, so a burst of memories regroups once (D23 trial). */
export const AUTO_THEME_DELAY_MS = 5_000;
