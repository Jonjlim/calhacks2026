/** Explicit, persisted Google Trends discovery for one published interest. Dev 4; no model, payment or UI writes. */
import { v } from "convex/values";
import { signalLabel } from "../../lib/map/trendIdeas";
import type { Result, TrendAgentContext, TrendDiscoveryView, TrendListingLink, TrendPassSummary, TrendSignal, TrendSuggestion } from "../../lib/contracts";
import { discoverShoppingQueries, isNewsOrLookup, keepsTrendSuggestion, normalizeTrendDataset } from "../../lib/research/trends";
import { configuredModel } from "../agents/model";
import { screenTrendQueries } from "./trendScreen";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, mutation, query } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { requireMember } from "../lib/auth";
import { err, ok } from "../lib/result";
import { isTrendSampleFresh, trendSeed } from "./trendPolicy";
import {
  createTrendProvider, TREND_ACTOR, TREND_BUILD, TREND_DEADLINE_MS, TREND_GEO, TREND_MAX_ROWS, TREND_TIME_RANGE,
} from "./trendProvider";

async function currentSeed(ctx: QueryCtx, room: Doc<"rooms">, clueId: Id<"publishedClues">): Promise<string | null> {
  const clue = await ctx.db.get(clueId);
  if (!clue || clue.roomId !== room._id) return null;
  const participants = await ctx.db.query("participants").withIndex("by_room", q => q.eq("roomId", room._id)).collect();
  return trendSeed(clue, [room.recipientDisplayName, ...participants.map(p => p.displayName)]);
}

export async function isTrendJobCurrent(ctx: QueryCtx, job: Doc<"trendJobs">): Promise<boolean> {
  const room = await ctx.db.get(job.roomId);
  const member = await ctx.db.get(job.actingParticipantId);
  // Not fenced on knowledgeRevision: a new memory must not erase another memory's ideas.
  // The seed check below still retires them when their own memory is withdrawn or changed.
  if (!room || room.deletedAt !== undefined || !member || member.roomId !== job.roomId) return false;
  return await currentSeed(ctx, room, job.publishedClueId) === job.seedTerm;
}

async function guard(ctx: MutationCtx, job: Doc<"trendJobs">): Promise<boolean> {
  if (await isTrendJobCurrent(ctx, job)) return true;
  await ctx.db.patch(job._id, { status: "stale", lastError: "Published interests or room membership changed." });
  return false;
}

export async function usableTrendJob(ctx: QueryCtx, roomId: Id<"rooms">, id: Id<"trendJobs">) {
  const job = await ctx.db.get(id);
  if (!(job && job.roomId === roomId && job.status === "succeeded" && job.sample
    && isTrendSampleFresh(job.sample.context.retrievedAt, Date.now()) && await isTrendJobCurrent(ctx, job))) return null;
  // Samples stored before the gift-shaped filter tightened must not resurface news or lookups.
  const screen = job.sample.screen;
  return { ...job, sample: { ...job.sample, suggestions: job.sample.suggestions.filter(s => keepsTrendSuggestion(screen, s.query)) } };
}

/** The trend job id a research fingerprint was bound to (see startResearch's inputHash), if any. */
export function trendJobIdInFingerprint(inputHash: string): string | null {
  try {
    const parts: unknown = JSON.parse(inputHash);
    if (!Array.isArray(parts)) return null;
    const at = parts.indexOf("trend");
    return at >= 0 && typeof parts[at + 1] === "string" ? parts[at + 1] as string : null;
  } catch { return null; }
}

async function trendListingLinks(ctx: QueryCtx, roomId: Id<"rooms">, trendJobId: Id<"trendJobs">, suggestions: TrendSuggestion[]): Promise<TrendListingLink[]> {
  const byQuery = new Map(suggestions.map(s => [s.query, s.sourceUrl]));
  const jobs = await ctx.db.query("researchJobs").withIndex("by_room", q => q.eq("roomId", roomId)).order("desc").take(10);
  const links: TrendListingLink[] = [];
  const seen = new Set<string>();
  for (const job of jobs) {
    const query = job.brief?.queryTerms[0];
    const sourceUrl = query === undefined ? undefined : byQuery.get(query);
    if (job.status !== "succeeded" || !sourceUrl || trendJobIdInFingerprint(job.inputHash) !== trendJobId) continue;
    const listings = await ctx.db.query("productListings").withIndex("by_job", q => q.eq("jobId", job._id)).take(50);
    for (const listing of listings) {
      if (listing.status !== "active" || seen.has(listing._id)) continue;
      seen.add(listing._id);
      links.push({ listingId: listing._id, trendJobId, query: query!, sourceUrl });
    }
  }
  return links;
}

