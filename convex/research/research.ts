/**
 * Product research jobs and recommendations.
 * Owner: Dev 4 (RC-004, RC-005). Job rows: Dev 2.
 *
 * Listings without sourceUrl + retrievedAt are dropped. The model never
 * inserts listings. A job whose knowledgeRevision is older than the room's
 * becomes `stale` and does not overwrite the current shortlist.
 */
import { v } from "convex/values";
import type { RecommendationsView } from "../../lib/contracts";
import { internalAction, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { notImplemented } from "../lib/result";

export const startResearch = mutation({
  args: {
    roomId: v.id("rooms"),
    publishedClueIds: v.array(v.id("publishedClues")),
    budgetMinor: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (_ctx, _args) => notImplemented<{ jobId: Id<"researchJobs"> }>("RC-004"),
});

/** Mock: lib/mocks/queries.ts recommendationsQuery. */
export const listRecommendations = query({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) => notImplemented<RecommendationsView>("RC-005"),
});

export const runResearch = internalAction({
  args: { jobId: v.id("researchJobs") },
  handler: async (_ctx, _args) => notImplemented<null>("RC-004"),
});
