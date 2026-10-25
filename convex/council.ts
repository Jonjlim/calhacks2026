/**
 * AI Council ingest (Fetch.ai coordinator → Convex → council avatars).
 * Owner: Dev 1 + Dev 3. Contract: CONTRACTS.md § "AI Council".
 *
 * Writes come only from trusted server callers (the coordinator and the
 * Next.js server) over HTTP with `Authorization: Bearer $COUNCIL_INGEST_SECRET`.
 * Every body is validated with the shared zod schemas before touching the
 * database. Events are idempotent by eventId; decorations are upserted per
 * memory so reconnects and retries never duplicate a charm.
 *
 * Research reuses the existing pipeline unchanged: provider → normalizeDataset
 * → rankListings. Nothing here calls a language model.
 */
import { v } from "convex/values";
import { z } from "zod";
import type { ProductListing, PublishedClue } from "../lib/contracts";
import { councilEventSchema, councilRunSchema, DECORATION_PLACEMENTS } from "../lib/council/contracts";
import { internal } from "./_generated/api";
import { httpAction, internalMutation, query } from "./_generated/server";
import { normalizeDataset } from "./research/normalize";
import { createProvider } from "./research/provider";
import { rankListings } from "./research/score";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Constant-time bearer check against the deployment secret. */
function authorized(request: Request): boolean {
  const secret = process.env.COUNCIL_INGEST_SECRET ?? "";
  const header = request.headers.get("Authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (secret.length < 16 || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 16_000) throw new Error("body too large");
  return JSON.parse(text);
}

// --- Mutations (internal; reached only through the authenticated HTTP routes) ---

export const upsertRun = internalMutation({
  args: { runId: v.string(), source: v.union(v.literal("web"), v.literal("asi1")), demoKey: v.optional(v.string()), agentAddress: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("councilRuns").withIndex("by_run", (q) => q.eq("runId", args.runId)).unique();
    if (existing) return { created: false, nextSequence: existing.lastSequence + 1 };
    const now = Date.now();
    await ctx.db.insert("councilRuns", { ...args, status: "running", lastSequence: -1, startedAt: now, updatedAt: now });
    return { created: true, nextSequence: 0 };
  },
});

const eventArgs = {
  eventId: v.string(),
  runId: v.string(),
  actor: v.union(v.literal("archivist"), v.literal("muse"), v.literal("scout"), v.literal("keeper"), v.literal("courier")),
  task: v.string(),
  status: v.union(v.literal("started"), v.literal("completed"), v.literal("failed")),
  sequence: v.number(),
  timestamp: v.number(),
  result: v.optional(
    v.object({
      summary: v.optional(v.string()),
      count: v.optional(v.number()),
      decorations: v.optional(
        v.array(v.object({ memoryId: v.string(), jar: v.string(), assetId: v.string(), color: v.string(), placement: v.string(), label: v.string() })),
      ),
      cached: v.optional(v.boolean()),
      error: v.optional(v.string()),
    }),
  ),
};

export const ingestEvent = internalMutation({
  args: eventArgs,
  handler: async (ctx, e): Promise<{ status: "stored" | "duplicate" | "unknown_run" }> => {
    const run = await ctx.db.query("councilRuns").withIndex("by_run", (q) => q.eq("runId", e.runId)).unique();
    if (!run) return { status: "unknown_run" };
    const dup = await ctx.db.query("councilEvents").withIndex("by_event", (q) => q.eq("eventId", e.eventId)).unique();
    if (dup) return { status: "duplicate" };
    const now = Date.now();
    await ctx.db.insert("councilEvents", { ...e, receivedAt: now });

    // Run status only moves forward; a late "started" never reopens a finished run.
    const finished = e.actor === "courier" && e.status !== "started";
    await ctx.db.patch(run._id, {
      lastSequence: Math.max(run.lastSequence, e.sequence),
      updatedAt: now,
      ...(finished && !run.roomId && run.status === "running" ? { status: e.status === "completed" ? "completed" : "failed" } : {}),
    });

    // Persist the Muse's charms so a refresh rebuilds the same gift box.
    if (e.actor === "muse" && e.status === "completed" && run.demoKey) {
      const demoKey = run.demoKey;
      const placed = await ctx.db.query("giftDecorations").withIndex("by_demo_memory", (q) => q.eq("demoKey", demoKey)).collect();
      for (const spec of e.result?.decorations ?? []) {
        if (placed.some((d) => d.memoryId === spec.memoryId)) continue; // one charm per memory, ever
        const taken = new Set(placed.map((d) => d.placement));
        // Keep the requested slot when free; otherwise the next free slot in library order.
        const placement = !taken.has(spec.placement) ? spec.placement : DECORATION_PLACEMENTS.find((p) => !taken.has(p)) ?? spec.placement;
        const doc = { demoKey, runId: e.runId, ...spec, placement, createdAt: now };
        await ctx.db.insert("giftDecorations", doc);
        placed.push({ ...doc, _id: "" as never, _creationTime: now });
      }
    }
    if (e.actor === "muse" && e.status === "completed" && run.roomId) {
      const roomId = run.roomId;
      const placed = await ctx.db.query("giftDecorations").withIndex("by_room_memory", q => q.eq("roomId", roomId)).collect();
      const clues = await ctx.db.query("publishedClues").withIndex("by_room", q => q.eq("roomId", roomId)).collect();
      const active = new Set(clues.filter(c => c.status === "active").map(c => `mem_${c._id}`));
      for (const spec of e.result?.decorations ?? []) {
        if (!active.has(spec.memoryId) || placed.some(d => d.memoryId === spec.memoryId)) continue;
        const taken = new Set(placed.map(d => d.placement));
        const placement = !taken.has(spec.placement) ? spec.placement : DECORATION_PLACEMENTS.find(p => !taken.has(p));
        if (!placement) continue;
        const doc = { roomId, runId: e.runId, ...spec, placement, createdAt: now };
        const id = await ctx.db.insert("giftDecorations", doc);
        placed.push({ ...doc, _id: id, _creationTime: now });
      }
    }
    return { status: "stored" };
  },
});

// --- Reactive read model for the /council page ---

/**
 * Latest run for a demo key, its events (in sequence order) and the persisted
 * decorations. Demo keys are unguessable browser-session ids; the data is
 * display-only summaries and charm specs.
 */
export const demoState = query({
  args: { demoKey: v.string() },
  handler: async (ctx, { demoKey }) => {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(demoKey)) return null;
    const run = await ctx.db
      .query("councilRuns")
      .withIndex("by_demo_key", (q) => q.eq("demoKey", demoKey))
      .order("desc")
      .first();
    const decorations = await ctx.db.query("giftDecorations").withIndex("by_demo_memory", (q) => q.eq("demoKey", demoKey)).collect();
    const events = run
      ? await ctx.db.query("councilEvents").withIndex("by_run_sequence", (q) => q.eq("runId", run.runId)).collect()
      : [];
    return {
      run: run && !run.roomId ? { runId: run.runId, source: run.source, status: run.status, startedAt: run.startedAt, updatedAt: run.updatedAt } : null,
      events: events.map(({ eventId, runId, actor, task, status, sequence, timestamp, result }) => ({ eventId, runId, actor, task, status, sequence, timestamp, ...(result ? { result } : {}) })),
      decorations: decorations
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ memoryId, jar, assetId, color, placement, label }) => ({ memoryId, jar, assetId, color, placement, label })),
    };
  },
});

