/** Explicit, persisted public-style discovery. Dev 4; no model, payment or UI writes. */
import { v } from "convex/values";
import type { FashionDiscoveryView, Result } from "../../lib/contracts";
import { discoverFashionIdeas, normalizeTikTokPosts } from "../../lib/research/tiktok";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, mutation, query } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requireMember } from "../lib/auth";
import { err, ok } from "../lib/result";
import { fashionSeed, isFashionSampleFresh } from "./fashionPolicy";
import { createFashionProvider, FASHION_ACTOR, FASHION_BUILD, FASHION_DEADLINE_MS } from "./fashionProvider";

async function publishedSeed(ctx: QueryCtx, roomId: Id<"rooms">) {
  const clues = await ctx.db.query("publishedClues").withIndex("by_room", q => q.eq("roomId", roomId)).collect();
  return fashionSeed(clues.map(c => ({ ...c, id: c._id })));
}

export async function isFashionJobCurrent(ctx: QueryCtx, job: Doc<"fashionJobs">): Promise<boolean> {
  const room = await ctx.db.get(job.roomId);
  const member = await ctx.db.get(job.actingParticipantId);
  if (!room || room.deletedAt !== undefined || !member || member.roomId !== job.roomId || room.knowledgeRevision !== job.knowledgeRevision) return false;
  const seed = await publishedSeed(ctx, job.roomId);
  return seed?.seedTerm === job.seedTerm
    && JSON.stringify(seed.supportingPublishedClueIds) === JSON.stringify([...job.supportingPublishedClueIds].sort());
}

async function guard(ctx: MutationCtx, job: Doc<"fashionJobs">): Promise<boolean> {
  if (await isFashionJobCurrent(ctx, job)) return true;
  await ctx.db.patch(job._id, { status: "stale", lastError: "Published interests or room membership changed." });
  return false;
}

/** Used by ordinary research without exposing private imports or social captions. */
export async function usableFashionJob(ctx: QueryCtx, roomId: Id<"rooms">, id: Id<"fashionJobs">) {
  const job = await ctx.db.get(id);
  return job && job.roomId === roomId && job.status === "succeeded" && job.sample
    && isFashionSampleFresh(job.sample.context.retrievedAt, Date.now()) && await isFashionJobCurrent(ctx, job)
    ? job : null;
}

export const startDiscovery = mutation({
  args: { roomId: v.id("rooms"), idempotencyKey: v.string() },
  handler: async (ctx, args): Promise<Result<{ jobId: Id<"fashionJobs"> }>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Join this room before requesting discovery.");
    const key = args.idempotencyKey.trim();
    if (!key || key.length > 200) return err("validation_failed", "Provide a discovery request key of at most 200 characters.");
    const seed = await publishedSeed(ctx, args.roomId);
    if (!seed) return err("validation_failed", "Publish a confirmed denim interest or wish before discovery.");
    const previous = await ctx.db.query("fashionJobs").withIndex("by_room_key", q => q.eq("roomId", args.roomId).eq("idempotencyKey", key)).unique();
    if (previous) return previous.seedTerm === seed.seedTerm && previous.knowledgeRevision === member.room.knowledgeRevision
      ? ok({ jobId: previous._id }) : err("validation_failed", "Use a new request key when published interests change.");
    // An uncertain start can already be billable. Another key must not repeat it.
    const open = await ctx.db.query("fashionJobs").withIndex("by_room_seed", q => q.eq("roomId", args.roomId).eq("seedTerm", seed.seedTerm))
      .order("desc").filter(q => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "running"), q.eq(q.field("status"), "uncertain"))).first();
    if (open) {
      if (await isFashionJobCurrent(ctx, open)) return ok({ jobId: open._id });
      // A claimed/uncertain start without a run ID could already be billable.
      // Keep it blocked for operator reconciliation even if room knowledge changed.
      if (["running", "uncertain"].includes(open.status) && !open.providerRunId) return ok({ jobId: open._id });
      // A known superseded run cannot be applied, but must not permanently block
      // a human's explicit request for the new room revision.
      await ctx.db.patch(open._id, { status: "stale", lastError: "Published interests changed; the earlier discovery cannot be applied." });
    }
    const cached = await ctx.db.query("fashionJobs").withIndex("by_room_seed", q => q.eq("roomId", args.roomId).eq("seedTerm", seed.seedTerm))
      .order("desc").filter(q => q.eq(q.field("status"), "succeeded")).first();
    if (cached && await usableFashionJob(ctx, args.roomId, cached._id)) return ok({ jobId: cached._id });
    const now = Date.now();
    const jobId = await ctx.db.insert("fashionJobs", {
      roomId: args.roomId, knowledgeRevision: member.room.knowledgeRevision, actingParticipantId: member.me._id,
      supportingPublishedClueIds: seed.supportingPublishedClueIds as Id<"publishedClues">[], seedTerm: seed.seedTerm,
      status: "pending", idempotencyKey: key, createdAt: now, windowStart: now - 30 * 86400000, windowEnd: now,
    });
    await ctx.scheduler.runAfter(0, internal.research.fashion.runDiscovery, { jobId });
    return ok({ jobId });
  },
});

