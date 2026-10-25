/**
 * "How we got here" (D23 trial): the room's decision log for members.
 * Writes happen inside the steps themselves (see convex/lib/trail.ts).
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { memberError, ok } from "./lib/result";

export type TrailEntry = Omit<Doc<"roomTrail">, "_creationTime" | "roomId"> & { who?: string };

export const list = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<TrailEntry[]>(member.code);
    const rows = await ctx.db.query("roomTrail").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(300);
    const names = new Map((await ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .map((p) => [p._id as string, p.displayName]));
    return ok<TrailEntry[]>(rows.reverse().map(({ _creationTime: _, roomId: __, ...row }) => ({
      ...row, ...(row.participantId ? { who: names.get(row.participantId) ?? "A friend" } : {}),
    })));
  },
});
