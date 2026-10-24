/**
 * Identity and membership helpers. Owner: Dev 2 (BE-002).
 *
 * Auth method: Convex Auth, anonymous provider (see convex/auth.ts). Every
 * query and mutation that touches room data must go through `requireMember`
 * (or `getMembership`) first. A room invite token only creates membership; it
 * never unlocks another participant's private rows.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export async function getUserId(ctx: Pick<QueryCtx, "auth">): Promise<string | null> {
  return await getAuthUserId(ctx);
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

export type MemberContext =
  | { ok: true; room: Doc<"rooms">; me: Doc<"participants"> }
  | { ok: false; code: "unauthorized" | "not_found" };

/**
 * Loads the room and the caller's participant row. Missing rooms and
 * non-members both come back as failures; callers map them to AppErrors.
 */
export async function requireMember(ctx: QueryCtx, roomId: Id<"rooms">): Promise<MemberContext> {
  const room = await ctx.db.get(roomId);
  if (!room) return { ok: false, code: "not_found" };
  const me = await getMembership(ctx, roomId);
  if (!me) return { ok: false, code: "unauthorized" };
  return { ok: true, room, me };
}
