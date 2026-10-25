/** Human-operated, shared demo state. Makes no provider calls or real money-state writes. */
import { v } from "convex/values";
import type { ContributionSimulationView, Result } from "../../lib/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { requireMember } from "../lib/auth";
import { err, memberError, ok } from "../lib/result";

async function project(ctx: QueryCtx, room: Doc<"rooms">, me: Doc<"participants">) {
  const revision = room.currentRevisionId ? await ctx.db.get(room.currentRevisionId) : null;
  const empty: ContributionSimulationView = { mode: "simulation", revisionId: revision?._id ?? null,
    status: "no_proposal", payerCount: 0, completedCount: 0, myShareMinor: 0,
    myCompleted: false, canSimulate: false, canWrap: false };
  if (!revision || revision.roomId !== room._id) return { view: empty, fingerprint: "", row: null };
  const payers = revision.shares.filter(s => s.amountMinor > 0);
  const approvals = await ctx.db.query("approvals").withIndex("by_revision", q => q.eq("revisionId", revision._id)).collect();
  const approved = revision.status === "approved_pledged" && revision.shares.length > 0
    && revision.shares.every(s => approvals.some(a => a.participantId === s.participantId && a.status === "approved"));
  const fingerprint = JSON.stringify(approvals.map(a => [a._id, a.participantId, a.status, a.updatedAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const row = await ctx.db.query("paymentSimulations").withIndex("by_revision", q => q.eq("revisionId", revision._id)).unique();
  const current = approved && row?.roomId === room._id && row.approvalFingerprint === fingerprint ? row : null;
  const completed = new Set(current?.completedParticipantIds ?? []);
  const completedCount = payers.filter(s => completed.has(s.participantId)).length;
  const myShareMinor = payers.find(s => s.participantId === me._id)?.amountMinor ?? 0;
  const allDone = approved && payers.length > 0 && completedCount === payers.length;
  const waiting = revision.status === "awaiting_approval" || revision.status === "approved_pledged";
  const status: ContributionSimulationView["status"] = !approved ? (waiting ? "waiting_for_approvals" : "unavailable")
    : current?.wrappedAt !== undefined && allDone ? "wrapped" : allDone ? "complete" : completedCount ? "collecting" : "ready";
  return { view: { ...empty, revisionId: revision._id, status, payerCount: payers.length, completedCount,
    myShareMinor, myCompleted: approved && completed.has(me._id),
    canSimulate: approved && myShareMinor > 0 && !completed.has(me._id),
    canWrap: allDone && me.role === "organizer" && current?.wrappedAt === undefined,
  }, fingerprint, row };
}

export const getState = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<ContributionSimulationView>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError(member.code);
    return ok((await project(ctx, member.room, member.me)).view);
  },
});

export const simulateContribution = mutation({
  args: { roomId: v.id("rooms"), revisionId: v.id("proposalRevisions") },
  handler: async (ctx, { roomId, revisionId }): Promise<Result<ContributionSimulationView>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError(member.code);
    if (member.room.currentRevisionId !== revisionId) return err("invalid_revision", "This proposal changed. Review the new revision.");
    const p = await project(ctx, member.room, member.me);
    if (p.view.status === "waiting_for_approvals" || p.view.status === "unavailable")
      return err("invalid_revision", "Everyone must approve the current pledged revision before the simulation.");
    if (!p.view.myShareMinor) return err("refused", "Your share is zero; no simulated payment is needed.");
    if (p.view.myCompleted) return ok(p.view);
    const completed = p.row?.approvalFingerprint === p.fingerprint ? p.row.completedParticipantIds : [];
    const fields = { approvalFingerprint: p.fingerprint, completedParticipantIds: [...completed, member.me._id], wrappedAt: undefined };
    if (p.row) await ctx.db.patch(p.row._id, fields);
    else await ctx.db.insert("paymentSimulations", { roomId, revisionId, ...fields, createdAt: Date.now() });
    return ok((await project(ctx, member.room, member.me)).view);
  },
});

export const wrapGift = mutation({
  args: { roomId: v.id("rooms"), revisionId: v.id("proposalRevisions") },
  handler: async (ctx, { roomId, revisionId }): Promise<Result<ContributionSimulationView>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError(member.code);
    if (member.me.role !== "organizer") return err("unauthorized", "Only the organizer wraps the demo gift.");
    if (member.room.currentRevisionId !== revisionId) return err("invalid_revision", "This proposal changed. Review the new revision.");
    const p = await project(ctx, member.room, member.me);
    if (p.view.status === "wrapped") return ok(p.view);
    if (!p.view.canWrap || !p.row) return err("refused", "Every payer must complete their simulated contribution first.");
    await ctx.db.patch(p.row._id, { wrappedAt: Date.now() });
    return ok((await project(ctx, member.room, member.me)).view);
  },
});
