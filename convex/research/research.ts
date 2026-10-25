/**
 * Dev 4 research pipeline. Public endpoints enforce membership; workers are internal.
 * Own job transitions locally so Dev 2's generic jobs.ts remains untouched.
 */
import { v } from "convex/values";
import type { PublishedClue, RecommendationsView, Result, SearchBrief } from "../../lib/contracts";
import { normalizedListingSchema } from "../../lib/validation";
import { internal } from "../_generated/api";
import { internalAction, internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireMember } from "../lib/auth";
import { insertResearchJob, isResearchJobCurrent } from "../jobs";
import { err, ok } from "../lib/result";
import { buildSearchBrief } from "./brief";
import { normalizeDataset } from "./normalize";
import { readCatalog } from "./catalog";
import { enqueueResearchContinuation } from "../agents/runtime";
import { createProvider, PROVIDER_DEADLINE_MS } from "./provider";
import { usableFashionJob } from "./fashion";
import { usableTrendJob } from "./trendJobs";

type StoredBrief = NonNullable<Doc<"researchJobs">["brief"]>;
type ClaimedJob = { brief: SearchBrief } | null;

function toClue(doc: Doc<"publishedClues">): PublishedClue {
  const { _id, _creationTime: _, ...fields } = doc;
  return { ...fields, id: _id };
}
async function isCurrent(ctx: MutationCtx, job: Doc<"researchJobs">): Promise<boolean> {
  const room = await ctx.db.get(job.roomId);
  const newest = await ctx.db.query("researchJobs")
    .withIndex("by_room", q => q.eq("roomId", job.roomId)).order("desc").first();
  return !!room && isResearchJobCurrent(job, room)
    && room.knowledgeRevision === job.knowledgeRevision && newest?._id === job._id;
}
async function staleUnlessCurrent(ctx: MutationCtx, job: Doc<"researchJobs">): Promise<boolean> {
  if (await isCurrent(ctx, job)) return false;
  await ctx.db.patch(job._id, { status: "stale", lastError: "Room knowledge or research request changed." });
  return true;
}

export const startResearch = mutation({
  args: {
    roomId: v.id("rooms"),
    publishedClueIds: v.array(v.id("publishedClues")),
    budgetMinor: v.optional(v.number()),
    idempotencyKey: v.string(),
    fashionJobId: v.optional(v.id("fashionJobs")),
    trendJobId: v.optional(v.id("trendJobs")),
    discoveryQuery: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Result<{ jobId: Id<"researchJobs"> }>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Join this room before searching.");
    const room = member.room;
    const discoveryQuery = args.discoveryQuery?.trim();
    if (args.discoveryQuery !== undefined && (!discoveryQuery || discoveryQuery.length > 200 || (!args.fashionJobId && !args.trendJobId)))
      return err("validation_failed", "Choose a sourced discovery query of 1–200 characters with its discovery job.");
    const key = args.idempotencyKey.trim();
    if (!key || key.length > 200 || args.publishedClueIds.length > 100) {
      return err("validation_failed", "Provide a request key and at most 100 published clues.");
    }
    const budgetMinor = args.budgetMinor ?? room.budgetMinor;
    if (budgetMinor !== undefined && (!Number.isSafeInteger(budgetMinor) || budgetMinor < 0)) {
      return err("validation_failed", "Budget must be nonnegative integer USD cents.");
    }
    const clueIds = [...new Set(args.publishedClueIds)].sort();
    const clues: PublishedClue[] = [];
    for (const id of clueIds) {
      const clue = await ctx.db.get(id);
      if (!clue || clue.roomId !== args.roomId || clue.status !== "active") {
        return err("validation_failed", "Every clue must be active and published in this room.");
      }
      clues.push(toClue(clue));
    }
    const brief = buildSearchBrief({
      roomId: room._id, knowledgeRevision: room.knowledgeRevision, clues,
      ...(budgetMinor === undefined ? {} : { budgetMinor }), occasion: room.occasion,
    });
    if (!brief.queryTerms.length) return err("validation_failed", "Publish an interest or wish before searching.");
    let discoveryQueries: string[] = [];
    if (args.fashionJobId) {
      const discovery = await usableFashionJob(ctx, room._id, args.fashionJobId);
      if (!discovery || !discovery.supportingPublishedClueIds.every(id => clueIds.includes(id)))
        return err("stale_job", "Use a fresh discovery supported by the current search's published clues.");
      discoveryQueries = discovery.sample?.directions.map(direction => direction.searchQuery) ?? [];
    }
    if (args.trendJobId) {
      if (args.fashionJobId) return err("validation_failed", "Use one discovery source per search.");
      const trend = await usableTrendJob(ctx, room._id, args.trendJobId);
      if (!trend || !clueIds.includes(trend.publishedClueId))
        return err("stale_job", "Use a fresh trend search supported by the current search's published clues.");
      discoveryQueries = trend.sample?.suggestions.map(suggestion => suggestion.query) ?? [];
    }
    if (discoveryQuery && !discoveryQueries.includes(discoveryQuery))
      return err("validation_failed", "Choose one of this discovery's sourced suggestions; arbitrary search text is not accepted.");
    const selectedQuery = discoveryQuery ?? discoveryQueries[0];
    if (selectedQuery) brief.queryTerms = [selectedQuery];
    // Canonical collision-free input fingerprint. It contains no raw imports or private caps.
    const inputHash = JSON.stringify([room._id, room.knowledgeRevision, clueIds, budgetMinor ?? null,
      ...(args.fashionJobId ? [args.fashionJobId] : []), ...(args.trendJobId ? ["trend", args.trendJobId] : []),
      ...(selectedQuery && selectedQuery !== discoveryQueries[0] ? ["discovery_query", selectedQuery] : [])]);
    const previous = await ctx.db.query("researchJobs")
      .withIndex("by_room_idempotency", q => q.eq("roomId", room._id).eq("idempotencyKey", key)).unique();
    if (previous) return previous.inputHash === inputHash
      ? ok({ jobId: previous._id })
      : err("validation_failed", "Use a new request key when search inputs change.");
    // No recency cap: an older open or uncertain start may already be billable.
    const duplicate = await ctx.db.query("researchJobs")
      .withIndex("by_room", q => q.eq("roomId", room._id)).order("desc")
      .filter(q => q.and(q.eq(q.field("inputHash"), inputHash), q.or(
        q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "running"), q.eq(q.field("status"), "uncertain"))))
      .first();
    if (duplicate) return ok({ jobId: duplicate._id });
    // Explicit persistence adapter for existing Dev 2 validator: roomId lives on the job.
    // Full SearchBrief is restored when calling the provider. No silent schema change.
    const { roomId: _roomId, ...storedBrief } = brief;
    const { jobId, created } = await insertResearchJob(ctx, {
      roomId: room._id, knowledgeRevision: room.knowledgeRevision,
      publishedClueIds: clueIds, brief: storedBrief satisfies StoredBrief,
      inputHash, idempotencyKey: key,
    });
    if (created) {
      await ctx.db.patch(jobId, { actingParticipantId: member.me._id, latestMessageId: room.latestMessageId });
      await ctx.scheduler.runAfter(0, internal.research.research.runResearch, { jobId });
    }
    return ok({ jobId });
  },
});

