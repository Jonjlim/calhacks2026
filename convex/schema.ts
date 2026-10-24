/**
 * P0 schema. Owner: Dev 2 (BE-001). Reviewers: Dev 3, Dev 4.
 * Field names follow docs/CONTRACTS.md. Change the doc first.
 *
 * Privacy classes (docs/DATA_AND_PRIVACY.md):
 *   public_room:          rooms, participants, chatMessages, publishedClues,
 *                         productListings, recommendations, giftSelections,
 *                         proposalRevisions, approvals, votes, researchJobs
 *   contributor_private:  evidenceSources, privateMessages, proposedClues,
 *                         contributionLimits
 *   server-only:          agentJobs, agentDecisions, askedSlots
 *
 * P1 tables (recipient preferences/grants, payment attempts, provider events)
 * are added by BE-015 / BE-016 only if those phases start.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import * as V from "./validators";

export default defineSchema({
  rooms: defineTable({
    title: v.string(),
    recipientDisplayName: v.string(),
    occasion: v.string(),
    deadlineAt: v.optional(v.number()),
    currency: V.currency,
    budgetMinor: v.optional(v.number()),
    knowledgeRevision: v.number(),
    currentRevisionId: v.optional(v.id("proposalRevisions")),
    currentSelectionId: v.optional(v.id("giftSelections")),
    inviteToken: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_invite_token", ["inviteToken"]),

  participants: defineTable({
    roomId: v.id("rooms"),
    userId: v.string(),
    displayName: v.string(),
    role: V.participantRole,
    joinedAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_user", ["roomId", "userId"])
    .index("by_user", ["userId"]),

  chatMessages: defineTable({
    roomId: v.id("rooms"),
    authorKind: V.chatAuthorKind,
    participantId: v.optional(v.id("participants")),
    body: v.string(),
    createdAt: v.number(),
    clientIdempotencyKey: v.string(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_idempotency", ["roomId", "clientIdempotencyKey"]),

  evidenceSources: defineTable({
    roomId: v.id("rooms"),
    participantId: v.id("participants"),
    kind: V.evidenceKind,
    label: v.string(),
    sourceRevision: v.number(),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_room_participant", ["roomId", "participantId"]),

  privateMessages: defineTable({
    sourceId: v.id("evidenceSources"),
    participantId: v.id("participants"),
    body: v.string(),
    saidAt: v.optional(v.number()),
    speakerHint: v.optional(v.string()),
  }).index("by_source", ["sourceId"]),

  proposedClues: defineTable({
    roomId: v.id("rooms"),
    participantId: v.id("participants"),
    sourceId: v.id("evidenceSources"),
    sourceMessageIds: v.array(v.id("privateMessages")),
    kind: V.clueKind,
    text: v.string(),
    confidence: v.number(),
    speakerAssumption: V.speakerAssumption,
    contradictsClueIds: v.array(v.id("publishedClues")),
    status: V.proposedClueStatus,
    createdAt: v.number(),
  })
    .index("by_room_participant", ["roomId", "participantId"])
    .index("by_source", ["sourceId"]),

  publishedClues: defineTable({
    roomId: v.id("rooms"),
    proposedClueId: v.optional(v.id("proposedClues")),
    publisherId: v.id("participants"),
    kind: V.clueKind,
    text: v.string(),
    sourceKind: V.clueSourceKind,
    sourceMessageIds: v.array(v.string()),
    excerpt: v.optional(v.string()),
    status: V.publishedClueStatus,
    publishedAt: v.number(),
  }).index("by_room", ["roomId"]),

  productListings: defineTable({
    roomId: v.id("rooms"),
    jobId: v.id("researchJobs"),
    source: V.listingSource,
    sourceUrl: v.string(),
    title: v.string(),
    variant: v.optional(v.string()),
    currency: V.currency,
    priceMinor: v.optional(v.number()),
    priceStatus: V.priceStatus,
    availability: V.availability,
    shippingMinor: v.optional(v.number()),
    shippingStatus: V.shippingStatus,
    imageUrl: v.optional(v.string()),
    sellerName: v.optional(v.string()),
    retrievedAt: v.number(),
    status: V.listingStatus,
  })
    .index("by_room", ["roomId"])
    .index("by_job", ["jobId"]),

  recommendations: defineTable({
    roomId: v.id("rooms"),
    listingId: v.id("productListings"),
    publishedClueIds: v.array(v.id("publishedClues")),
    score: v.number(),
    personalRelevance: v.number(),
    budgetFit: v.number(),
    trendSignal: v.number(),
    explanation: v.string(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  giftSelections: defineTable({
    roomId: v.id("rooms"),
    listingId: v.id("productListings"),
    quantity: v.literal(1),
    listingSnapshot: v.object({
      title: v.string(),
      sourceUrl: v.string(),
      priceMinor: v.optional(v.number()),
      priceStatus: V.priceStatus,
      retrievedAt: v.number(),
    }),
    status: V.selectionStatus,
    selectedBy: v.id("participants"),
    selectedAt: v.number(),
  }).index("by_room_status", ["roomId", "status"]),

  votes: defineTable({
    roomId: v.id("rooms"),
    listingId: v.id("productListings"),
    participantId: v.id("participants"),
    value: V.voteValue,
    updatedAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_listing_participant", ["listingId", "participantId"]),

  contributionLimits: defineTable({
    roomId: v.id("rooms"),
    participantId: v.id("participants"),
    amountMinor: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_participant", ["roomId", "participantId"]),

  proposalRevisions: defineTable({
    roomId: v.id("rooms"),
    revisionNumber: v.number(),
    selectionId: v.id("giftSelections"),
    listingId: v.id("productListings"),
    quantity: v.literal(1),
    payableTotalMinor: v.number(),
    currency: V.currency,
    shares: v.array(V.allocationShare),
    conditions: v.array(v.string()),
    status: V.proposalStatus,
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
  }).index("by_room", ["roomId"]),

  approvals: defineTable({
    roomId: v.id("rooms"),
    revisionId: v.id("proposalRevisions"),
    participantId: v.id("participants"),
    status: V.approvalStatus,
    updatedAt: v.number(),
  })
    .index("by_revision", ["revisionId"])
    .index("by_revision_participant", ["revisionId", "participantId"]),

  agentJobs: defineTable({
    roomId: v.id("rooms"),
    kind: V.agentJobKind,
    status: V.jobStatus,
    inputHash: v.string(),
    idempotencyKey: v.string(),
    attempt: v.number(),
    actingParticipantId: v.optional(v.id("participants")),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_input_hash", ["roomId", "inputHash"]),

  agentDecisions: defineTable({
    jobId: v.id("agentJobs"),
    roomId: v.id("rooms"),
    intent: V.agentIntent,
    rationale: v.string(),
    chatMessage: v.optional(v.string()),
    clarifySlot: v.optional(v.string()),
    extractSourceId: v.optional(v.id("evidenceSources")),
    needsFollowup: v.boolean(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  askedSlots: defineTable({
    roomId: v.id("rooms"),
    slot: v.string(),
    messageId: v.optional(v.id("chatMessages")),
    status: V.askedSlotStatus,
    askedAt: v.number(),
  }).index("by_room_slot", ["roomId", "slot"]),

  researchJobs: defineTable({
    roomId: v.id("rooms"),
    knowledgeRevision: v.number(),
    publishedClueIds: v.array(v.id("publishedClues")),
    brief: v.optional(V.searchBrief),
    status: V.jobStatus,
    inputHash: v.string(),
    idempotencyKey: v.string(),
    attempt: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_idempotency", ["roomId", "idempotencyKey"]),
});