export const getDiscovery = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<FashionDiscoveryView>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return err(member.code, "Join this room to view discovery.");
    const latest = await ctx.db.query("fashionJobs").withIndex("by_room", q => q.eq("roomId", roomId)).order("desc").first();
    const candidate = await ctx.db.query("fashionJobs").withIndex("by_room", q => q.eq("roomId", roomId)).order("desc")
      .filter(q => q.eq(q.field("status"), "succeeded")).first();
    const usable = candidate ? await usableFashionJob(ctx, roomId, candidate._id) : null;
    const latestCurrent = latest ? await isFashionJobCurrent(ctx, latest) : false;
    return ok({ latestJob: latest ? { id: latest._id, status: latestCurrent ? latest.status : "stale", createdAt: latest.createdAt,
      ...(latest.lastError ? { lastError: latest.lastError } : {}),
      canResume: latest.status === "uncertain" && !!latest.providerRunId && latestCurrent,
    } : null, sample: usable?.sample ? { ...usable.sample, jobId: usable._id } : null });
  },
});

export const resumeDiscovery = mutation({
  args: { roomId: v.id("rooms"), jobId: v.id("fashionJobs") },
  handler: async (ctx, { roomId, jobId }): Promise<Result<null>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return err(member.code, "Join this room before resuming discovery.");
    const job = await ctx.db.get(jobId);
    if (!job || job.roomId !== roomId) return err("not_found", "Discovery job not found.");
    if (job.status !== "uncertain" || !job.providerRunId) return err("refused", "Only an unresolved known run can be resumed; unknown starts need operator review.");
    if (!await guard(ctx, job)) return err("stale_job", "Published interests changed; this discovery cannot be applied.");
    const pollUntil = Date.now() + 30_000;
    await ctx.db.patch(jobId, { status: "running", pollUntil, lastError: undefined });
    await ctx.scheduler.runAfter(0, internal.research.fashion.pollDiscovery, { jobId });
    await ctx.scheduler.runAfter(30_000, internal.research.fashion.expireDiscovery, { jobId, pollUntil });
    return ok(null);
  },
});