/** Automatic lookups per room, so sharing many memories cannot run up the Apify bill. */
export const AUTO_TRENDS_PER_ROOM = 3;
const AUTO_KEY_PREFIX = "auto:";

async function requestTrend(ctx: MutationCtx, room: Doc<"rooms">, participantId: Id<"participants">,
  publishedClueId: Id<"publishedClues">, key: string): Promise<Result<{ jobId: Id<"trendJobs"> }>> {
  const roomId = room._id;
  const seedTerm = await currentSeed(ctx, room, publishedClueId);
  if (!seedTerm) return err("validation_failed", "Choose a confirmed published interest or wish with a short, name-free product phrase.");
  const previous = await ctx.db.query("trendJobs").withIndex("by_room_key", q => q.eq("roomId", roomId).eq("idempotencyKey", key)).unique();
  if (previous) return previous.seedTerm === seedTerm && previous.publishedClueId === publishedClueId
    && previous.knowledgeRevision === room.knowledgeRevision
    ? ok({ jobId: previous._id }) : err("validation_failed", "Use a new request key when published interests change.");
  // An uncertain start can already be billable. Another key must not repeat it.
  const open = await ctx.db.query("trendJobs").withIndex("by_room_seed", q => q.eq("roomId", roomId).eq("seedTerm", seedTerm))
    .order("desc").filter(q => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "running"), q.eq(q.field("status"), "uncertain"))).first();
  if (open) {
    if (await isTrendJobCurrent(ctx, open)) return ok({ jobId: open._id });
    if (["running", "uncertain"].includes(open.status) && !open.providerRunId) return ok({ jobId: open._id });
    await ctx.db.patch(open._id, { status: "stale", lastError: "Published interests changed; the earlier trend search cannot be applied." });
  }
  const cached = await ctx.db.query("trendJobs").withIndex("by_room_seed", q => q.eq("roomId", roomId).eq("seedTerm", seedTerm))
    .order("desc").filter(q => q.eq(q.field("status"), "succeeded")).first();
  if (cached && await usableTrendJob(ctx, roomId, cached._id)) return ok({ jobId: cached._id });
  const jobId = await ctx.db.insert("trendJobs", {
    roomId, knowledgeRevision: room.knowledgeRevision, actingParticipantId: participantId,
    publishedClueId, seedTerm, status: "pending", idempotencyKey: key, createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.research.trendJobs.runDiscovery, { jobId });
  return ok({ jobId });
}

export const startDiscovery = mutation({
  args: { roomId: v.id("rooms"), publishedClueId: v.id("publishedClues"), idempotencyKey: v.string() },
  handler: async (ctx, args): Promise<Result<{ jobId: Id<"trendJobs"> }>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Join this room before requesting trends.");
    const key = args.idempotencyKey.trim();
    if (!key || key.length > 200 || key.startsWith(AUTO_KEY_PREFIX)) return err("validation_failed", "Provide a trend request key of at most 200 characters.");
    return requestTrend(ctx, member.room, member.me._id, args.publishedClueId, key);
  },
});

/** Call right after a member publishes a memory. Runs after commit, so it sees the new knowledge revision. */
export async function scheduleAutoTrend(ctx: MutationCtx, publishedClueId: Id<"publishedClues">) {
  await ctx.scheduler.runAfter(0, internal.research.trendJobs.autoDiscover, { publishedClueId });
}

/**
 * Looks up related searches for a newly shared interest or wish, without a click.
 * Skips quietly when disabled, when the memory has no safe seed, or past the room limit.
 */
export const autoDiscover = internalMutation({
  args: { publishedClueId: v.id("publishedClues") },
  handler: async (ctx, { publishedClueId }): Promise<null> => {
    if (process.env.TREND_AUTO_DISCOVERY === "off") return null;
    const clue = await ctx.db.get(publishedClueId);
    if (!clue || clue.status !== "active") return null;
    const room = await ctx.db.get(clue.roomId);
    const member = await ctx.db.get(clue.publisherId);
    if (!room || room.deletedAt !== undefined || !member || member.roomId !== room._id) return null;
    if (!await currentSeed(ctx, room, publishedClueId)) return null;
    const jobs = await ctx.db.query("trendJobs").withIndex("by_room", q => q.eq("roomId", room._id)).take(200);
    if (jobs.filter(j => j.idempotencyKey.startsWith(AUTO_KEY_PREFIX)).length >= AUTO_TRENDS_PER_ROOM) return null;
    await requestTrend(ctx, room, member._id, publishedClueId, AUTO_KEY_PREFIX + publishedClueId);
    return null;
  },
});

