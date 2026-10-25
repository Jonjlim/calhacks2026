/**
 * Doc → contract-shape mappers for queries whose contract returns the
 * lib/contracts view types (`id` instead of Convex `_id`).
 */
import type {
  Approval,
  ContributionLimit,
  Participant,
  ProposalRevision,
  Room,
} from "../../lib/contracts";
import type { Doc } from "../_generated/dataModel";

export function toRoom(d: Doc<"rooms">): Room {
  return {
    id: d._id,
    title: d.title,
    recipientDisplayName: d.recipientDisplayName,
    occasion: d.occasion,
    deadlineAt: d.deadlineAt,
    currency: d.currency,
    budgetMinor: d.budgetMinor,
    budgetGuidance: d.budgetGuidance,
    knowledgeRevision: d.knowledgeRevision,
    currentRevisionId: d.currentRevisionId,
    currentSelectionId: d.currentSelectionId,
    latestMessageId: d.latestMessageId,
    inviteToken: d.inviteToken,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
  };
}

export function toParticipant(d: Doc<"participants">): Participant {
  return {
    id: d._id,
    roomId: d.roomId,
    userId: d.userId,
    displayName: d.displayName,
    role: d.role,
    joinedAt: d.joinedAt,
  };
}

export function toRevision(d: Doc<"proposalRevisions">): ProposalRevision {
  return {
    items: d.items,
    id: d._id,
    roomId: d.roomId,
    selectionId: d.selectionId,
    listingId: d.listingId,
    quantity: d.quantity,
    payableTotalMinor: d.payableTotalMinor,
    currency: d.currency,
    shares: d.shares.map((s) => ({ participantId: s.participantId, amountMinor: s.amountMinor })),
    conditions: [...d.conditions],
    status: d.status,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt,
  };
}

export function toApproval(d: Doc<"approvals">): Approval {
  return {
    id: d._id,
    roomId: d.roomId,
    revisionId: d.revisionId,
    participantId: d.participantId,
    status: d.status,
    updatedAt: d.updatedAt,
  };
}

export function toLimit(d: Doc<"contributionLimits">): ContributionLimit {
  return {
    participantId: d.participantId,
    roomId: d.roomId,
    amountMinor: d.amountMinor,
    updatedAt: d.updatedAt,
  };
}
