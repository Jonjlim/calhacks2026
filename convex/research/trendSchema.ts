/** Dev 4's additive Google Trends table; no changes to payment/agent state. */
import { defineTable } from "convex/server";
import { v } from "convex/values";
import { jobStatus } from "../validators";

export const trendSignal = v.object({
  kind: v.union(v.literal("top_search"), v.literal("rising_search"), v.literal("breakout_search")),
  popularityIndex: v.optional(v.number()), growthPercent: v.optional(v.number()),
});
export const trendSuggestion = v.object({ query: v.string(), sourceUrl: v.string(), signals: v.array(trendSignal) });
export const trendSample = v.object({
  mode: v.literal("live_sample"), label: v.string(), actor: v.string(), build: v.string(), providerRunId: v.string(),
  context: v.object({ seedTerm: v.string(), geo: v.literal("US"), timeRange: v.literal("today 3-m"), retrievedAt: v.number() }),
  publishedClueId: v.string(), suggestions: v.array(trendSuggestion),
  evidenceSummary: v.object({ returnedRows: v.number(), observations: v.number() }),
});
export const trendTables = {
  trendJobs: defineTable({
    roomId: v.id("rooms"), knowledgeRevision: v.number(),
    actingParticipantId: v.id("participants"),
    publishedClueId: v.id("publishedClues"),
    seedTerm: v.string(), status: jobStatus, idempotencyKey: v.string(), createdAt: v.number(),
    providerRunId: v.optional(v.string()), pollUntil: v.optional(v.number()),
    sample: v.optional(trendSample), lastError: v.optional(v.string()),
  }).index("by_room", ["roomId"])
    .index("by_room_seed", ["roomId", "seedTerm"])
    .index("by_room_key", ["roomId", "idempotencyKey"]),
  // One row per member per suggestion; deleting it takes the pass back.
  trendPasses: defineTable({
    roomId: v.id("rooms"), trendJobId: v.id("trendJobs"), query: v.string(),
    participantId: v.id("participants"), createdAt: v.number(),
  }).index("by_room", ["roomId"])
    .index("by_job_query_participant", ["trendJobId", "query", "participantId"]),
};