/** Shared, attributed "doesn't fit" on one sourced suggestion. It fades the idea for everyone; it never deletes it or any memory. */
export const setTrendPass = mutation({
  args: { roomId: v.id("rooms"), trendJobId: v.id("trendJobs"), query: v.string(), passed: v.boolean() },
  handler: async (ctx, args): Promise<Result<{ count: number; mine: boolean }>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Join this room before passing on ideas.");
    const job = await ctx.db.get(args.trendJobId);
    if (!job || job.roomId !== args.roomId || !job.sample?.suggestions.some(s => s.query === args.query && keepsTrendSuggestion(job.sample!.screen, s.query)))
      return err("validation_failed", "Pass on one of this trend search's sourced suggestions.");
    const existing = await ctx.db.query("trendPasses")
      .withIndex("by_job_query_participant", q => q.eq("trendJobId", args.trendJobId).eq("query", args.query).eq("participantId", member.me._id)).unique();
    if (args.passed && !existing) await ctx.db.insert("trendPasses", {
      roomId: args.roomId, trendJobId: args.trendJobId, query: args.query, participantId: member.me._id, createdAt: Date.now(),
    });
    if (!args.passed && existing) await ctx.db.delete(existing._id);
    const count = (await ctx.db.query("trendPasses").withIndex("by_job_query_participant", q => q.eq("trendJobId", args.trendJobId).eq("query", args.query)).take(100)).length;
    return ok({ count, mine: args.passed });
  },
});

/** Newest usable sample per memory, newest first. */
async function usableSamples(ctx: QueryCtx, roomId: Id<"rooms">) {
  const succeeded = await ctx.db.query("trendJobs").withIndex("by_room", q => q.eq("roomId", roomId)).order("desc")
    .filter(q => q.eq(q.field("status"), "succeeded")).take(30);
  const seen = new Set<string>();
  const out: Doc<"trendJobs">[] = [];
  for (const job of succeeded) {
    if (seen.has(job.publishedClueId) || out.length >= 6) continue;
    const usable = await usableTrendJob(ctx, roomId, job._id);
    if (!usable) continue;
    seen.add(job.publishedClueId);
    out.push(usable);
  }
  return out;
}

/** Buyer-agent context: current sourced ideas per memory, minus any someone passed on. */
export async function trendAgentContext(ctx: QueryCtx, roomId: Id<"rooms">): Promise<TrendAgentContext | undefined> {
  const ideas: TrendAgentContext["ideas"] = [];
  for (const job of await usableSamples(ctx, roomId)) {
    const passed = new Set((await ctx.db.query("trendPasses").withIndex("by_job_query_participant", q => q.eq("trendJobId", job._id)).take(200)).map(p => p.query));
    for (const s of job.sample!.suggestions.slice(0, 5)) if (!passed.has(s.query)) ideas.push({
      publishedClueId: job.publishedClueId, query: s.query, signal: signalLabel(s.signals), retrievedAt: job.sample!.context.retrievedAt,
    });
  }
  return ideas.length ? { mode: "live_sample", label: "Related Google Trends searches (US, past 3 months); search interest, not sales or preferences", ideas } : undefined;
}

