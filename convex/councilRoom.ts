/** Room-authorized council bridge. Convex owns jobs, listings and membership. */
import { v } from "convex/values";
import { z } from "zod";
import type { PublishedClue, Result } from "../lib/contracts";
import { councilEventSchema, decorationSpecSchema } from "../lib/council/contracts";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { err, ok } from "./lib/result";
import { insertResearchJob } from "./jobs";
import { buildSearchBrief } from "./research/brief";
import { rankListings } from "./research/score";

const json = (status: number, body: unknown) => Response.json(body, { status });
function authorized(request: Request) {
  const secret = process.env.COUNCIL_INGEST_SECRET ?? "";
  const given = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (secret.length < 16 || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
const runArgs = { runId: v.string() };

export const start = mutation({
  args: { roomId: v.id("rooms"), publishedClueIds: v.array(v.id("publishedClues")), idempotencyKey: v.string() },
  handler: async (ctx, args): Promise<Result<{ runId: string; jobId: Id<"researchJobs"> }>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Join this room before asking the council.");
    if (!args.idempotencyKey.trim() || args.idempotencyKey.length > 200 || args.publishedClueIds.length > 100) return err("validation_failed", "Invalid request key or clue count.");
    const ids = [...new Set(args.publishedClueIds)].sort();
    const clues: PublishedClue[] = [];
    for (const id of ids) {
      const clue = await ctx.db.get(id);
      if (!clue || clue.roomId !== args.roomId || clue.status !== "active") return err("validation_failed", "Only active published clues from this room can be used.");
      const { _id, _creationTime: _, ...fields } = clue;
      clues.push({ ...fields, id: _id });
    }
    const room = member.room;
    const brief = buildSearchBrief({ roomId: room._id, knowledgeRevision: room.knowledgeRevision, clues, budgetMinor: room.budgetMinor, occasion: room.occasion });
    if (!brief.queryTerms.length) return err("validation_failed", "Share an interest or wish before asking the council.");
    const previous = await ctx.db.query("councilRuns").withIndex("by_room_request", q => q.eq("roomId", room._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (previous?.researchJobId) return ok({ runId: previous.runId, jobId: previous.researchJobId });
    const recent = await ctx.db.query("councilRuns").withIndex("by_room", q => q.eq("roomId", room._id)).order("desc").take(20);
    const active = recent.find(r => ["running", "uncertain"].includes(r.status));
    if (active?.researchJobId) return ok({ runId: active.runId, jobId: active.researchJobId });
    const inputHash = JSON.stringify([room._id, room.knowledgeRevision, ids, room.budgetMinor ?? null]);
    const { roomId: _, ...storedBrief } = brief;
    const { jobId } = await insertResearchJob(ctx, { roomId: room._id, knowledgeRevision: room.knowledgeRevision, publishedClueIds: ids, brief: storedBrief, inputHash, idempotencyKey: `council:${args.idempotencyKey}` });
    await ctx.db.patch(jobId, { actingParticipantId: member.me._id, latestMessageId: room.latestMessageId });
    const runId = `run_${jobId}`;
    const now = Date.now();
    await ctx.db.insert("councilRuns", { runId, source: "web", roomId: room._id, researchJobId: jobId, knowledgeRevision: room.knowledgeRevision, idempotencyKey: args.idempotencyKey, status: "running", lastSequence: -1, startedAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.councilRoom.dispatch, { runId });
    await ctx.scheduler.runAfter(150_000, internal.councilRoom.expire, { runId });
    return ok({ runId, jobId });
  },
});

export const state = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return err(member.code, "Join this room to see the council.");
    const run = await ctx.db.query("councilRuns").withIndex("by_room", q => q.eq("roomId", roomId)).order("desc").first();
    const events = run ? await ctx.db.query("councilEvents").withIndex("by_run_sequence", q => q.eq("runId", run.runId)).collect() : [];
    const clues = await ctx.db.query("publishedClues").withIndex("by_room", q => q.eq("roomId", roomId)).collect();
    const active = new Set(clues.filter(c => c.status === "active").map(c => `mem_${c._id}`));
    const decorations = await ctx.db.query("giftDecorations").withIndex("by_room_memory", q => q.eq("roomId", roomId)).collect();
    return ok({
      run: run ? { runId: run.runId, status: run.status, updatedAt: run.updatedAt, startedAt: run.startedAt, error: run.error, cached: run.cached, excluded: run.excluded ?? [], stale: run.knowledgeRevision !== member.room.knowledgeRevision } : null,
      events: events.flatMap(({ _id, _creationTime, receivedAt, ...e }) => { const parsed = councilEventSchema.safeParse(e); return parsed.success ? [parsed.data] : []; }),
      decorations: decorations.filter(d => active.has(d.memoryId)).flatMap(({ memoryId, jar, assetId, color, placement, label }) => { const parsed = decorationSpecSchema.safeParse({ memoryId, jar, assetId, color, placement, label }); return parsed.success ? [parsed.data] : []; }),
    });
  },
});

export const context = internalQuery({
  args: runArgs,
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.query("councilRuns").withIndex("by_run", q => q.eq("runId", runId)).unique();
    if (!run?.roomId || !run.researchJobId) return null;
    const room = await ctx.db.get(run.roomId);
    const job = await ctx.db.get(run.researchJobId);
    if (!room || !job || room.knowledgeRevision !== run.knowledgeRevision) return null;
    const clues = (await Promise.all(job.publishedClueIds.map(id => ctx.db.get(id)))).filter(c => c !== null).filter(c => c.status === "active" && c.roomId === room._id);
    if (clues.length !== job.publishedClueIds.length) return null;
    const listings = await ctx.db.query("productListings").withIndex("by_job", q => q.eq("jobId", job._id)).collect();
    return { run, room, job, clues, listings };
  },
});