export const listRecommendations = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<Result<RecommendationsView>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Join this room to see gifts.");
    const { recommendations, listings } = await readCatalog(ctx, member.room);
    return ok({ recommendations, listings });
  },
});

export const claimJob = internalMutation({
  args: { jobId: v.id("researchJobs") },
  handler: async (ctx, { jobId }): Promise<ClaimedJob> => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "pending" || !job.brief) return null;
    if (await staleUnlessCurrent(ctx, job)) return null;
    await ctx.db.patch(jobId, { status: "running", attempt: job.attempt + 1 });
    // If the action dies after the provider starts, never leave an eternal "running".
    await ctx.scheduler.runAfter(PROVIDER_DEADLINE_MS, internal.research.research.expireJob, { jobId });
    return { brief: { ...job.brief, roomId: job.roomId } };
  },
});

export const expireJob = internalMutation({
  args: { jobId: v.id("researchJobs") },
  handler: async (ctx, { jobId }): Promise<null> => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running") return null;
    if (await staleUnlessCurrent(ctx, job)) return null;
    await ctx.db.patch(jobId, {
      status: "uncertain", lastError: "Research did not finish in time. Check the provider run before retrying.",
    });
    await enqueueResearchContinuation(ctx, jobId);
    return null;
  },
});

export const settleJob = internalMutation({
  args: {
    jobId: v.id("researchJobs"),
    status: v.union(v.literal("failed"), v.literal("uncertain")),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running") return null;
    if (await staleUnlessCurrent(ctx, job)) return null;
    await ctx.db.patch(job._id, { status: args.status, lastError: args.message });
    await enqueueResearchContinuation(ctx, job._id);
    return null;
  },
});

export const completeJob = internalMutation({
  args: { jobId: v.id("researchJobs"), raw: v.any(), retrievedAt: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running") return null; // duplicate callbacks cannot insert twice
    if (await staleUnlessCurrent(ctx, job)) return null;
    const listings = normalizeDataset(args.raw, args.retrievedAt);
    if (!listings.length) {
      await ctx.db.patch(job._id, { status: "failed", lastError: "No usable product listings were returned." });
      await enqueueResearchContinuation(ctx, job._id);
      return null;
    }
    // Retain the full small candidate pool for instant clue-based re-ranking.
    for (const listing of listings.slice(0, 60)) {
      const parsed = normalizedListingSchema.parse(listing);
      await ctx.db.insert("productListings", { ...parsed, roomId: job.roomId, jobId: job._id, status: "active" });
    }
    await ctx.db.patch(job._id, { status: "succeeded", lastError: undefined });
    await enqueueResearchContinuation(ctx, job._id);
    return null;
  },
});

