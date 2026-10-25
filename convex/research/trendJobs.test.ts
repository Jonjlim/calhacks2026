// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";
import { trendAgentContext } from "./trendJobs";
import recorded from "../../lib/research/fixtures/google-trends.json";

const f = api.research.trendJobs;
const worker = internal.research.trendJobs;
const potteryTools = recorded[1]!;
function value<T>(r: Result<T>): T { if (!r.ok) throw new Error(r.error.message); return r.value; }
async function setup(text = "Loves pottery tools") {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "alex|session" });
  const outsider = t.withIdentity({ subject: "other|session" });
  const created = value(await alex.mutation(api.rooms.createRoom, { title: "Pottery gift", recipientDisplayName: "Maya", occasion: "Birthday", budgetMinor: 8000 }));
  const roomId = created.room._id;
  const clue = value(await alex.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text }));
  const args = { roomId, publishedClueId: clue._id, idempotencyKey: "trend-request" };
  return { t, alex, outsider, roomId, clue, args, inviteToken: created.inviteToken };
}
async function completed() {
  const s = await setup();
  const { jobId } = value(await s.alex.mutation(f.startDiscovery, s.args));
  await s.t.mutation(worker.claimDiscovery, { jobId });
  await s.t.mutation(worker.rememberRun, { jobId, runId: "trend123" });
  vi.setSystemTime(Date.now() + 100);
  await s.t.mutation(worker.completeDiscovery, { jobId, raw: potteryTools.data, retrievedAt: Date.now() });
  return { ...s, jobId };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(potteryTools.context.retrievedAt + 1000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("persisted live Google Trends discovery", () => {
  it("shops an explicitly selected sourced suggestion instead of always using the first", async () => {
    const s = await completed();
    const args = { roomId: s.roomId, publishedClueIds: [s.clue._id], trendJobId: s.jobId, idempotencyKey: "picked-second", discoveryQuery: "mkm pottery tools" };
    const result = value(await s.alex.mutation(api.research.research.startResearch, args));
    const job = await s.t.run(ctx => ctx.db.get(result.jobId));
    expect(job?.brief).toMatchObject({ queryTerms: ["mkm pottery tools"], budgetMinor: 8000 });
    expect(job?.inputHash).toContain(s.jobId);
    expect(job?.inputHash).toContain("mkm pottery tools");
    expect(value(await s.alex.mutation(api.research.research.startResearch, { ...args, idempotencyKey: "repeat-second" }))).toEqual(result);
    expect(await s.alex.mutation(api.research.research.startResearch, { ...args, discoveryQuery: "xiem pottery tools" }))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const different = value(await s.alex.mutation(api.research.research.startResearch, { ...args, idempotencyKey: "picked-fourth", discoveryQuery: "xiem pottery tools" }));
    expect(different.jobId).not.toBe(result.jobId);
  });
  it("links listings back to the trend query that found them, and only those", async () => {
    const s = await completed();
    const research = (key: string, discoveryQuery?: string, trend = true) => s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [s.clue._id], idempotencyKey: key,
      ...(trend ? { trendJobId: s.jobId } : {}), ...(discoveryQuery ? { discoveryQuery } : {}),
    });
    const picked = value(await research("picked", "mkm pottery tools"));
    const plain = value(await research("plain", undefined, false));
    const [found, gone, unrelated] = await s.t.run(async ctx => {
      const listing = (jobId: typeof picked.jobId, status: "active" | "invalid") => ctx.db.insert("productListings", {
        roomId: s.roomId, jobId, source: "manual_fixture", sourceUrl: "https://example.com/tools", title: "Tool kit",
        currency: "USD", priceMinor: 2500, priceStatus: "observed", availability: "in_stock", shippingStatus: "unknown", retrievedAt: 0, status,
      });
      for (const id of [picked.jobId, plain.jobId]) await ctx.db.patch(id, { status: "succeeded" });
      return [await listing(picked.jobId, "active"), await listing(picked.jobId, "invalid"), await listing(plain.jobId, "active")];
    });
    const view = value(await s.alex.query(f.getDiscovery, { roomId: s.roomId }));
    const suggestion = view.sample!.suggestions.find(x => x.query === "mkm pottery tools")!;
    expect(view.listingLinks).toEqual([{ listingId: found, trendJobId: s.jobId, query: "mkm pottery tools", sourceUrl: suggestion.sourceUrl }]);
    expect(view.listingLinks!.map(l => l.listingId)).not.toContain(gone);
    expect(view.listingLinks!.map(l => l.listingId)).not.toContain(unrelated);
  });
  it("deduplicates the first suggestion whether omitted or selected explicitly", async () => {
    const s = await completed();
    const args = { roomId: s.roomId, publishedClueIds: [s.clue._id], trendJobId: s.jobId, idempotencyKey: "default-suggestion" };
    const first = value(await s.alex.mutation(api.research.research.startResearch, args));
    expect(value(await s.alex.mutation(api.research.research.startResearch, { ...args, discoveryQuery: "  dirty girls pottery tools  " }))).toEqual(first);
  });
  it("refuses invented, empty, unbound and oversized direction text before creating research", async () => {
    const s = await completed();
    const args = { roomId: s.roomId, publishedClueIds: [s.clue._id], trendJobId: s.jobId, idempotencyKey: "bad-direction" };
    for (const discoveryQuery of ["made up viral gift", " ", "x".repeat(201)]) {
      expect(await s.alex.mutation(api.research.research.startResearch, { ...args, discoveryQuery }))
        .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    }
    expect(await s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [s.clue._id], idempotencyKey: "unbound", discoveryQuery: "mkm pottery tools",
    })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await s.outsider.mutation(api.research.research.startResearch, { ...args, discoveryQuery: "mkm pottery tools" }))
      .toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await s.t.run(ctx => ctx.db.query("researchJobs").collect())).toEqual([]);
  });
  it("allows an empty-source default fallback but never an explicit invented direction", async () => {
    const s = await completed();
    await s.t.run(async ctx => {
      const job = (await ctx.db.get(s.jobId))!;
      await ctx.db.patch(s.jobId, { sample: { ...job.sample!, suggestions: [] } });
    });
    const args = { roomId: s.roomId, publishedClueIds: [s.clue._id], trendJobId: s.jobId, idempotencyKey: "empty-default" };
    const fallback = value(await s.alex.mutation(api.research.research.startResearch, args));
    expect((await s.t.run(ctx => ctx.db.get(fallback.jobId)))?.brief?.queryTerms).toContain("pottery tools");
    expect(await s.alex.mutation(api.research.research.startResearch, { ...args, idempotencyKey: "empty-explicit", discoveryQuery: "mkm pottery tools" }))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("denies outsiders before creating jobs", async () => {
    const s = await setup();
    expect(await s.outsider.mutation(f.startDiscovery, s.args)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await s.outsider.query(f.getDiscovery, { roomId: s.roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await s.t.run(ctx => ctx.db.query("trendJobs").collect())).toEqual([]);
  });
  it.each(["Maybe likes pottery", "Might like pottery tools", "Likes pottery with Maya", "Lives near 123 Main St"])("does not spend for %s", async text => {
    const s = await setup(text);
    expect(await s.alex.mutation(f.startDiscovery, s.args)).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await s.t.run(ctx => ctx.db.query("trendJobs").collect())).toEqual([]);
  });
  it("persists pending and deduplicates across request keys before one claim", async () => {
    const s = await setup();
    const first = value(await s.alex.mutation(f.startDiscovery, s.args));
    expect(value(await s.alex.mutation(f.startDiscovery, s.args))).toEqual(first);
    expect(value(await s.alex.mutation(f.startDiscovery, { ...s.args, idempotencyKey: "another" }))).toEqual(first);
    expect(await s.t.run(ctx => ctx.db.get(first.jobId))).toMatchObject({ status: "pending", seedTerm: "pottery tools", publishedClueId: s.clue._id });
    expect(await s.t.mutation(worker.claimDiscovery, first)).toEqual({ seedTerm: "pottery tools" });
    expect(await s.t.mutation(worker.claimDiscovery, first)).toBeNull();
  });
  it("stores only gift-shaped related searches with provenance", async () => {
    const s = await completed();
    const sample = value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).sample;
    expect(sample?.suggestions.map(row => row.query)).toEqual(["dirty girls pottery tools", "mkm pottery tools", "pottery tools and supplies", "xiem pottery tools"]);
    expect(sample?.suggestions[1]?.signals).toEqual(expect.arrayContaining([{ kind: "rising_search", growthPercent: 300 }]));
    expect(sample?.suggestions[0]?.sourceUrl).toMatch(/^https:\/\/trends\.google\.com\/trends\/explore\?/);
    expect(sample).toMatchObject({ mode: "live_sample", context: { seedTerm: "pottery tools", geo: "US" }, evidenceSummary: { returnedRows: 1 } });
    expect(JSON.stringify(sample)).not.toMatch(/near me|names/);
  });
  it("hands the first suggestion to shopping and fences stale or mixed sources", async () => {
    const s = await completed();
    const shopping = value(await s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [s.clue._id], idempotencyKey: "trend-shopping", trendJobId: s.jobId,
    }));
    expect((await s.t.run(ctx => ctx.db.get(shopping.jobId)))?.brief?.queryTerms).toEqual(["dirty girls pottery tools"]);
    // Another memory keeps these ideas; withdrawing their own memory retires them.
    await s.alex.mutation(api.clues.upsertManualPreference, { roomId: s.roomId, kind: "ownership", text: "Owns a pottery wheel" });
    expect(value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).sample?.jobId).toBe(s.jobId);
    await s.alex.mutation(api.clues.withdrawClue, { publishedClueId: s.clue._id });
    expect(await s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [s.clue._id], idempotencyKey: "after-change", trendJobId: s.jobId,
    })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).sample).toBeNull();
  });
  it("runs the scheduled start, poll and dataset read with exactly one paid start", async () => {
    const s = await setup();
    vi.stubEnv("APIFY_TOKEN", "test-token");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: { id: "trend123", status: "RUNNING" } }))
      .mockResolvedValueOnce(Response.json({ data: { id: "trend123", status: "SUCCEEDED", defaultDatasetId: "data123" } }))
      .mockResolvedValueOnce(Response.json(potteryTools.data));
    vi.stubGlobal("fetch", fetcher);
    const job = value(await s.alex.mutation(f.startDiscovery, s.args));
    await vi.advanceTimersByTimeAsync(1000);
    await s.t.finishInProgressScheduledFunctions();
    await vi.advanceTimersByTimeAsync(4000);
    await s.t.finishInProgressScheduledFunctions();
    expect((await s.t.run(ctx => ctx.db.get(job.jobId)))?.status).toBe("succeeded");
    expect(fetcher.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(1);
  });
  it("looks up trends automatically for a new memory, once, within the room limit", async () => {
    vi.stubEnv("TREND_AUTO_DISCOVERY", "on");
    const s = await setup();
    await s.t.mutation(worker.autoDiscover, { publishedClueId: s.clue._id });
    await s.t.mutation(worker.autoDiscover, { publishedClueId: s.clue._id });
    let jobs = await s.t.run(ctx => ctx.db.query("trendJobs").collect());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ seedTerm: "pottery tools", idempotencyKey: `auto:${s.clue._id}`, status: "pending" });
    for (const text of ["Loves knitting yarn", "Loves trail running", "Loves board games"]) {
      const clue = value(await s.alex.mutation(api.clues.upsertManualPreference, { roomId: s.roomId, kind: "interest", text }));
      await s.t.mutation(worker.autoDiscover, { publishedClueId: clue._id });
    }
    jobs = await s.t.run(ctx => ctx.db.query("trendJobs").collect());
    expect(jobs).toHaveLength(3);
    const exclusion = value(await s.alex.mutation(api.clues.upsertManualPreference, { roomId: s.roomId, kind: "exclusion", text: "No candles" }));
    await s.t.mutation(worker.autoDiscover, { publishedClueId: exclusion._id });
    expect(await s.t.run(ctx => ctx.db.query("trendJobs").collect())).toHaveLength(3);
    expect(await s.alex.mutation(f.startDiscovery, { ...s.args, idempotencyKey: "auto:spoofed" })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });
  it("hides news-like suggestions stored before the filter tightened, and refuses to shop them", async () => {
    const s = await completed();
    await s.t.run(async ctx => {
      const job = (await ctx.db.get(s.jobId))!;
      await ctx.db.patch(s.jobId, { sample: { ...job.sample!, suggestions: [...job.sample!.suggestions, { query: "pottery tools accident", sourceUrl: job.sample!.suggestions[0]!.sourceUrl, signals: [{ kind: "breakout_search" }] }] } });
    });
    const view = value(await s.alex.query(f.getDiscovery, { roomId: s.roomId }));
    expect(view.samples![0]!.suggestions.map(x => x.query)).not.toContain("pottery tools accident");
    expect(await s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [s.clue._id], trendJobId: s.jobId, discoveryQuery: "pottery tools accident", idempotencyKey: "news",
    })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });
  it("respects the automatic lookup kill switch", async () => {
    const s = await setup();
    vi.stubEnv("TREND_AUTO_DISCOVERY", "off");
    await s.t.mutation(worker.autoDiscover, { publishedClueId: s.clue._id });
    expect(await s.t.run(ctx => ctx.db.query("trendJobs").collect())).toEqual([]);
  });
  it("shares attributed passes that fade, never remove, an idea; the agent skips passed ideas", async () => {
    const s = await completed();
    const bob = s.t.withIdentity({ subject: "bob|session" });
    value(await bob.mutation(api.rooms.joinRoom, { inviteToken: s.inviteToken, displayName: "Bob" }));
    const pass = { roomId: s.roomId, trendJobId: s.jobId, query: "mkm pottery tools", passed: true };
    expect(value(await bob.mutation(f.setTrendPass, pass))).toEqual({ count: 1, mine: true });
    expect(value(await bob.mutation(f.setTrendPass, pass))).toEqual({ count: 1, mine: true });
    const seen = value(await s.alex.query(f.getDiscovery, { roomId: s.roomId }));
    expect(seen.passes).toEqual([{ trendJobId: s.jobId, query: "mkm pottery tools", count: 1, mine: false, passerNames: ["Bob"] }]);
    expect(seen.sample?.suggestions.map(x => x.query)).toContain("mkm pottery tools");
    const context = await s.t.run(ctx => trendAgentContext(ctx, s.roomId));
    expect(context?.ideas.map(i => i.query)).not.toContain("mkm pottery tools");
    expect(context?.ideas.length).toBeGreaterThan(0);
    expect(await bob.mutation(f.setTrendPass, { ...pass, query: "invented idea" })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await s.outsider.mutation(f.setTrendPass, pass)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(value(await bob.mutation(f.setTrendPass, { ...pass, passed: false }))).toEqual({ count: 0, mine: false });
    expect(value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).passes).toEqual([]);
  });
  it("purges trend jobs with the room", async () => {
    const s = await completed();
    value(await s.alex.mutation(api.rooms.deleteRoom, { roomId: s.roomId, confirmTitle: "Pottery gift" }));
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.t.run(ctx => ctx.db.get(s.jobId))).toBeNull();
  });
});
