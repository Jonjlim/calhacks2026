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
 *   server-only:          agentJobs, agentDecisions, askedSlots, evidenceMedia,
 *                         mediaUploadGrants
 *
 * Recipient tables are server/owner-only and optional.
 * P1-B payment tables (paymentAttempts, providerEvents) are server-written;
 * clients read only their own attempt plus group counts via payments/state.ts.
 *
 * authTables (users, authSessions, ...) belong to Convex Auth and are never
 * returned by room queries.
 */
import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import * as V from "./validators";
import { fashionTables } from "./research/fashionSchema";
import { trendTables } from "./research/trendSchema";
import { giftTwinTables } from "./giftTwin/schema";
import { simulationTables } from "./payments/simulationSchema";

export default defineSchema({
  ...authTables,
  ...fashionTables,
  ...trendTables,
  ...giftTwinTables,
  ...simulationTables,

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
    /** quiet (default): Unwrap speaks when asked. chatty: it may also join in; organizer-controlled. */
    agentChatMode: v.optional(V.agentChatMode),
    /** Latest human chat message; part of the buyer-agent evaluate inputHash. */
    latestMessageId: v.optional(v.id("chatMessages")),
    inviteToken: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    /** Set by rooms.deleteRoom; the room is unreachable from then on while purgeRoomBatch removes its rows. */
    deletedAt: v.optional(v.number()),
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
    /** Author deleted the message: body is overwritten with "" and the row stays as a tombstone. */
    deletedAt: v.optional(v.number()),
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

  /** One row per issued evidence upload URL; server-only. `storageId` is set once a file is claimed against it. */
  mediaUploadGrants: defineTable({
    roomId: v.id("rooms"),
    participantId: v.id("participants"),
    issuedAt: v.number(),
    storageId: v.optional(v.id("_storage")),
  })
    .index("by_room_participant_issued", ["roomId", "participantId", "issuedAt"])
    .index("by_issued", ["issuedAt"]),

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
    items: v.optional(v.array(V.giftBoxItem)),
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
    /** Why a pass was cast (D23 trial); only on "down". */
    reason: v.optional(V.passReason),
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
    items: v.optional(v.array(V.giftBoxItem)),
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
    /** query_recipient only: how the recipient agent's policy resolved the question. */
    recipientOutcome: v.optional(v.union(v.literal("answered"), v.literal("unknown"), v.literal("refused"))),
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

  /**
   * Opt-in public summaries of gift sessions ("zoom out" view). Holds only what the organizer
   * approved: coarse inputs, up to three chosen clue lines, and the final pick. No room id,
   * names, invite token, private imports, caps, or participant ids are ever exposed to readers.
   */
  giftWorlds: defineTable({
    roomId: v.optional(v.id("rooms")),
    ownerUserId: v.optional(v.string()),
    isSample: v.boolean(),
    occasion: v.string(),
    recipientAlias: v.string(),
    budgetBand: V.budgetBand,
    friends: v.number(),
    inputs: v.array(v.object({ kind: V.clueKind, count: v.number() })),
    highlights: v.array(v.string()),
    state: v.union(v.literal("exploring"), v.literal("chosen")),
    outcome: v.optional(
      v.object({
        title: v.string(),
        priceMinor: v.optional(v.number()),
        priceStatus: V.priceStatus,
        source: V.listingSource,
      }),
    ),
    sharedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_shared", ["sharedAt"]),

  /** Attributed map reactions. Price is personal feedback; ownership has an explicitly published clue. */
  mapFeedback: defineTable({
    roomId: v.id("rooms"),
    listingId: v.id("productListings"),
    participantId: v.id("participants"),
    kind: v.union(v.literal("owned"), v.literal("price")),
    publishedClueId: v.optional(v.id("publishedClues")),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]).index("by_member_listing", ["roomId", "participantId", "listingId"]),

  /** Live cursor per friend on the gift map. Overwritten in place; readers ignore rows older than a few seconds. */
  mapCursors: defineTable({
    roomId: v.id("rooms"),
    participantId: v.id("participants"),
    x: v.number(),
    y: v.number(),
    space: v.optional(v.union(v.literal("sky"), v.literal("diagram"), v.literal("rings"))),
    updatedAt: v.number(),
  }).index("by_room_participant", ["roomId", "participantId"]),

  /** Where a friend left a node on the shared map. Layout only; no meaning is read from it server-side. */
  mapPositions: defineTable({
    roomId: v.id("rooms"),
    nodeKey: v.string(),
    x: v.number(),
    y: v.number(),
    movedBy: v.id("participants"),
    updatedAt: v.number(),
  }).index("by_room_node", ["roomId", "nodeKey"]),

  /** Idea branches an agent grew off a published memory. Suggestions only: planting one is a friend's tap that publishes a clue. */
  mapSprouts: defineTable({
    roomId: v.id("rooms"),
    seedClueId: v.id("publishedClues"),
    label: v.string(),
    emoji: v.string(),
    clue: v.string(),
    source: v.union(v.literal("agent"), v.literal("preset")),
    grownBy: v.id("participants"),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_seed", ["seedClueId"]),

  /** One row per agent idea suggestion, for the per-room rate limit. No content is stored. */
  ideaCalls: defineTable({
    roomId: v.id("rooms"),
    createdAt: v.number(),
  }).index("by_room", ["roomId", "createdAt"]),

  /** Photos a member added on the gift map, shared with the whole room (D20). Separate from private evidence media. */
  roomPhotos: defineTable({
    roomId: v.id("rooms"),
    uploaderId: v.id("participants"),
    storageId: v.id("_storage"),
    sourceId: v.optional(v.id("evidenceSources")),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId", "createdAt"])
    .index("by_storage", ["storageId"]),

  /** Pull toward the present (+1) or push away (−1) on a memory or theme (D19). One per member per target; advisory only. */
  mapSignals: defineTable({
    roomId: v.id("rooms"),
    participantId: v.id("participants"),
    // "direction" and "trend" (D23 trial): pass or pull a direction; catch (+1) or let drift (−1) a trend cloud.
    targetKind: v.union(v.literal("clue"), v.literal("theme"), v.literal("direction"), v.literal("trend")),
    targetId: v.string(),
    value: v.number(),
    updatedAt: v.number(),
    /** Why a pass was cast (D23 trial); only on −1. */
    reason: v.optional(V.passReason),
  })
    .index("by_room", ["roomId"])
    .index("by_member_target", ["roomId", "participantId", "targetKind", "targetId"]),

  /** Themes the council suggests to group published clues (D19). Interpretations, never room knowledge. */
  mapThemes: defineTable({
    roomId: v.id("rooms"),
    label: v.string(),
    clueIds: v.array(v.id("publishedClues")),
    source: v.union(v.literal("agent"), v.literal("preset")),
    knowledgeRevision: v.number(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]),

  /** One sharpen round: a single question that splits the finalists (D19). Answering publishes the chosen clue as the answering member. */
  mapSharpens: defineTable({
    ballots: v.optional(v.array(v.object({ participantId: v.id("participants"), option: v.number(), updatedAt: v.number() }))),
    roomId: v.id("rooms"),
    question: v.string(),
    options: v.array(v.object({ label: v.string(), clue: v.string(), listingIds: v.array(v.id("productListings")) })),
    finalistIds: v.array(v.id("productListings")),
    source: v.union(v.literal("agent"), v.literal("preset")),
    askedBy: v.id("participants"),
    status: v.union(v.literal("open"), v.literal("answered"), v.literal("dismissed")),
    answer: v.optional(v.number()),
    answeredBy: v.optional(v.id("participants")),
    knowledgeRevision: v.number(),
    createdAt: v.number(),
    /** A probe question about one broad direction (D23 trial); its options carry no listings. */
    directionId: v.optional(v.id("mapDirections")),
  }).index("by_room", ["roomId", "createdAt"]),

  /**
   * The room's decision log (D23 trial): one plain line per step the council, the checks or a friend took.
   * Append-only and room-visible, so it holds only room-visible facts: never private imports, unpublished clues or caps.
   */
  roomTrail: defineTable({
    roomId: v.id("rooms"),
    at: v.number(),
    stage: v.union(v.literal("memories"), v.literal("council"), v.literal("steering"), v.literal("search"), v.literal("choice"), v.literal("money")),
    actor: v.union(v.literal("council"), v.literal("checks"), v.literal("trends"), v.literal("search"), v.literal("person")),
    participantId: v.optional(v.id("participants")),
    /** The decision, kept or thrown out. "rejected" lines show what a check refused. */
    outcome: v.union(v.literal("kept"), v.literal("rejected"), v.literal("info")),
    text: v.string(),
    directionId: v.optional(v.id("mapDirections")),
    listingId: v.optional(v.id("productListings")),
    clueIds: v.optional(v.array(v.id("publishedClues"))),
  }).index("by_room", ["roomId", "at"]),

  /** Council gift directions that combine memories (D23 trial). Interpretations: they publish nothing. */
  mapDirections: defineTable({
    roomId: v.id("rooms"),
    label: v.string(),
    query: v.string(),
    why: v.string(),
    clueIds: v.array(v.id("publishedClues")),
    trend: v.optional(v.object({ trendJobId: v.id("trendJobs"), query: v.string() })),
    broad: v.boolean(),
    source: v.union(v.literal("agent"), v.literal("preset")),
    knowledgeRevision: v.number(),
    createdAt: v.number(),
    /** Set when the room's passes retired it; it leaves the map and the council suggests a replacement. */
    retiredAt: v.optional(v.number()),
    /** The direction this one replaced, so "How we got here" can join them. */
    replaces: v.optional(v.id("mapDirections")),
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

  // --- AI Council (Fetch.ai coordinator). Additive; see CONTRACTS.md § AI Council.
  // Written only by the trusted HTTP ingest (convex/council.ts). Events hold
  // display summaries and decoration specs, never products or raw memories.
  councilRuns: defineTable({
    runId: v.string(),
    source: v.union(v.literal("web"), v.literal("asi1")),
    demoKey: v.optional(v.string()),
    roomId: v.optional(v.id("rooms")),
    researchJobId: v.optional(v.id("researchJobs")),
    knowledgeRevision: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
    approved: v.optional(v.array(v.object({ listingId: v.id("productListings"), notes: v.array(v.string()) }))),
    excluded: v.optional(v.array(v.object({ title: v.string(), reason: v.string() }))),
    cached: v.optional(v.boolean()),
    deliveredAt: v.optional(v.number()),
    error: v.optional(v.string()),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed"), v.literal("partial"), v.literal("uncertain")),
    lastSequence: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_demo_key", ["demoKey", "startedAt"])
    .index("by_room", ["roomId", "startedAt"])
    .index("by_research", ["researchJobId"])
    .index("by_room_request", ["roomId", "idempotencyKey"]),
  councilEvents: defineTable({
    eventId: v.string(),
    runId: v.string(),
    actor: V.councilActor,
    task: v.string(),
    status: V.councilStatus,
    sequence: v.number(),
    timestamp: v.number(),
    result: v.optional(V.councilResult),
    receivedAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_run_sequence", ["runId", "sequence"]),
  giftDecorations: defineTable({
    demoKey: v.optional(v.string()),
    roomId: v.optional(v.id("rooms")),
    memoryId: v.string(),
    runId: v.string(),
    ...V.decorationFields,
    createdAt: v.number(),
  })
    .index("by_demo_memory", ["demoKey", "memoryId"])
    .index("by_room_memory", ["roomId", "memoryId"]),

  /** P1-B. Server-written; clients only see their own attempt through payments/state.ts views. */
  paymentAttempts: defineTable({
    roomId: v.id("rooms"),
    revisionId: v.id("proposalRevisions"),
    participantId: v.id("participants"),
    provider: V.paymentProvider,
    providerObjectId: v.optional(v.string()),
    idempotencyKey: v.string(),
    clientIdempotencyKey: v.string(),
    amountMinor: v.number(),
    currency: V.currency,
    status: V.paymentAttemptStatus,
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_revision", ["revisionId"])
    .index("by_revision_participant", ["revisionId", "participantId"])
    .index("by_provider_object", ["providerObjectId"]),

  /** P1-B webhook ledger. Server-only; providerEventId is unique. */
  providerEvents: defineTable({
    provider: V.paymentProvider,
    providerEventId: v.string(),
    type: v.string(),
    providerObjectId: v.optional(v.string()),
    receivedAt: v.number(),
  }).index("by_provider_event", ["provider", "providerEventId"]),

  researchJobs: defineTable({
    providerRunId: v.optional(v.string()),
    providerStartedAt: v.optional(v.number()),
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
    /** The direction this search shops (D23 trial). Jobs in different directions run side by side. */
    directionId: v.optional(v.id("mapDirections")),
  })
    .index("by_room", ["roomId"])
    .index("by_room_idempotency", ["roomId", "idempotencyKey"])
    .index("by_room_direction", ["roomId", "directionId"]),
});