export const claimDiscovery = internalMutation({
  args: { jobId: v.id("fashionJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "pending" || !await guard(ctx, job)) return null;
    const pollUntil = Date.now() + FASHION_DEADLINE_MS;
    await ctx.db.patch(jobId, { status: "running", pollUntil });
    await ctx.scheduler.runAfter(FASHION_DEADLINE_MS, internal.research.fashion.expireDiscovery, { jobId, pollUntil });
    return { seedTerm: job.seedTerm };
  },
});

export const expireDiscovery = internalMutation({
  args: { jobId: v.id("fashionJobs"), pollUntil: v.number() },
  handler: async (ctx, { jobId, pollUntil }) => {
    const job = await ctx.db.get(jobId);
    if (job?.status === "running" && job.pollUntil === pollUntil && await guard(ctx, job))
      await ctx.db.patch(jobId, { status: "uncertain", lastError: "Discovery timed out. Resume the saved run; do not repeat its paid start." });
  },
});

export const settleDiscovery = internalMutation({
  args: { jobId: v.id("fashionJobs"), status: v.union(v.literal("failed"), v.literal("uncertain")), message: v.string() },
  handler: async (ctx, { jobId, status, message }) => {
    const job = await ctx.db.get(jobId);
    if (job?.status === "running" && await guard(ctx, job)) await ctx.db.patch(jobId, { status, lastError: message });
  },
});

export const rememberRun = internalMutation({
  args: { jobId: v.id("fashionJobs"), runId: v.string() },
  handler: async (ctx, { jobId, runId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !["running", "uncertain", "stale"].includes(job.status) || !/^[a-zA-Z0-9]{1,100}$/.test(runId)) return;
    // Preserve the provider reference even if room edits or a watchdog won the race.
    if (job.providerRunId && job.providerRunId !== runId) return;
    await ctx.db.patch(jobId, { providerRunId: runId });
    if (job.status === "running" && await guard(ctx, job))
      await ctx.scheduler.runAfter(3_000, internal.research.fashion.pollDiscovery, { jobId });
  },
});

export const checkDiscovery = internalMutation({
  args: { jobId: v.id("fashionJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    return job?.status === "running" && job.providerRunId && await guard(ctx, job)
      ? { runId: job.providerRunId, pollUntil: job.pollUntil ?? 0 } : null;
  },
});

export const completeDiscovery = internalMutation({
  args: { jobId: v.id("fashionJobs"), raw: v.any(), retrievedAt: v.number() },
  handler: async (ctx, { jobId, raw, retrievedAt }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running" || !job.providerRunId || !await guard(ctx, job)) return;
    if (!isFashionSampleFresh(retrievedAt, Date.now()) || retrievedAt < job.windowEnd) {
      await ctx.db.patch(jobId, { status: "uncertain", lastError: "Discovery returned an invalid retrieval time." }); return;
    }
    if (!Array.isArray(raw) || raw.length > 20) {
      await ctx.db.patch(jobId, { status: "uncertain", lastError: "Discovery returned an unsupported dataset." }); return;
    }
    const context = { seedTerm: job.seedTerm, windowStart: job.windowStart, windowEnd: job.windowEnd, retrievedAt };
    const posts = normalizeTikTokPosts(raw, context);
    const directions = discoverFashionIdeas(posts, context, 3);
    await ctx.db.patch(jobId, { status: "succeeded", lastError: undefined, sample: {
      mode: "live_sample", label: "Sampled public TikTok mentions; not platform-wide popularity or verified organic content",
      actor: FASHION_ACTOR, build: FASHION_BUILD, providerRunId: job.providerRunId, context,
      supportingPublishedClueIds: job.supportingPublishedClueIds, directions,
      evidenceSummary: { returnedRows: raw.length, validRecentPosts: posts.length, excludedAdvertisingPosts: posts.filter(p => p.advertising === "flagged").length },
    } });
  },
});

export const runDiscovery = internalAction({
  args: { jobId: v.id("fashionJobs") },
  handler: async (ctx, { jobId }): Promise<null> => {
    const claimed = await ctx.runMutation(internal.research.fashion.claimDiscovery, { jobId });
    if (!claimed) return null;
    const result = await createFashionProvider(process.env.APIFY_TOKEN ?? "").start(claimed.seedTerm);
    if (result.kind === "ok") await ctx.runMutation(internal.research.fashion.rememberRun, { jobId, runId: result.value.id });
    else await ctx.runMutation(internal.research.fashion.settleDiscovery, { jobId, status: result.kind, message: result.message });
    return null;
  },
});

export const pollDiscovery = internalAction({
  args: { jobId: v.id("fashionJobs") },
  handler: async (ctx, { jobId }): Promise<null> => {
    const current = await ctx.runMutation(internal.research.fashion.checkDiscovery, { jobId });
    if (!current) return null;
    const provider = createFashionProvider(process.env.APIFY_TOKEN ?? "");
    const result = await provider.getRun(current.runId);
    if (result.kind !== "ok") {
      await ctx.runMutation(internal.research.fashion.settleDiscovery, { jobId, status: result.kind, message: result.message }); return null;
    }
    const run = result.value;
    if (run.status === "SUCCEEDED" && run.defaultDatasetId) {
      const dataset = await provider.getDataset(run.defaultDatasetId);
      if (dataset.kind === "ok") await ctx.runMutation(internal.research.fashion.completeDiscovery, { jobId, raw: dataset.value, retrievedAt: Date.now() });
      else await ctx.runMutation(internal.research.fashion.settleDiscovery, { jobId, status: dataset.kind, message: dataset.message });
    } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      await ctx.runMutation(internal.research.fashion.settleDiscovery, { jobId, status: "failed", message: "The public fashion source run failed." });
    } else if (run.status === "SUCCEEDED" || Date.now() >= current.pollUntil) {
      await ctx.runMutation(internal.research.fashion.settleDiscovery, { jobId, status: "uncertain", message: "Fashion source run is unresolved or missing its dataset." });
    } else await ctx.scheduler.runAfter(3_000, internal.research.fashion.pollDiscovery, { jobId });
    return null;
  },
});
