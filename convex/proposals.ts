/**
 * Gift selection, private contribution limits, proposal revisions, approvals.
 * Owner: Dev 2 (BE-007, BE-008, BE-010, BE-011). Consumer: Dev 1.
 *
 * Invariants:
 *   - Revisions are immutable; any change mints revision n+1 and supersedes n
 *     (see lib/proposalEngine.ts).
 *   - approveRevision fails with `invalid_revision` unless
 *     room.currentRevisionId === revisionId.
 *   - Contribution limits are readable only by their owner and allocations.ts.
 *   - P0 rule: only the organizer confirms the selected gift.
 */
import { v } from "convex/values";
import type { ProposalView } from "../lib/contracts";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { isMoney } from "./lib/input";
import { INFEASIBLE_CAPS_MESSAGE, isEditable, recomputeProposal } from "./lib/proposalEngine";
import { err, memberError, ok } from "./lib/result";
import { toApproval, toLimit, toRevision } from "./lib/views";

async function myLimit(ctx: QueryCtx, roomId: Id<"rooms">, participantId: Id<"participants">) {
  return await ctx.db
    .query("contributionLimits")
    .withIndex("by_room_participant", (q) => q.eq("roomId", roomId).eq("participantId", participantId))
    .unique();
}

/** Members see frozen shares and approvals, plus only their own cap. */
async function buildProposalView(
  ctx: QueryCtx,
  room: Doc<"rooms">,
  me: Doc<"participants">,
): Promise<ProposalView> {
  const revision = room.currentRevisionId ? await ctx.db.get(room.currentRevisionId) : null;
  const approvals = revision
    ? await ctx.db
        .query("approvals")
        .withIndex("by_revision", (q) => q.eq("revisionId", revision._id))
        .collect()
    : [];
  const limit = await myLimit(ctx, room._id, me._id);
  return {
    revision: revision ? toRevision(revision) : null,
    shares: revision ? revision.shares.map((s) => ({ participantId: s.participantId, amountMinor: s.amountMinor })) : [],
    approvals: approvals.map(toApproval),
    feasible: revision !== null && revision.status !== "infeasible",
    myLimit: limit ? toLimit(limit) : undefined,
  };
}

async function roomIsFrozen(ctx: QueryCtx, room: Doc<"rooms">): Promise<boolean> {
  if (!room.currentRevisionId) return false;
  const current = await ctx.db.get(room.currentRevisionId);
  return current !== null && !isEditable(current.status);
}

export const selectGift = mutation({
  args: { roomId: v.id("rooms"), listingId: v.id("productListings") },
  handler: async (ctx, { roomId, listingId }) => {
    type Out = { selection: Doc<"giftSelections">; revision?: Doc<"proposalRevisions"> };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Out>(member.code);
    if (member.me.role !== "organizer") {
      return err<Out>("unauthorized", "Only the organizer can confirm the gift.");
    }
    if (await roomIsFrozen(ctx, member.room)) {
      return err<Out>("invalid_revision", "The current proposal is locked for payment.");
    }
    const listing = await ctx.db.get(listingId);
    if (!listing || listing.roomId !== roomId) return err<Out>("not_found", "Listing not found.");
    if (listing.status === "invalid") return err<Out>("not_found", "That listing is no longer available.");
    if (listing.currency !== "USD") return err<Out>("validation_failed", "Only USD listings are supported.");

    const now = Date.now();
    const current = member.room.currentSelectionId ? await ctx.db.get(member.room.currentSelectionId) : null;
    let selectionId: Id<"giftSelections">;
    if (current && current.status === "active" && current.listingId === listingId) {
      selectionId = current._id;
    } else {
      if (current && current.status === "active") await ctx.db.patch(current._id, { status: "cleared" });
      selectionId = await ctx.db.insert("giftSelections", {
        roomId,
        listingId,
        quantity: 1,
        listingSnapshot: {
          title: listing.title,
          sourceUrl: listing.sourceUrl,
          priceMinor: listing.priceMinor,
          priceStatus: listing.priceStatus,
          retrievedAt: listing.retrievedAt,
        },
        status: "active",
        selectedBy: member.me._id,
        selectedAt: now,
      });
      await ctx.db.patch(roomId, { currentSelectionId: selectionId });
    }

    const recomputed = await recomputeProposal(ctx, roomId);
    const selection = (await ctx.db.get(selectionId))!;
    return ok<Out>(recomputed.revision ? { selection, revision: recomputed.revision } : { selection });
  },
});

