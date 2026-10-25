/**
 * Moss voice (MAP-026): who may open a call. Owner: Dev 3.
 *
 * The Next.js route `/api/moss-voice` asks this with the caller's own Convex
 * token before it mints a Moss call pass, so only room members can start a
 * call (and spend the Moss account's minutes). It reads nothing else.
 */
import { v } from "convex/values";
import { query } from "../_generated/server";
import type { Result } from "../../lib/contracts";
import { requireMember } from "../lib/auth";
import { memberError, ok } from "../lib/result";

export const canCall = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<{ participantId: string }>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError(member.code);
    return ok({ participantId: member.me._id });
  },
});
