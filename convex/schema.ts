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
 * Recipient tables are server/owner-only and optional. Payments remain P1-B.
 *
 * authTables (users, authSessions, ...) belong to Convex Auth and are never
 * returned by room queries.
 */
import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import * as V from "./validators";

export default defineSchema({
  ...authTables,

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
    recipientProfileId: v.optional(v.id("recipientProfiles")),
    /** Latest human chat message; part of the buyer-agent evaluate inputHash. */
    latestMessageId: v.optional(v.id("chatMessages")),
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
    agentJobId: v.optional(v.id("agentJobs")),
    responseAgentJobId: v.optional(v.id("agentJobs")),
    replyToSlot: v.optional(v.string()),
    citations: v.optional(V.agentCitations),
  })
    .index("by_room", ["roomId"])
    .index("by_room_idempotency", ["roomId", "clientIdempotencyKey"]),

  evidenceSources: defineTable({
    roomId: v.id("rooms"),
    participantId: v.id("participants"),
    kind: V.evidenceKind,
    label: v.string(),
    sourceRevision: v.number(),
    /** photo / screenshot sources only. */
    media: v.optional(
      v.object({
        count: v.number(),
        recipientMarkers: v.optional(
          v.array(v.object({ x: v.number(), y: v.number() })),
        ),
        status: V.mediaStatus,
      }),
    ),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_room_participant", ["roomId", "participantId"]),

  /** Uploaded files awaiting one read. Rows and files are deleted after the read (or on failure/withdrawal). Owner-only, never subscribed to by clients. */
  evidenceMedia: defineTable({
    sourceId: v.id("evidenceSources"),
    participantId: v.id("participants"),
    mediaIndex: v.number(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    marker: v.optional(v.object({ x: v.number(), y: v.number() })),
  })
    .index("by_source", ["sourceId"])
    .index("by_storage", ["storageId"]),

  privateMessages: defineTable({
    sourceId: v.id("evidenceSources"),
    participantId: v.id("participants"),
    body: v.string(),
    saidAt: v.optional(v.number()),
    speakerHint: v.optional(v.string()),
    /** Which uploaded file (0-based) the row came from; photo and screenshot sources only. */
    mediaIndex: v.optional(v.number()),
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
  })
    .index("by_room", ["roomId"])
    .index("by_proposed_clue", ["proposedClueId"]),

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
    inputVersion: v.optional(v.string()),
    idempotencyKey: v.string(),
    attempt: v.number(),
    actingParticipantId: v.optional(v.id("participants")),
    sourceId: v.optional(v.id("evidenceSources")),
    sourceRevision: v.optional(v.number()),
    latestMessageId: v.optional(v.id("chatMessages")),
    knowledgeRevision: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("quiet"), v.literal("auto"))),
    trigger: v.optional(V.agentTrigger),
    researchJobId: v.optional(v.id("researchJobs")),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    modelUsage: v.optional(V.agentModelUsage),
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
    searchBrief: v.optional(V.searchBrief),
    recipientQuery: v.optional(v.object({
      type: v.union(v.literal("suitability"), v.literal("ownership"), v.literal("constraint")),
      subject: v.object({ kind: v.union(v.literal("category"), v.literal("product")), label: v.string(), listingId: v.optional(v.string()) }),
    })),
    citations: v.optional(v.object({ listingIds: v.array(v.string()), publishedClueIds: v.array(v.string()) })),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  askedSlots: defineTable({
    roomId: v.id("rooms"),
    slot: v.string(),
    messageId: v.optional(v.id("chatMessages")),
    status: V.askedSlotStatus,
    answeredByMessageId: v.optional(v.id("chatMessages")),
    askedAt: v.number(),
  }).index("by_room_slot", ["roomId", "slot"]),

  agentEvents: defineTable({
    roomId: v.id("rooms"), jobId: v.id("agentJobs"),
    participantId: v.optional(v.id("participants")),
    actor: v.union(v.literal("buyer"), v.literal("extractor"), v.literal("research_planner"), v.literal("recipient")),
    kind: v.union(v.literal("started"), v.literal("question"), v.literal("handoff"), v.literal("completed"), v.literal("failed"), v.literal("stale")),
    summary: v.string(), createdAt: v.number(),
    citations: v.optional(V.agentCitations),
  }).index("by_room", ["roomId"]),

  recipientProfiles: defineTable({
    roomId: v.id("rooms"), ownerUserId: v.string(), revision: v.number(), createdAt: v.number(),
  }).index("by_room", ["roomId"]),
  recipientPreferences: defineTable({
    recipientProfileId: v.id("recipientProfiles"),
    category: V.recipientCategory, text: v.string(), disclosable: v.boolean(), authorized: v.boolean(), createdAt: v.number(),
  }).index("by_profile", ["recipientProfileId"]),
  recipientGrants: defineTable({
    recipientProfileId: v.id("recipientProfiles"), category: V.recipientCategory,
    allowedQuestionTypes: v.array(V.recipientQuestionType),
  }).index("by_profile", ["recipientProfileId"]),

  researchJobs: defineTable({
    roomId: v.id("rooms"),
    knowledgeRevision: v.number(),
    publishedClueIds: v.array(v.id("publishedClues")),
    actingParticipantId: v.optional(v.id("participants")),
    originatingAgentJobId: v.optional(v.id("agentJobs")),
    latestMessageId: v.optional(v.id("chatMessages")),
    continuationAgentJobId: v.optional(v.id("agentJobs")),
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
