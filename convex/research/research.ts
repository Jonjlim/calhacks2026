/**
 * Dev 4 research pipeline. Public endpoints enforce membership; workers are internal.
 * Own job transitions locally so Dev 2's generic jobs.ts remains untouched.
 */
import { v } from "convex/values";
import type { ProductListing, PublishedClue, RecommendationsView, Result, SearchBrief } from "../../lib/contracts";
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
import { rankListings } from "./score";
import { createProvider, PROVIDER_DEADLINE_MS } from "./provider";

type StoredBrief = NonNullable<Doc<"researchJobs">["brief"]>;
type ClaimedJob = { brief: SearchBrief } | null;

function toClue(doc: Doc<"publishedClues">): PublishedClue {
  const { _id, _creationTime: _, ...fields } = doc;
  return { ...fields, id: _id };
}
function toListing(doc: Doc<"productListings">): ProductListing {
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
  },
  handler: async (ctx, args): Promise<Result<{ jobId: Id<"researchJobs"> }>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Join this room before searching.");
    const room = member.room;
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
    // Canonical collision-free input fingerprint. It contains no raw imports or private caps.
    const inputHash = JSON.stringify([room._id, room.knowledgeRevision, clueIds, budgetMinor ?? null]);
    const previous = await ctx.db.query("researchJobs")
      .withIndex("by_room_idempotency", q => q.eq("roomId", room._id).eq("idempotencyKey", key)).unique();
    if (previous) return previous.inputHash === inputHash
      ? ok({ jobId: previous._id })
      : err("validation_failed", "Use a new request key when search inputs change.");
    const recent = await ctx.db.query("researchJobs")
      .withIndex("by_room", q => q.eq("roomId", room._id)).order("desc").take(50);
    const duplicate = recent.find(job => job.inputHash === inputHash
      && ["pending", "running", "uncertain"].includes(job.status));
    if (duplicate) return ok({ jobId: duplicate._id });
    // Explicit persistence adapter for existing Dev 2 validator: roomId lives on the job.
    // Full SearchBrief is restored when calling the provider. No silent schema change.
    const { roomId: _roomId, ...storedBrief } = brief;
    const { jobId, created } = await insertResearchJob(ctx, {
      roomId: room._id, knowledgeRevision: room.knowledgeRevision,
      publishedClueIds: clueIds, brief: storedBrief satisfies StoredBrief,
      inputHash, idempotencyKey: key,
    });
    if (created) await ctx.scheduler.runAfter(0, internal.research.research.runResearch, { jobId });
    return ok({ jobId });
  },
});

export const listRecommendations = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<Result<RecommendationsView>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Join this room to see gifts.");
    const room = member.room;
    // by_room's creation-order suffix gives request order, not completion order.
    const recent = await ctx.db.query("researchJobs")
      .withIndex("by_room", q => q.eq("roomId", room._id)).order("desc").take(50);
    const latest = recent.find(job => job.status === "succeeded");
    if (!latest) return ok({ recommendations: [], listings: [] });
    const docs = await ctx.db.query("productListings")
      .withIndex("by_job", q => q.eq("jobId", latest._id)).collect();
    const clues = (await ctx.db.query("publishedClues")
      .withIndex("by_room", q => q.eq("roomId", room._id)).collect())
      .filter(clue => clue.status === "active").map(toClue);
    const listings = docs.filter(listing => listing.status === "active" && listing.roomId === room._id).map(toListing);
    const ranked = rankListings({
      listings, clues, budgetMinor: room.budgetMinor, limit: latest.brief?.listingLimit ?? 12,
    });
    const recommendations = ranked.map(row => ({
      ...row, id: latest._id + ":" + row.listingId, roomId: room._id,
      // Stable observation time: do not manufacture a new timestamp on every reactive read.
      createdAt: latest.createdAt,
    }));
    const visible = new Set(recommendations.map(row => row.listingId));
    return ok({ recommendations, listings: listings.filter(listing => visible.has(listing.id)) });
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
    if (job?.status === "running") await ctx.db.patch(jobId, {
      status: "uncertain", lastError: "Research did not finish in time. Check the provider run before retrying.",
    });
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
      return null;
    }
    // Retain the full small candidate pool for instant clue-based re-ranking.
    for (const listing of listings.slice(0, 60)) {
      const parsed = normalizedListingSchema.parse(listing);
      await ctx.db.insert("productListings", { ...parsed, roomId: job.roomId, jobId: job._id, status: "active" });
    }
    await ctx.db.patch(job._id, { status: "succeeded", lastError: undefined });
    return null;
  },
});

export const queuePoll = internalMutation({
  args: { jobId: v.id("researchJobs"), runId: v.string(), startedAt: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running") return null;
    if (await staleUnlessCurrent(ctx, job)) return null;
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
