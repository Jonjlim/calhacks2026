/** Dev 4's additive research table; no changes to payment/agent state. */
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { jobStatus } from "../validators";

export const fashionDirection = v.object({
  kind: v.literal("sampled_style"), garment: v.string(), searchQuery: v.string(),
  postUrls: v.array(v.string()), distinctCreators: v.number(), label: v.string(),
});
export const fashionSample = v.object({
  mode: v.literal("live_sample"), label: v.string(), actor: v.string(), build: v.string(), providerRunId: v.string(),
  context: v.object({ seedTerm: v.string(), windowStart: v.number(), windowEnd: v.number(), retrievedAt: v.number() }),
  supportingPublishedClueIds: v.array(v.string()), directions: v.array(fashionDirection),
  evidenceSummary: v.optional(v.object({ returnedRows: v.number(), validRecentPosts: v.number(), excludedAdvertisingPosts: v.number() })),
});
export const fashionTables = {
  fashionJobs: defineTable({
    roomId: v.id("rooms"), knowledgeRevision: v.number(),
    actingParticipantId: v.id("participants"),
    supportingPublishedClueIds: v.array(v.id("publishedClues")),
    seedTerm: v.string(), status: jobStatus, idempotencyKey: v.string(),
    createdAt: v.number(), windowStart: v.number(), windowEnd: v.number(),
    providerRunId: v.optional(v.string()), pollUntil: v.optional(v.number()),
    sample: v.optional(fashionSample), lastError: v.optional(v.string()),
  }).index("by_room", ["roomId"])
    .index("by_room_seed", ["roomId", "seedTerm"])
    .index("by_room_key", ["roomId", "idempotencyKey"]),
};