// --- HTTP routes (registered in http.ts) ---

export const runsHttp = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json(401, { ok: false, error: "unauthorized" });
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return json(400, { ok: false, error: "invalid JSON" });
  }
  const parsed = councilRunSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, error: parsed.error.issues[0]?.message ?? "invalid run" });
  const res = await ctx.runMutation(internal.council.upsertRun, parsed.data);
  return json(200, { ok: true, ...res });
});

export const eventsHttp = httpAction(async (ctx, request) => {
  if (!authorized(request)) return json(401, { ok: false, error: "unauthorized" });
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return json(400, { ok: false, error: "invalid JSON" });
  }
  const parsed = councilEventSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, error: parsed.error.issues[0]?.message ?? "invalid event" });
  const res = await ctx.runMutation(internal.council.ingestEvent, parsed.data);
  // Unknown run is a client ordering problem the coordinator can retry; 409 keeps it out of 5xx retries.
  return json(res.status === "unknown_run" ? 409 : 200, { ok: res.status !== "unknown_run", ...res });
});

const researchBodySchema = z.strictObject({
  queryTerms: z.array(z.string().trim().min(1).max(120)).min(1).max(3),
  mustExclude: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  budgetMinor: z.number().int().positive().max(10_000_000).optional(),
});

const RESEARCH_DEADLINE_MS = 85_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Real product research for the Scout, through the app's verified provider,
 * normaliser and ranker. Returns only listings with an https source URL; a
 * price is either exactly observed or reported as unknown.
 */