export const mark = internalMutation({
  args: { ...runArgs, status: v.union(v.literal("failed"), v.literal("uncertain")), error: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.query("councilRuns").withIndex("by_run", q => q.eq("runId", args.runId)).unique();
    if (run && !run.deliveredAt && ["running", "uncertain"].includes(run.status)) {
      await ctx.db.patch(run._id, { status: args.status, error: args.error.slice(0, 160), updatedAt: Date.now() });
      if (args.status === "failed" && run.researchJobId) {
        const job = await ctx.db.get(run.researchJobId);
        if (job?.status === "pending") await ctx.db.patch(job._id, { status: "failed", lastError: args.error.slice(0, 160) });
      }
    }
  },
});

export const expire = internalMutation({
  args: runArgs,
  handler: async (ctx, args) => {
    const run = await ctx.db.query("councilRuns").withIndex("by_run", q => q.eq("runId", args.runId)).unique();
    if (run?.status === "running") await ctx.db.patch(run._id, { status: "uncertain", error: "The council was interrupted. Resume this request to check its existing research.", updatedAt: Date.now() });
  },
});

export const resume = mutation({
  args: { roomId: v.id("rooms"), runId: v.string() },
  handler: async (ctx, args): Promise<Result<null>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return err(member.code, "Join this room first.");
    const run = await ctx.db.query("councilRuns").withIndex("by_run", q => q.eq("runId", args.runId)).unique();
    if (!run || run.roomId !== args.roomId) return err("not_found", "Request not found.");
    if (run.knowledgeRevision !== member.room.knowledgeRevision) {
      await ctx.db.patch(run._id, { status: "failed", error: "Clues changed. Start a new request." });
      return err("stale_job", "Clues changed. Start a new council request.");
    }
    if (run.status !== "uncertain") return err("validation_failed", "This request does not need recovery.");
    await ctx.db.patch(run._id, { status: "running", error: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.councilRoom.dispatch, { runId: args.runId });
    await ctx.scheduler.runAfter(150_000, internal.councilRoom.expire, { runId: args.runId });
    return ok(null);
  },
});

export const dispatch = internalAction({
  args: runArgs,
  handler: async (ctx, { runId }): Promise<null> => {
    const data = await ctx.runQuery(internal.councilRoom.context, { runId });
    if (!data || data.run.deliveredAt) return null;
    const url = process.env.FETCH_AGENT_URL;
    const secret = process.env.COUNCIL_AGENT_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.councilRoom.mark, { runId, status: "failed", error: "Council service is not configured. Set FETCH_AGENT_URL and COUNCIL_AGENT_SECRET on this Convex deployment." });
      return null;
    }
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/council/run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ secret, runId, roomRun: true, demoKey: "", budgetMinor: data.room.budgetMinor ?? null, memories: data.clues.map(c => ({ memoryId: `mem_${c._id}`, text: `${c.kind}: ${c.text}` })) }),
      });
      const body = await response.json() as { ok?: boolean };
      if (!response.ok || !body.ok) await ctx.runMutation(internal.councilRoom.mark, { runId, status: "failed", error: "The council service rejected this request. Check service credentials and health." });
    } catch {
      await ctx.runMutation(internal.councilRoom.mark, { runId, status: "uncertain", error: "The council did not acknowledge in time. Resume this request; it may already be working." });
    }
    return null;
  },
});

