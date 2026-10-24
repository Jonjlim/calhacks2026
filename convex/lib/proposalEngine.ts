/**
 * Proposal revision engine. Owner: Dev 2 (BE-010, BE-011).
 *
 * `recomputeProposal` is the only writer of proposalRevisions. It derives the
 * would-be revision from the active selection, the listing observation, the
 * participant list, and private caps. If anything material differs from the
 * current revision (listing, payable total, any share, feasibility) it mints
 * revision n+1, supersedes n, and invalidates n's approvals. Otherwise it is a
 * no-op, so callers can run it after any input change.
 */
import type { ProposalStatus } from "../../lib/contracts";
import { allocate, sharesEqual } from "../allocations";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { syncRevisionPayments } from "../payments/sync";

/**
 * Statuses that a recompute may supersede. Pre-capture payment states stay
 * editable (superseding unwinds their authorizations); capturing, test_funded,
 * and recovery_pending are frozen. A canceled revision is always replaced.
 */
export const EDITABLE_STATUSES: readonly ProposalStatus[] = [
  "draft",
  "awaiting_approval",
  "approved_pledged",
  "infeasible",
  "authorizing",
  "ready_to_capture",
  "blocked",
  "canceled",
];

export function isEditable(status: ProposalStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export const INFEASIBLE_CAPS_MESSAGE = "The group's contribution limits don't cover the total yet.";

/** Organizer first, then join order. This is also the leftover-cent priority. */
export async function orderedParticipants(
  ctx: QueryCtx,
  roomId: Id<"rooms">,
): Promise<Doc<"participants">[]> {
  const rows = await ctx.db
    .query("participants")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  return rows.sort((a, b) => {
    if (a.role !== b.role) return a.role === "organizer" ? -1 : 1;
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    return a._creationTime - b._creationTime;
  });
}

interface Draft {
  selectionId: Id<"giftSelections">;
  listingId: Id<"productListings">;
  payableTotalMinor: number;
  shares: Array<{ participantId: Id<"participants">; amountMinor: number }>;
  conditions: string[];
  status: "awaiting_approval" | "infeasible";
  infeasibleReason?: string;
}

async function draftRevision(
  ctx: QueryCtx,
  roomId: Id<"rooms">,
  selection: Doc<"giftSelections">,
): Promise<Draft> {
  const listing = await ctx.db.get(selection.listingId);
  const base = { selectionId: selection._id, listingId: selection.listingId };
  const infeasible = (reason: string, payableTotalMinor = 0): Draft => ({
    ...base,
    payableTotalMinor,
    shares: [],
    conditions: [reason],
    status: "infeasible",
    infeasibleReason: reason,
  });

  if (!listing || listing.roomId !== roomId || listing.status === "invalid") {
    return infeasible("The selected listing is no longer available.");
  }
  if (listing.currency !== "USD") return infeasible("Only USD listings are supported.");
  if (listing.priceStatus !== "observed" || !listing.priceMinor || listing.priceMinor <= 0) {
    return infeasible("The selected listing has no observed price yet.");
  }

  const shippingKnown = listing.shippingStatus === "observed" && listing.shippingMinor !== undefined;
  const payableTotalMinor = listing.priceMinor + (shippingKnown ? listing.shippingMinor! : 0);
  const conditions = [
    `Price observed at ${new Date(listing.retrievedAt).toISOString()} from ${listing.sourceUrl}.`,
    shippingKnown ? "Includes observed shipping." : "Shipping is not yet known and is not included.",
    "Tax is not included.",
  ];
  if (listing.status === "stale") conditions.push("This listing observation is stale; refresh before buying.");

  const participants = await orderedParticipants(ctx, roomId);
  const limits = await ctx.db
    .query("contributionLimits")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  const capByParticipant = new Map(limits.map((l) => [l.participantId, l.amountMinor]));

  const result = allocate({
    payableTotalMinor,
    participants: participants.map((p) => ({
      participantId: p._id,
      // Unset caps count as 0 so nobody is silently over-allocated.
      limitMinor: capByParticipant.get(p._id) ?? 0,
    })),
  });
  if (!result.feasible) {
    const reason =
      result.reason === "caps_insufficient" ? INFEASIBLE_CAPS_MESSAGE : "The proposal inputs are invalid.";
    return infeasible(reason, payableTotalMinor);
  }

  return {
    ...base,
    payableTotalMinor,
    shares: result.shares.map((s) => ({
      participantId: s.participantId as Id<"participants">,
      amountMinor: s.amountMinor,
    })),
    conditions,
    status: "awaiting_approval",
  };
}

function sameDeal(current: Doc<"proposalRevisions">, draft: Draft): boolean {
  const currentFeasible = current.status !== "infeasible";
  const draftFeasible = draft.status !== "infeasible";
  if (currentFeasible !== draftFeasible) return false;
  if (current.selectionId !== draft.selectionId) return false;
  if (current.listingId !== draft.listingId) return false;
  if (current.payableTotalMinor !== draft.payableTotalMinor) return false;
  if (!sharesEqual(current.shares, draft.shares)) return false;
  if (!draftFeasible && current.conditions[0] !== draft.conditions[0]) return false;
  return true;
}

/**
 * Marks a revision superseded (a canceled one keeps its status), invalidates
 * its live approvals, and records unwind intents for any payment attempts.
 */
async function supersede(ctx: MutationCtx, revision: Doc<"proposalRevisions">, now: number) {
  if (revision.status !== "canceled") await ctx.db.patch(revision._id, { status: "superseded" });
  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_revision", (q) => q.eq("revisionId", revision._id))
    .collect();
  for (const approval of approvals) {
    if (approval.status === "pending" || approval.status === "approved") {
      await ctx.db.patch(approval._id, { status: "invalidated", updatedAt: now });
    }
  }
  await syncRevisionPayments(ctx, revision._id, now);
}

export type RecomputeResult =
  | { kind: "no_selection"; revision: null }
  | { kind: "frozen"; revision: Doc<"proposalRevisions"> }
  | { kind: "unchanged" | "created"; revision: Doc<"proposalRevisions">; infeasibleReason?: string };

export async function recomputeProposal(ctx: MutationCtx, roomId: Id<"rooms">): Promise<RecomputeResult> {
  const room = await ctx.db.get(roomId);
  if (!room) throw new Error("recomputeProposal: room missing");
  const now = Date.now();

  const current = room.currentRevisionId ? await ctx.db.get(room.currentRevisionId) : null;
  if (current && !isEditable(current.status)) return { kind: "frozen", revision: current };

  const selection = room.currentSelectionId ? await ctx.db.get(room.currentSelectionId) : null;
  if (!selection || selection.status !== "active") {
    if (current) {
      await supersede(ctx, current, now);
      await ctx.db.patch(roomId, { currentRevisionId: undefined });
    }
    return { kind: "no_selection", revision: null };
  }

  const draft = await draftRevision(ctx, roomId, selection);
  if (current && current.status !== "canceled" && sameDeal(current, draft)) {
    return { kind: "unchanged", revision: current, infeasibleReason: draft.infeasibleReason };
  }

  const latest = await ctx.db
    .query("proposalRevisions")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .order("desc")
    .first();
  if (current) await supersede(ctx, current, now);

  const revisionId = await ctx.db.insert("proposalRevisions", {
    roomId,
    revisionNumber: (latest?.revisionNumber ?? 0) + 1,
    selectionId: draft.selectionId,
    listingId: draft.listingId,
    quantity: 1,
    payableTotalMinor: draft.payableTotalMinor,
    currency: "USD",
    shares: draft.shares,
    conditions: draft.conditions,
    status: draft.status,
    createdAt: now,
  });
  if (draft.status === "awaiting_approval") {
    for (const share of draft.shares) {
      await ctx.db.insert("approvals", {
        roomId,
        revisionId,
        participantId: share.participantId,
        status: "pending",
        updatedAt: now,
      });
    }
  }
  await ctx.db.patch(roomId, { currentRevisionId: revisionId });
  const revision = (await ctx.db.get(revisionId))!;
  return { kind: "created", revision, infeasibleReason: draft.infeasibleReason };
}