export const researchHttp = httpAction(async (_ctx, request) => {
  if (!authorized(request)) return json(401, { ok: false, error: "unauthorized" });
  let body: z.infer<typeof researchBodySchema>;
  try {
    const parsed = researchBodySchema.safeParse(await readJson(request));
    if (!parsed.success) return json(400, { ok: false, error: parsed.error.issues[0]?.message ?? "invalid request" });
    body = parsed.data;
  } catch {
    return json(400, { ok: false, error: "invalid JSON" });
  }
  const provider = createProvider(process.env.APIFY_TOKEN ?? "");
  const started = await provider.start({
    roomId: "council",
    knowledgeRevision: 0,
    queryTerms: body.queryTerms,
    mustExclude: body.mustExclude,
    listingLimit: 12,
    ...(body.budgetMinor !== undefined ? { budgetMinor: body.budgetMinor } : {}),
  });
  if (started.kind !== "ok") return json(502, { ok: false, error: started.message });
  const deadline = Date.now() + RESEARCH_DEADLINE_MS;
  let run = started.value;
  while (run.status !== "SUCCEEDED") {
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) return json(502, { ok: false, error: "The product source run did not succeed." });
    if (Date.now() > deadline) return json(504, { ok: false, error: "Product research is still running; try again shortly." });
    await sleep(3000);
    const polled = await provider.getRun(run.id);
    if (polled.kind !== "ok") return json(502, { ok: false, error: polled.message });
    run = polled.value;
  }
  if (!run.defaultDatasetId) return json(502, { ok: false, error: "The product source returned no dataset." });
  const dataset = await provider.getDataset(run.defaultDatasetId);
  if (dataset.kind !== "ok") return json(502, { ok: false, error: dataset.message });

  const retrievedAt = Date.now();
  const listings: ProductListing[] = normalizeDataset(dataset.value, retrievedAt).map((l, i) => ({
    ...l, id: `l${i}`, roomId: "council", jobId: run.id, status: "active",
  }));
  const clue = (i: number, kind: PublishedClue["kind"], text: string): PublishedClue => ({
    id: `c${i}`, roomId: "council", publisherId: "council", kind, text, sourceKind: "chat", sourceMessageIds: [], status: "active", publishedAt: retrievedAt,
  });
  const clues = [
    ...body.queryTerms.map((t, i) => clue(i, "explicit_wish", t)),
    ...body.mustExclude.map((t, i) => clue(100 + i, "ownership", t)),
  ];
  const ranked = rankListings({ listings, clues, limit: 8, ...(body.budgetMinor !== undefined ? { budgetMinor: body.budgetMinor } : {}) });
  const byId = new Map(listings.map((l) => [l.id, l]));
  return json(200, {
    ok: true,
    listings: ranked.flatMap((r) => {
      const l = byId.get(r.listingId);
      if (!l || !l.sourceUrl.startsWith("https://")) return [];
      return [{
        title: l.title,
        source_url: l.sourceUrl,
        price_minor: l.priceStatus === "observed" ? l.priceMinor ?? null : null,
        price_status: l.priceStatus === "observed" && l.priceMinor !== undefined ? "observed" : "unknown",
        currency: "USD",
        seller: l.sellerName ?? null,
        image_url: l.imageUrl ?? null,
        retrieved_at: l.retrievedAt,
        explanation: r.explanation,
      }];
    }),
  });
});