const resultSchema = z.strictObject({
  runId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
  kept: z.array(z.strictObject({ sourceUrl: z.string().url().max(3000), notes: z.array(z.string().max(300)).max(10) })).max(12),
  excluded: z.array(z.strictObject({ title: z.string().max(200), reason: z.string().max(300) })).max(60),
  cached: z.boolean(), error: z.string().max(160).optional(),
});
export const storeResults = internalMutation({
  args: { body: v.string() },
  handler: async (ctx, { body }): Promise<Result<null>> => {
    const parsed = resultSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return err("validation_failed", "Invalid council results.");
    const result = parsed.data;
    const run = await ctx.db.query("councilRuns").withIndex("by_run", q => q.eq("runId", result.runId)).unique();
    if (!run?.roomId || !run.researchJobId) return err("unauthorized", "No authorized room run.");
    if (run.deliveredAt) return ok(null);
    const room = await ctx.db.get(run.roomId);
    const job = await ctx.db.get(run.researchJobId);
    if (!room || !job || room.knowledgeRevision !== run.knowledgeRevision) return err("stale_job", "Room clues changed during research.");
    if (result.kept.length && job.status !== "succeeded") return err("validation_failed", "Research has not produced verified listings.");
    const listings = await ctx.db.query("productListings").withIndex("by_job", q => q.eq("jobId", job._id)).collect();
    const approved: { listingId: Id<"productListings">; notes: string[] }[] = [];
    for (const verdict of result.kept) {
      const listing = listings.find(l => l.roomId === room._id && l.sourceUrl === verdict.sourceUrl && l.status === "active");
      if (!listing) return err("validation_failed", "A recommendation was not observed in this run.");
      if (!approved.some(a => a.listingId === listing._id)) approved.push({ listingId: listing._id, notes: verdict.notes });
    }
    const charms = await ctx.db.query("giftDecorations").withIndex("by_room_memory", q => q.eq("roomId", room._id)).collect();
    const unresolved = ["pending", "running", "uncertain"].includes(job.status);
    await ctx.db.patch(run._id, {
      approved, excluded: result.excluded, cached: result.cached, updatedAt: Date.now(),
      ...(!unresolved ? { deliveredAt: Date.now() } : {}),
      status: unresolved ? "uncertain" : approved.length ? "completed" : charms.some(d => d.runId === run.runId) ? "partial" : "failed",
      error: approved.length ? undefined : result.error ?? job.lastError ?? "No verified gifts matched these clues.",
    });
    return ok(null);
  },
});

export const resultsHttp = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json(401, { ok: false });
  const body = await request.text();
  if (body.length > 32000) return json(400, { ok: false, error: "Payload too large" });
  try {
    const parsed = resultSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return json(400, { ok: false, error: "Invalid results" });
    const result = await ctx.runMutation(internal.councilRoom.storeResults, { body });
    return json(result.ok ? 200 : 409, result);
  } catch { return json(400, { ok: false, error: "Invalid results" }); }
});

export const researchHttp = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json(401, { ok: false });
  let runId: string;
  try { runId = z.strictObject({ runId: z.string().max(64) }).parse(await request.json()).runId; }
  catch { return json(400, { ok: false, error: "Invalid run" }); }
  let data = await ctx.runQuery(internal.councilRoom.context, { runId });
  if (!data) return json(409, { ok: false, error: "Unknown or stale room request." });
  if (data.job.status === "pending") await ctx.runAction(internal.research.research.runResearch, { jobId: data.job._id });
  if (data.job.status === "uncertain" && data.job.providerRunId) await ctx.runMutation(internal.councilRoom.reconcile, { runId });
  const deadline = Date.now() + 75000;
  while (Date.now() < deadline) {
    data = await ctx.runQuery(internal.councilRoom.context, { runId });
    if (!data) return json(409, { ok: false, error: "The room clues changed. Start a new request." });
    if (data.job.status === "succeeded") {
      const listings = data.listings.map(({ _id, _creationTime, ...l }) => ({ ...l, id: _id }));
      const clues = data.clues.map(({ _id, _creationTime, ...c }) => ({ ...c, id: _id }));
      const ranked = rankListings({ listings, clues, budgetMinor: data.room.budgetMinor, limit: 12 });
      return json(200, { ok: true, listings: ranked.flatMap(r => {
        const l = listings.find(l => l.id === r.listingId);
        if (!l) return [];
        return [{ title: l.title, source_url: l.sourceUrl, price_minor: l.priceMinor ?? null, price_status: l.priceStatus, currency: l.currency, seller: l.sellerName ?? null, image_url: l.imageUrl ?? null, retrieved_at: l.retrievedAt, explanation: r.explanation }];
      }) });
    }
    if (["failed", "uncertain", "stale"].includes(data.job.status)) return json(409, { ok: false, error: data.job.lastError ?? "Research needs recovery." });
    await new Promise(r => setTimeout(r, 1500));
  }
  return json(504, { ok: false, error: "Research is still running. Resume the existing request." });
});

export const reconcile = internalMutation({
  args: runArgs,
  handler: async (ctx, { runId }): Promise<null> => {
    const run = await ctx.db.query("councilRuns").withIndex("by_run", q => q.eq("runId", runId)).unique();
    const job = run?.researchJobId ? await ctx.db.get(run.researchJobId) : null;
    if (job?.status !== "uncertain" || !job.providerRunId) return null;
    await ctx.db.patch(job._id, { status: "running", lastError: undefined });
    await ctx.scheduler.runAfter(0, internal.research.research.pollResearch, { jobId: job._id, runId: job.providerRunId, startedAt: Date.now() });
    await ctx.scheduler.runAfter(90000, internal.research.research.expireJob, { jobId: job._id });
    return null;
  },
});
