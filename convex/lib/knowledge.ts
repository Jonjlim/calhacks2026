import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { enqueueKnowledgeTurn } from "../agents/runtime";

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
  return next;
}