export const getDiscovery = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<TrendDiscoveryView>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return err(member.code, "Join this room to view trends.");
    const latest = await ctx.db.query("trendJobs").withIndex("by_room", q => q.eq("roomId", roomId)).order("desc").first();
    const jobs = await usableSamples(ctx, roomId);
    const latestCurrent = latest ? await isTrendJobCurrent(ctx, latest) : false;
    const samples = jobs.map(job => ({ ...job.sample!, jobId: job._id }));
    const listingLinks = (await Promise.all(jobs.map(job => trendListingLinks(ctx, roomId, job._id, job.sample!.suggestions)))).flat();
    const participants = await ctx.db.query("participants").withIndex("by_room", q => q.eq("roomId", roomId)).collect();
    const nameOf = new Map(participants.map(p => [p._id as string, p.displayName]));
    const passes: TrendPassSummary[] = [];
    for (const job of jobs) {
      const rows = await ctx.db.query("trendPasses").withIndex("by_job_query_participant", q => q.eq("trendJobId", job._id)).take(200);
      const byQuery = new Map<string, typeof rows>();
      for (const row of rows) byQuery.set(row.query, [...(byQuery.get(row.query) ?? []), row]);
      for (const [query, list] of byQuery) passes.push({
        trendJobId: job._id, query, count: list.length, mine: list.some(r => r.participantId === member.me._id),
        passerNames: list.map(r => nameOf.get(r.participantId)).filter((n): n is string => !!n),
      });
    }
    return ok({ listingLinks, samples, passes, latestJob: latest ? { id: latest._id, status: latestCurrent ? latest.status : "stale", createdAt: latest.createdAt,
      ...(latest.lastError ? { lastError: latest.lastError } : {}),
      canResume: latest.status === "uncertain" && !!latest.providerRunId && latestCurrent,
    } : null, sample: samples[0] ?? null });
  },
});
export const resumeDiscovery = mutation({
  args: { roomId: v.id("rooms"), jobId: v.id("trendJobs") },
  handler: async (ctx, { roomId, jobId }): Promise<Result<null>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return err(member.code, "Join this room before resuming trends.");
    const job = await ctx.db.get(jobId);
    if (!job || job.roomId !== roomId) return err("not_found", "Trend job not found.");
    if (job.status !== "uncertain" || !job.providerRunId) return err("refused", "Only an unresolved known run can be resumed; unknown starts need operator review.");
    if (!await guard(ctx, job)) return err("stale_job", "Published interests changed; this trend search cannot be applied.");
    const pollUntil = Date.now() + 30_000;
    await ctx.db.patch(jobId, { status: "running", pollUntil, lastError: undefined });
    await ctx.scheduler.runAfter(0, internal.research.trendJobs.pollDiscovery, { jobId });
    await ctx.scheduler.runAfter(30_000, internal.research.trendJobs.expireDiscovery, { jobId, pollUntil });
    return ok(null);
  },
});