/** Organizer takes the gift out of the box. Supersedes the current revision. */
export const clearSelection = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<null>(member.code);
    if (member.me.role !== "organizer") return err<null>("unauthorized", "Only the organizer can change the gift.");
    if (await roomIsFrozen(ctx, member.room)) {
      return err<null>("invalid_revision", "The current proposal is locked for payment.");
    }
    const current = member.room.currentSelectionId ? await ctx.db.get(member.room.currentSelectionId) : null;
    if (current && current.status === "active") await ctx.db.patch(current._id, { status: "cleared" });
    await ctx.db.patch(roomId, { currentSelectionId: undefined });
    await recomputeProposal(ctx, roomId);
    return ok(null);
  },
});

/**
 * RC-007 hook for Dev 4: call after marking a listing `invalid` so any active
 * selection of it is cleared and its proposal superseded.
 */
export const clearSelectionsForListing = internalMutation({
  args: { listingId: v.id("productListings") },
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return ok({ cleared: 0 });
    const room = await ctx.db.get(listing.roomId);
    if (!room?.currentSelectionId) return ok({ cleared: 0 });
    const selection = await ctx.db.get(room.currentSelectionId);
    if (!selection || selection.status !== "active" || selection.listingId !== listingId) return ok({ cleared: 0 });
    if (await roomIsFrozen(ctx, room)) return err<{ cleared: number }>("invalid_revision", "Proposal is locked.");
    await ctx.db.patch(selection._id, { status: "cleared" });
    await ctx.db.patch(room._id, { currentSelectionId: undefined });
    await recomputeProposal(ctx, room._id);
    return ok({ cleared: 1 });
  },
});

/** Current active selection for the shared box (room-visible). */
export const getSelection = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Doc<"giftSelections"> | null>(member.code);
    const selection = member.room.currentSelectionId ? await ctx.db.get(member.room.currentSelectionId) : null;
    return ok(selection && selection.status === "active" ? selection : null);
  },
});

export const setContributionLimit = mutation({
  args: { roomId: v.id("rooms"), amountMinor: v.number() },
  handler: async (ctx, { roomId, amountMinor }) => {
    type Out = { limit: Doc<"contributionLimits">; revision?: Doc<"proposalRevisions"> };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Out>(member.code);
    if (!isMoney(amountMinor)) {
      return err<Out>("validation_failed", "Limit must be a whole number of cents, zero or more.");
    }
    if (await roomIsFrozen(ctx, member.room)) {
      return err<Out>("invalid_revision", "The current proposal is locked for payment.");
    }

    const now = Date.now();
    const existing = await myLimit(ctx, roomId, member.me._id);
    let limitId: Id<"contributionLimits">;
    if (existing) {
      await ctx.db.patch(existing._id, { amountMinor, updatedAt: now });
      limitId = existing._id;
    } else {
      limitId = await ctx.db.insert("contributionLimits", {
        roomId,
        participantId: member.me._id,
        amountMinor,
        updatedAt: now,
      });
    }

    const recomputed = await recomputeProposal(ctx, roomId);
    const limit = (await ctx.db.get(limitId))!;
    return ok<Out>(recomputed.revision ? { limit, revision: recomputed.revision } : { limit });
  },
});

/** Owner-only read of the caller's own cap. */
export const getMyContributionLimit = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Doc<"contributionLimits"> | null>(member.code);
    return ok(await myLimit(ctx, roomId, member.me._id));
  },
});

/**
 * Ensures the current revision reflects the selection and caps. Idempotent:
 * returns the existing revision when nothing material changed. Returns
 * `infeasible` (after recording the infeasible revision) when caps fall short.
 */
