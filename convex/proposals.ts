/**
 * Gift selection, private contribution limits, proposal revisions, approvals.
 * Owner: Dev 2 (BE-007, BE-008, BE-010, BE-011). Consumer: Dev 1.
 *
 * Invariants:
 *   - Revisions are immutable; any change mints revision n+1 and supersedes n.
 *   - approveRevision fails with `invalid_revision` unless
 *     room.currentRevisionId === revisionId.
 *   - Contribution limits are readable only by their owner and allocations.ts.
 */
import { v } from "convex/values";
import type { ProposalView } from "../lib/contracts";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { notImplemented } from "./lib/result";

export const selectGift = mutation({
  args: { roomId: v.id("rooms"), listingId: v.id("productListings") },
  handler: async (_ctx, _args) =>
    notImplemented<{
      selection: Doc<"giftSelections">;
      revision?: Doc<"proposalRevisions">;
    }>("BE-007"),
});

export const setContributionLimit = mutation({
  args: { roomId: v.id("rooms"), amountMinor: v.number() },
  handler: async (_ctx, _args) =>
    notImplemented<{
      limit: Doc<"contributionLimits">;
      revision?: Doc<"proposalRevisions">;
    }>("BE-008"),
});

/** Owner-only read of the caller's own cap. */
export const getMyContributionLimit = query({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) => notImplemented<Doc<"contributionLimits"> | null>("BE-008"),
});

export const createProposal = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) => notImplemented<ProposalView>("BE-010"),
});

/** Mock: lib/mocks/queries.ts proposalQuery. */
export const getProposal = query({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) => notImplemented<ProposalView>("BE-010"),
});

export const approveRevision = mutation({
  args: { revisionId: v.id("proposalRevisions") },
  handler: async (_ctx, _args) => notImplemented<Doc<"approvals">>("BE-011"),
});