export const claimDiscovery = internalMutation({
  args: { jobId: v.id("trendJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "pending" || !await guard(ctx, job)) return null;
    const pollUntil = Date.now() + TREND_DEADLINE_MS;
    await ctx.db.patch(jobId, { status: "running", pollUntil });
    await ctx.scheduler.runAfter(TREND_DEADLINE_MS, internal.research.trendJobs.expireDiscovery, { jobId, pollUntil });
    return { seedTerm: job.seedTerm };
  },
});

export const expireDiscovery = internalMutation({
  args: { jobId: v.id("trendJobs"), pollUntil: v.number() },
  handler: async (ctx, { jobId, pollUntil }) => {
    const job = await ctx.db.get(jobId);
    if (job?.status === "running" && job.pollUntil === pollUntil && await guard(ctx, job))
      await ctx.db.patch(jobId, { status: "uncertain", lastError: "Trend search timed out. Resume the saved run; do not repeat its paid start." });
  },
});

export const settleDiscovery = internalMutation({
  args: { jobId: v.id("trendJobs"), status: v.union(v.literal("failed"), v.literal("uncertain")), message: v.string() },
  handler: async (ctx, { jobId, status, message }) => {
    const job = await ctx.db.get(jobId);
    if (job?.status === "running" && await guard(ctx, job)) await ctx.db.patch(jobId, { status, lastError: message });
  },
});

export const rememberRun = internalMutation({
  args: { jobId: v.id("trendJobs"), runId: v.string() },
  handler: async (ctx, { jobId, runId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !["running", "uncertain", "stale"].includes(job.status) || !/^[a-zA-Z0-9]{1,100}$/.test(runId)) return;
    // Preserve the provider reference even if room edits or a watchdog won the race.
    if (job.providerRunId && job.providerRunId !== runId) return;
    await ctx.db.patch(jobId, { providerRunId: runId });
    if (job.status === "running" && await guard(ctx, job))
      await ctx.scheduler.runAfter(3_000, internal.research.trendJobs.pollDiscovery, { jobId });
  },
});

export const checkDiscovery = internalMutation({
  args: { jobId: v.id("trendJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    return job?.status === "running" && job.providerRunId && await guard(ctx, job)
      ? { runId: job.providerRunId, pollUntil: job.pollUntil ?? 0, seedTerm: job.seedTerm } : null;
  },
});

export const completeDiscovery = internalMutation({
  args: { jobId: v.id("trendJobs"), raw: v.any(), retrievedAt: v.number(), giftQueries: v.optional(v.array(v.string())) },
  handler: async (ctx, { jobId, raw, retrievedAt, giftQueries }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running" || !job.providerRunId || !await guard(ctx, job)) return;
    if (!isTrendSampleFresh(retrievedAt, Date.now()) || retrievedAt < job.createdAt) {
      await ctx.db.patch(jobId, { status: "uncertain", lastError: "Trend search returned an invalid retrieval time." }); return;
    }
    if (!Array.isArray(raw) || raw.length > TREND_MAX_ROWS) {
      await ctx.db.patch(jobId, { status: "uncertain", lastError: "Trend search returned an unsupported dataset." }); return;
    }
    const context = { seedTerm: job.seedTerm, geo: TREND_GEO, timeRange: TREND_TIME_RANGE, retrievedAt };
    const observations = normalizeTrendDataset(raw, context);
    const approved = giftQueries ? new Set(giftQueries) : null;
    const suggestions: TrendSuggestion[] = discoverShoppingQueries(observations, 5,
      approved ? q => approved.has(q) && !isNewsOrLookup(q) : undefined).map(row => ({
      query: row.query, sourceUrl: row.evidence[0]!.sourceUrl,
      signals: row.evidence.map((e): TrendSignal => e.kind === "top_search" ? { kind: e.kind, popularityIndex: e.popularityIndex }
        : e.kind === "rising_search" ? { kind: e.kind, growthPercent: e.growthPercent } : { kind: e.kind }),
    }));
    await ctx.db.patch(jobId, { status: "succeeded", lastError: undefined, sample: {
      mode: "live_sample", label: "Related Google searches in the US over the past 3 months; search interest, not sales",
      actor: TREND_ACTOR, build: TREND_BUILD, providerRunId: job.providerRunId, context,
      publishedClueId: job.publishedClueId, suggestions, screen: approved ? "model" : "words",
      evidenceSummary: { returnedRows: raw.length, observations: observations.length },
    } });
  },
});

export const runDiscovery = internalAction({
  args: { jobId: v.id("trendJobs") },
  handler: async (ctx, { jobId }): Promise<null> => {
    const claimed = await ctx.runMutation(internal.research.trendJobs.claimDiscovery, { jobId });
    if (!claimed) return null;
    const result = await createTrendProvider(process.env.APIFY_TOKEN ?? "").start(claimed.seedTerm);
    if (result.kind === "ok") await ctx.runMutation(internal.research.trendJobs.rememberRun, { jobId, runId: result.value.id });
    else await ctx.runMutation(internal.research.trendJobs.settleDiscovery, { jobId, status: result.kind, message: result.message });
    return null;
  },
});

/** Model sorts the scraped searches; null means fall back to the word filter. */
async function screenDataset(seedTerm: string, raw: unknown, retrievedAt: number): Promise<string[] | undefined> {
  if (process.env.TREND_AI_SCREEN === "off" || !process.env.LLM_API_KEY) return undefined;
  const observations = normalizeTrendDataset(raw, { seedTerm, geo: TREND_GEO, timeRange: TREND_TIME_RANGE, retrievedAt });
  const candidates = discoverShoppingQueries(observations, 40, q => !isNewsOrLookup(q)).map(c => c.query);
  if (!candidates.length) return undefined;
  const kept = await screenTrendQueries(configuredModel(), seedTerm, candidates);
  return kept ?? undefined;
}

export const pollDiscovery = internalAction({
  args: { jobId: v.id("trendJobs") },
  handler: async (ctx, { jobId }): Promise<null> => {
    const current = await ctx.runMutation(internal.research.trendJobs.checkDiscovery, { jobId });
    if (!current) return null;
    const provider = createTrendProvider(process.env.APIFY_TOKEN ?? "");
    const result = await provider.getRun(current.runId);
    if (result.kind !== "ok") {
      await ctx.runMutation(internal.research.trendJobs.settleDiscovery, { jobId, status: result.kind, message: result.message }); return null;
    }
    const run = result.value;
    if (run.status === "SUCCEEDED" && run.defaultDatasetId) {
      const dataset = await provider.getDataset(run.defaultDatasetId);
      if (dataset.kind === "ok") {
        const retrievedAt = Date.now();
        const giftQueries = await screenDataset(current.seedTerm, dataset.value, retrievedAt);
        await ctx.runMutation(internal.research.trendJobs.completeDiscovery, { jobId, raw: dataset.value, retrievedAt, ...(giftQueries ? { giftQueries } : {}) });
      }
      else await ctx.runMutation(internal.research.trendJobs.settleDiscovery, { jobId, status: dataset.kind, message: dataset.message });
    } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      await ctx.runMutation(internal.research.trendJobs.settleDiscovery, { jobId, status: "failed", message: "The trend source run failed." });
    } else if (run.status === "SUCCEEDED" || Date.now() >= current.pollUntil) {
      await ctx.runMutation(internal.research.trendJobs.settleDiscovery, { jobId, status: "uncertain", message: "Trend source run is unresolved or missing its dataset." });
    } else await ctx.scheduler.runAfter(3_000, internal.research.trendJobs.pollDiscovery, { jobId });
    return null;
  },
});
