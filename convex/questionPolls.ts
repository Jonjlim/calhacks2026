/** Group steering only. A vote is never published as a recipient fact. */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { err, memberError, ok } from "./lib/result";
import { logTrail } from "./lib/trail";
import type { QuestionPollView, Result } from "../lib/contracts";

export async function pollMembers(ctx: QueryCtx, roomId: Id<"rooms">) {
  return ctx.db.query("participants").withIndex("by_room", q => q.eq("roomId", roomId)).collect();
}
export function pollSummary(row: Doc<"mapSharpens">, memberIds: Set<string>, myId: string) {
  const ballots = (row.ballots ?? []).filter(b => memberIds.has(b.participantId));
  const counts = row.options.map((_, i) => ballots.filter(b => b.option === i).length);
  const highest = Math.max(0, ...counts);
  const leaders = counts.flatMap((count, i) => count === highest && count > 0 ? [i] : []);
  return { questionId: row._id, counts, votedCount: ballots.length, memberCount: memberIds.size,
    myOption: ballots.find(b => b.participantId === myId)?.option ?? null,
    leader: leaders.length === 1 ? leaders[0]! : null, tied: leaders.length > 1,
  };
}

export const state = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<QuestionPollView | null>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError(member.code);
    const row = await ctx.db.query("mapSharpens").withIndex("by_room", q => q.eq("roomId", roomId)).order("desc").first();
    if (!row || row.status === "dismissed") return ok(null);
    const summary = pollSummary(row, new Set((await pollMembers(ctx, roomId)).map(p => p._id)), member.me._id);
    const stale = row.knowledgeRevision !== member.room.knowledgeRevision;
    return ok({ ...summary, stale, open: row.status === "open",
      canFinish: row.status === "open" && !stale && summary.leader !== null && member.me.role === "organizer" });
  },
});

export const vote = mutation({
  args: { questionId: v.id("mapSharpens"), option: v.union(v.number(), v.null()) },
  handler: async (ctx, { questionId, option }): Promise<Result<ReturnType<typeof pollSummary>>> => {
    const row = await ctx.db.get(questionId);
    if (!row) return err("not_found", "That question is gone.");
    const member = await requireMember(ctx, row.roomId);
    if (!member.ok) return memberError(member.code);
    const latest = await ctx.db.query("mapSharpens").withIndex("by_room", q => q.eq("roomId", row.roomId)).order("desc").first();
    if (row.status !== "open" || latest?._id !== questionId) return err("invalid_revision", "This question is closed or has been replaced.");
    if (row.knowledgeRevision !== member.room.knowledgeRevision) return err("stale_job", "Memories changed. Ask a fresh question.");
    if (option !== null && (!Number.isInteger(option) || option < 0 || option >= row.options.length))
      return err("validation_failed", "Choose one of the question's answers.");
    const members = new Set((await pollMembers(ctx, row.roomId)).map(p => p._id));
    const before = (row.ballots ?? []).find(b => b.participantId === member.me._id)?.option ?? null;
    if (before === option) return ok(pollSummary(row, members, member.me._id));
    const ballots = (row.ballots ?? []).filter(b => b.participantId !== member.me._id && members.has(b.participantId));
    if (option !== null) {
      if (ballots.length >= 2000) return err("refused", "This question has reached its participant limit.");
      ballots.push({ participantId: member.me._id, option, updatedAt: Date.now() });
    }
    await ctx.db.patch(questionId, { ballots });
    await logTrail(ctx, row.roomId, { stage: "steering", actor: "person", participantId: member.me._id, outcome: "info",
      ...(row.directionId ? { directionId: row.directionId } : {}),
      text: option === null ? `${member.me.displayName || "A friend"} withdrew their question vote.`
        : `${member.me.displayName || "A friend"} voted “${row.options[option]!.label}” on “${row.question}”. This steers gifts; it is not a confirmed memory.` });
    return ok(pollSummary({ ...row, ballots }, members, member.me._id));
  },
});

export const finish = mutation({
  args: { questionId: v.id("mapSharpens") },
  handler: async (ctx, { questionId }): Promise<Result<ReturnType<typeof pollSummary>>> => {
    const row = await ctx.db.get(questionId);
    if (!row) return err("not_found", "That question is gone.");
    const member = await requireMember(ctx, row.roomId);
    if (!member.ok) return memberError(member.code);
    if (member.me.role !== "organizer") return err("unauthorized", "Only the organizer can finish the question.");
    const latest = await ctx.db.query("mapSharpens").withIndex("by_room", q => q.eq("roomId", row.roomId)).order("desc").first();
    if (row.status !== "open" || latest?._id !== row._id) return err("invalid_revision", "This question is no longer open.");
    if (row.knowledgeRevision !== member.room.knowledgeRevision) return err("stale_job", "Memories changed. Ask a fresh question.");
    const summary = pollSummary(row, new Set((await pollMembers(ctx, row.roomId)).map(p => p._id)), member.me._id);
    if (summary.leader === null) return err("infeasible", "No clear answer yet. Keep voting or skip the question.");
    await ctx.db.patch(questionId, { status: "answered", answer: summary.leader, answeredBy: member.me._id });
    await logTrail(ctx, row.roomId, { stage: "steering", actor: "person", participantId: member.me._id, outcome: "info",
      text: `The room chose “${row.options[summary.leader]!.label}” with ${summary.counts[summary.leader]} of ${summary.votedCount} votes. No recipient fact was published.` });
    return ok(summary);
  },
});
