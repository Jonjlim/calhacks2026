/**
 * Room-deletion phases for agent collaborator tables, consumed by
 * convex/lib/roomPurge.ts. Collaborators go first: every device call and
 * every twin agent write loads its collaborator and gives up when it is
 * missing, so a late upload or agent run cannot recreate rows behind the
 * purge. Vaulted messages go next, before anything room-visible.
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type Purger = (ctx: MutationCtx, roomId: Id<"rooms">, limit: number) => Promise<number>;

const agentCollaborators: Purger = async (ctx, roomId, limit) => {
  const rows = await ctx.db.query("agentCollaborators").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
};

const twinVaultChunks: Purger = async (ctx, roomId, limit) => {
  const rows = await ctx.db.query("twinVaultChunks").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
};

const agentCollaboratorPosts: Purger = async (ctx, roomId, limit) => {
  const rows = await ctx.db.query("agentCollaboratorPosts").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
};

export const GIFT_TWIN_PURGE_PHASES: ReadonlyArray<readonly [string, Purger]> = [
  ["agentCollaborators", agentCollaborators],
  ["twinVaultChunks", twinVaultChunks],
  ["agentCollaboratorPosts", agentCollaboratorPosts],
];