export const createProposal = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<ProposalView>(member.code);
    const result = await recomputeProposal(ctx, roomId);
    if (result.kind === "no_selection") return err<ProposalView>("not_found", "Put a gift in the box first.");
    if (result.revision.status === "infeasible") {
      return err<ProposalView>("infeasible", result.revision.conditions[0] ?? INFEASIBLE_CAPS_MESSAGE);
    }
    const room = (await ctx.db.get(roomId))!;
    return ok(await buildProposalView(ctx, room, member.me));
  },
});

/** Mock: lib/mocks/queries.ts proposalQuery. */
export const getProposal = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<ProposalView>(member.code);
    return ok(await buildProposalView(ctx, member.room, member.me));
  },
});

/** Revision history for the room, newest first (frozen shares only, never caps). */
export const listRevisions = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Doc<"proposalRevisions">[]>(member.code);
    const revisions = await ctx.db
      .query("proposalRevisions")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .order("desc")
      .take(20);
    return ok(revisions);
  },
});

async function loadApprovalTarget(ctx: QueryCtx, revisionId: Id<"proposalRevisions">) {
  const revision = await ctx.db.get(revisionId);
  if (!revision) return { ok: false as const, error: err<Doc<"approvals">>("not_found", "Revision not found.") };
  const member = await requireMember(ctx, revision.roomId);
  if (!member.ok) return { ok: false as const, error: memberError<Doc<"approvals">>(member.code) };
  if (member.room.currentRevisionId !== revisionId) {
    return {
      ok: false as const,
      error: err<Doc<"approvals">>("invalid_revision", "This proposal changed. Review the latest revision."),
    };
  }
  const approval = await ctx.db
    .query("approvals")
    .withIndex("by_revision_participant", (q) => q.eq("revisionId", revisionId).eq("participantId", member.me._id))
    .unique();
  return { ok: true as const, revision, member, approval };
}

export const approveRevision = mutation({
  args: { revisionId: v.id("proposalRevisions") },
  handler: async (ctx, { revisionId }) => {
    const target = await loadApprovalTarget(ctx, revisionId);
    if (!target.ok) return target.error;
    const { revision, approval } = target;
    if (revision.status === "infeasible") {
      return err<Doc<"approvals">>("infeasible", revision.conditions[0] ?? INFEASIBLE_CAPS_MESSAGE);
    }
    if (revision.status !== "awaiting_approval" && revision.status !== "approved_pledged") {
      return err<Doc<"approvals">>("invalid_revision", "This revision is not collecting approvals.");
    }
    if (!approval) return err<Doc<"approvals">>("unauthorized", "You do not have a share in this revision.");
    if (approval.status === "approved") return ok(approval);
    if (approval.status === "invalidated") {
      return err<Doc<"approvals">>("invalid_revision", "This approval was invalidated.");
    }

    await ctx.db.patch(approval._id, { status: "approved", updatedAt: Date.now() });
    const all = await ctx.db
      .query("approvals")
      .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
      .collect();
    if (all.every((a) => a.status === "approved")) {
      await ctx.db.patch(revisionId, { status: "approved_pledged" });
    }
    return ok((await ctx.db.get(approval._id))!);
  },
});

/** Participant takes back their approval on the current revision. */
export const withdrawApproval = mutation({
  args: { revisionId: v.id("proposalRevisions") },
  handler: async (ctx, { revisionId }) => {
    const target = await loadApprovalTarget(ctx, revisionId);
    if (!target.ok) return target.error;
    const { revision, approval } = target;
    if (revision.status !== "awaiting_approval" && revision.status !== "approved_pledged") {
      return err<Doc<"approvals">>("invalid_revision", "This revision is not collecting approvals.");
    }
    if (!approval) return err<Doc<"approvals">>("unauthorized", "You do not have a share in this revision.");
    if (approval.status !== "approved") return ok(approval);
    await ctx.db.patch(approval._id, { status: "withdrawn", updatedAt: Date.now() });
    if (revision.status === "approved_pledged") await ctx.db.patch(revisionId, { status: "awaiting_approval" });
    return ok((await ctx.db.get(approval._id))!);
  },
});
