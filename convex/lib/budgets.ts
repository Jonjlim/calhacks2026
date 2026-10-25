import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { groupBudgetGuidance } from "../../lib/budgets";
export async function refreshBudgetGuidance(ctx: MutationCtx, roomId: Id<"rooms">) {
  const members = await ctx.db.query("participants").withIndex("by_room", q => q.eq("roomId", roomId)).collect();
  const ids = new Set(members.map(m => m._id));
  const ranges = await ctx.db.query("budgetRanges").withIndex("by_room", q => q.eq("roomId", roomId)).collect();
  await ctx.db.patch(roomId, { budgetGuidance: groupBudgetGuidance(ranges.filter(r => ids.has(r.participantId)), members.length) });
}
