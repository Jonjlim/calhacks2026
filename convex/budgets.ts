import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { err, memberError, ok } from "./lib/result";
import { refreshBudgetGuidance } from "./lib/budgets";
import { validBudgetRange } from "../lib/budgets";
import type { MemberBudgetRange } from "../lib/contracts";
export const state = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError(member.code);
    const row = await ctx.db.query("budgetRanges").withIndex("by_room_participant", q => q.eq("roomId", roomId).eq("participantId", member.me._id)).unique();
    const range: MemberBudgetRange | null = row ? { roomId, participantId: row.participantId, minMinor: row.minMinor, maxMinor: row.maxMinor, currency: row.currency, updatedAt: row.updatedAt } : null;
    const members = await ctx.db.query("participants").withIndex("by_room", q => q.eq("roomId", roomId)).collect();
    return ok({ range, guidance: member.room.budgetGuidance ?? null, participantCount: members.length });
  },
});
export const setRange = mutation({
  args: { roomId: v.id("rooms"), minMinor: v.number(), maxMinor: v.number() },
  handler: async (ctx, { roomId, minMinor, maxMinor }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<MemberBudgetRange>(member.code);
    if (!validBudgetRange(minMinor, maxMinor)) return err<MemberBudgetRange>("validation_failed", "Enter a range between $0 and $100,000, with the minimum below the maximum.");
    const row = await ctx.db.query("budgetRanges").withIndex("by_room_participant", q => q.eq("roomId", roomId).eq("participantId", member.me._id)).unique();
    const range: MemberBudgetRange = { roomId, participantId: member.me._id, minMinor, maxMinor, currency: "USD", updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, { minMinor, maxMinor, updatedAt: range.updatedAt });
    else await ctx.db.insert("budgetRanges", { ...range, roomId, participantId: member.me._id });
    await refreshBudgetGuidance(ctx, roomId);
    return ok(range);
  },
});
