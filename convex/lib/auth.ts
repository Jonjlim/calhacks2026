/**
 * Identity and membership helpers. Owner: Dev 2 (BE-002).
 *
 * The auth method (anonymous vs email) is a Phase 0 decision. Every query and
 * mutation that touches room data must go through `getMembership` first.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export async function getUserId(ctx: QueryCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

export async function getMembership(
  ctx: QueryCtx,
  roomId: Id<"rooms">,
): Promise<Doc<"participants"> | null> {
  const userId = await getUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("participants")
    .withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId))
    .unique();
}