export const queuePoll = internalMutation({
  args: { jobId: v.id("researchJobs"), runId: v.string(), startedAt: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running") return null;
    if (await staleUnlessCurrent(ctx, job)) return null;
    await ctx.db.patch(job._id, { providerRunId: args.runId, providerStartedAt: args.startedAt });
    await ctx.scheduler.runAfter(3_000, internal.research.research.pollResearch, args);
    return null;
  },
});

export const checkJob = internalMutation({
  args: { jobId: v.id("researchJobs") },
  handler: async (ctx, { jobId }): Promise<boolean> => {
    const job = await ctx.db.get(jobId);
    return !!job && job.status === "running" && !await staleUnlessCurrent(ctx, job);
  },
});

export const runResearch = internalAction({
  args: { jobId: v.id("researchJobs") },
  handler: async (ctx, { jobId }): Promise<null> => {
    const claimed = await ctx.runMutation(internal.research.research.claimJob, { jobId });
    if (!claimed) return null;
    const provider = createProvider(process.env.APIFY_TOKEN ?? "");
    const result = await provider.start(claimed.brief);
    if (result.kind !== "ok") {
      await ctx.runMutation(internal.research.research.settleJob, {
        jobId, status: result.kind, message: result.message,
      });
      return null;
    }
    // Run ID is durably retained in scheduler arguments, never in client-visible job errors.
    await ctx.runMutation(internal.research.research.queuePoll, {
      jobId, runId: result.value.id, startedAt: Date.now(),
    });
    return null;
  },
});

export const pollResearch = internalAction({
  args: { jobId: v.id("researchJobs"), runId: v.string(), startedAt: v.number() },
  handler: async (ctx, args): Promise<null> => {
    if (!await ctx.runMutation(internal.research.research.checkJob, { jobId: args.jobId })) return null;
    const provider = createProvider(process.env.APIFY_TOKEN ?? "");
    const result = await provider.getRun(args.runId);
    if (result.kind !== "ok") {
      await ctx.runMutation(internal.research.research.settleJob, {
        jobId: args.jobId, status: result.kind, message: result.message,
      });
      return null;
    }
    const run = result.value;
    if (run.status === "SUCCEEDED" && run.defaultDatasetId) {
      const dataset = await provider.getDataset(run.defaultDatasetId);
      if (dataset.kind === "ok") {
        await ctx.runMutation(internal.research.research.completeJob, {
          jobId: args.jobId, raw: dataset.value, retrievedAt: Date.now(),
        });
      } else {
        await ctx.runMutation(internal.research.research.settleJob, {
          jobId: args.jobId, status: dataset.kind, message: dataset.message,
        });
      }
    } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      await ctx.runMutation(internal.research.research.settleJob, {
        jobId: args.jobId, status: "failed", message: "The product source run did not succeed.",
      });
    } else if (Date.now() - args.startedAt >= PROVIDER_DEADLINE_MS) {
      await ctx.runMutation(internal.research.research.settleJob, {
        jobId: args.jobId, status: "uncertain", message: "Product source run is still unresolved.",
      });
    } else {
      await ctx.runMutation(internal.research.research.queuePoll, args);
    }
    return null;
  },
});

type InvalidationResult = Result<{ listingId: Id<"productListings">; cleared: number }>;

/**
 * Clear the deal first through Dev 2's hook, then mark the observation invalid.
 * Nested mutations share this transaction: a frozen-deal refusal changes neither.
 */
async function invalidateObservation(
  ctx: MutationCtx,
  listing: Doc<"productListings">,
): Promise<InvalidationResult> {
  const cleared = await ctx.runMutation(internal.proposals.clearSelectionsForListing, {
    listingId: listing._id,
  });
  if (!cleared.ok) return cleared;
  if (listing.status !== "invalid") await ctx.db.patch(listing._id, { status: "invalid" });
  return ok({ listingId: listing._id, cleared: cleared.value.cleared });
}

/** Human override: only the organizer can retire a listing in their room. */
export const invalidateListing = mutation({
  args: { roomId: v.id("rooms"), listingId: v.id("productListings") },
  handler: async (ctx, args): Promise<InvalidationResult> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Room membership required.");
    if (member.me.role !== "organizer") {
      return err("unauthorized", "Only the organizer can invalidate a listing.");
    }
    const listing = await ctx.db.get(args.listingId);
    if (!listing || listing.roomId !== args.roomId) return err("not_found", "Listing not found.");
    return invalidateObservation(ctx, listing);
  },
});

/**
 * Trusted server-only entry point for a future verified source check.
 * Not an LLM tool; no automatic stock inference or URL checking is implemented here.
 */
export const invalidateListingInternal = internalMutation({
  args: { listingId: v.id("productListings") },
  handler: async (ctx, { listingId }): Promise<InvalidationResult> => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return err("not_found", "Listing not found.");
    return invalidateObservation(ctx, listing);
  },
});
