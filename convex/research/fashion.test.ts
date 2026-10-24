// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";
import recorded from "../../lib/research/fixtures/tiktok-fashion.json";
import { FASHION_DEADLINE_MS } from "./fashionProvider";
import { FASHION_SAMPLE_TTL_MS } from "./fashionPolicy";

const f = api.research.fashion;
const worker = internal.research.fashion;
function value<T>(r: Result<T>): T { if (!r.ok) throw new Error(r.error.message); return r.value; }
async function setup(text = "Loves vintage denim") {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "alex|session" });
  const outsider = t.withIdentity({ subject: "other|session" });
  const created = value(await alex.mutation(api.rooms.createRoom, { title: "Denim gift", recipientDisplayName: "Maya", occasion: "Birthday", budgetMinor: 8000 }));
  const roomId = created.room._id;
  const clue = value(await alex.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text }));
  const args = { roomId, idempotencyKey: "fashion-request" };
  return { t, alex, outsider, roomId, clue, args };
}
async function completed() {
  const s = await setup();
  const { jobId } = value(await s.alex.mutation(f.startDiscovery, s.args));
  await s.t.mutation(worker.claimDiscovery, { jobId });
  await s.t.mutation(worker.rememberRun, { jobId, runId: "fashion123" });
  vi.setSystemTime(Date.now() + 100);
  await s.t.mutation(worker.completeDiscovery, { jobId, raw: recorded.data, retrievedAt: Date.now() });
  return { ...s, jobId };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(recorded.context.retrievedAt + 1000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("persisted live fashion discovery", () => {
  it("cancels and purges discovery on room deletion without late writes or cross-room deletion", async () => {
    const s = await setup();
    vi.stubEnv("APIFY_TOKEN", "");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const first = value(await s.alex.mutation(f.startDiscovery, s.args));
    await s.t.mutation(worker.claimDiscovery, first);
    await s.t.mutation(worker.rememberRun, { ...first, runId: "fashion123" });
    const other = value(await s.alex.mutation(api.rooms.createRoom, { title: "Preserved room", recipientDisplayName: "Sam", occasion: "Birthday" }));
    await s.alex.mutation(api.clues.upsertManualPreference, { roomId: other.room._id, kind: "interest", text: "Likes denim" });
    const preserved = value(await s.alex.mutation(f.startDiscovery, { roomId: other.room._id, idempotencyKey: "preserved" }));
    value(await s.alex.mutation(api.rooms.deleteRoom, { roomId: s.roomId, confirmTitle: "Denim gift" }));
    expect((await s.t.run(ctx => ctx.db.get(first.jobId)))?.status).toBe("canceled");
    expect(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).toMatchObject({ ok: false, error: { code: "not_found" } });
    await s.t.mutation(worker.completeDiscovery, { ...first, raw: recorded.data, retrievedAt: Date.now() });
    expect((await s.t.run(ctx => ctx.db.get(first.jobId)))?.sample).toBeUndefined();
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.t.run(ctx => ctx.db.get(first.jobId))).toBeNull();
    expect(await s.t.run(ctx => ctx.db.get(preserved.jobId))).not.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("denies outsiders before creating jobs or exposing sources", async () => {
    const s = await setup();
    expect(await s.outsider.mutation(f.startDiscovery, s.args)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await s.outsider.query(f.getDiscovery, { roomId: s.roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await s.t.run(ctx => ctx.db.query("fashionJobs").collect())).toEqual([]);
  });
  it.each(["Maybe likes vintage denim", "Interested in pottery", "Might like denim"])("does not spend for unsupported or uncertain clue: %s", async text => {
    const s = await setup(text);
    expect(await s.alex.mutation(f.startDiscovery, s.args)).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await s.t.run(ctx => ctx.db.query("fashionJobs").collect())).toEqual([]);
  });
  it("persists pending and deduplicates requests across keys before one worker claim", async () => {
    const s = await setup();
    const first = value(await s.alex.mutation(f.startDiscovery, s.args));
    expect(value(await s.alex.mutation(f.startDiscovery, s.args))).toEqual(first);
    expect(value(await s.alex.mutation(f.startDiscovery, { ...s.args, idempotencyKey: "another-key" }))).toEqual(first);
    const job = await s.t.run(ctx => ctx.db.get(first.jobId));
    expect(job).toMatchObject({ status: "pending", seedTerm: "vintage denim outfit", supportingPublishedClueIds: [s.clue._id] });
    expect(await s.t.mutation(worker.claimDiscovery, first)).toEqual({ seedTerm: "vintage denim outfit" });
    expect(await s.t.mutation(worker.claimDiscovery, first)).toBeNull();
  });
  it("keeps unknown paid-start outcomes uncertain and prevents a second POST", async () => {
    const s = await setup();
    vi.stubEnv("APIFY_TOKEN", "test-token");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private source detail"));
    vi.stubGlobal("fetch", fetcher);
    const job = value(await s.alex.mutation(f.startDiscovery, s.args));
    await s.t.action(worker.runDiscovery, job);
    await s.t.action(worker.runDiscovery, job);
    expect((await s.t.run(ctx => ctx.db.get(job.jobId)))?.status).toBe("uncertain");
    expect(value(await s.alex.mutation(f.startDiscovery, { ...s.args, idempotencyKey: "retry-key" }))).toEqual(job);
    expect(await s.alex.mutation(f.resumeDiscovery, { roomId: s.roomId, ...job })).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })))).not.toContain("private source detail");
  });
  it("stores only sourced directions and provenance, reuses a fresh sample", async () => {
    const s = await completed();
    const view = value(await s.alex.query(f.getDiscovery, { roomId: s.roomId }));
    expect(view.sample).toMatchObject({ mode: "live_sample", jobId: s.jobId, providerRunId: "fashion123", supportingPublishedClueIds: [s.clue._id] });
    expect(view.sample?.directions[0]).toMatchObject({ searchQuery: "vintage loose fit jeans", distinctCreators: 3 });
    expect(view.sample?.directions[0]?.postUrls).toHaveLength(3);
    expect(view.sample?.evidenceSummary).toEqual({ returnedRows: recorded.data.length, validRecentPosts: 4, excludedAdvertisingPosts: 0 });
    const stored = JSON.stringify(await s.t.run(ctx => ctx.db.get(s.jobId)));
    expect(stored).not.toContain("caption");
    expect(stored).not.toContain("authorProfile");
    expect(stored).not.toContain("creatorKey");
    expect(value(await s.alex.mutation(f.startDiscovery, { ...s.args, idempotencyKey: "reuse-sample" })).jobId).toBe(s.jobId);
  });
  it("turns a supported direction into an ordinary budget-bound shopping brief", async () => {
    const s = await completed();
    const result = value(await s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [s.clue._id], idempotencyKey: "shop-style", fashionJobId: s.jobId,
    }));
    const job = await s.t.run(ctx => ctx.db.get(result.jobId));
    expect(job?.brief).toMatchObject({ queryTerms: ["vintage loose fit jeans"], budgetMinor: 8000 });
    const unsupported = value(await s.alex.mutation(api.clues.upsertManualPreference, { roomId: s.roomId, kind: "interest", text: "Likes hiking" }));
    expect(await s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [unsupported._id], idempotencyKey: "foreign-clues", fashionJobId: s.jobId,
    })).toMatchObject({ ok: false, error: { code: "stale_job" } });
  });
  it("withdrawal removes discovery and blocks its shopping handoff", async () => {
    const s = await completed();
    await s.alex.mutation(api.clues.withdrawClue, { publishedClueId: s.clue._id });
    const view = value(await s.alex.query(f.getDiscovery, { roomId: s.roomId }));
    expect(view.sample).toBeNull();
    expect(view.latestJob?.status).toBe("stale");
    expect(await s.alex.mutation(f.startDiscovery, { ...s.args, idempotencyKey: "after-withdrawal" })).toMatchObject({ ok: false });
  });
  it("omits future/expired samples and permits a fresh explicitly requested run after expiry", async () => {
    const s = await completed();
    const now = (await s.t.run(ctx => ctx.db.get(s.jobId)))!.sample!.context.retrievedAt;
    // Simulate invalid future provenance without asking the test backend's
    // monotonic transaction clock to travel backwards.
    await s.t.run(async ctx => {
      const job = (await ctx.db.get(s.jobId))!;
      await ctx.db.patch(s.jobId, { sample: { ...job.sample!, context: { ...job.sample!.context, retrievedAt: now + 100_000 } } });
    });
    expect(value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).sample).toBeNull();
    await s.t.run(async ctx => {
      const job = (await ctx.db.get(s.jobId))!;
      await ctx.db.patch(s.jobId, { sample: { ...job.sample!, context: { ...job.sample!.context, retrievedAt: now } } });
    });
    vi.setSystemTime(now + FASHION_SAMPLE_TTL_MS + 100);
    expect(value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).sample).toBeNull();
    expect(value(await s.alex.mutation(f.startDiscovery, { ...s.args, idempotencyKey: "expired-refresh" })).jobId).not.toBe(s.jobId);
  });
  it("fences changed clues before start and before accepting a late dataset", async () => {
    const s = await setup();
    const first = value(await s.alex.mutation(f.startDiscovery, s.args));
    await s.alex.mutation(api.clues.upsertManualPreference, { roomId: s.roomId, kind: "ownership", text: "Owns a denim jacket" });
    expect(await s.t.mutation(worker.claimDiscovery, first)).toBeNull();
    expect((await s.t.run(ctx => ctx.db.get(first.jobId)))?.status).toBe("stale");
    const second = value(await s.alex.mutation(f.startDiscovery, { ...s.args, idempotencyKey: "new-revision" }));
    await s.t.mutation(worker.claimDiscovery, second);
    await s.t.mutation(worker.rememberRun, { ...second, runId: "fashion123" });
    await s.alex.mutation(api.clues.withdrawClue, { publishedClueId: s.clue._id });
    await s.t.mutation(worker.completeDiscovery, { ...second, raw: recorded.data, retrievedAt: Date.now() });
    expect((await s.t.run(ctx => ctx.db.get(second.jobId)))?.status).toBe("stale");
    expect(value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).sample).toBeNull();
  });
  it("resumes a saved run using GETs and fences an old watchdog after resumption", async () => {
    const s = await setup();
    const job = value(await s.alex.mutation(f.startDiscovery, s.args));
    await s.t.mutation(worker.claimDiscovery, job);
    await s.t.mutation(worker.rememberRun, { ...job, runId: "fashion123" });
    const until = (await s.t.run(ctx => ctx.db.get(job.jobId)))!.pollUntil!;
    await s.t.mutation(worker.expireDiscovery, { ...job, pollUntil: until });
    expect(value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).latestJob?.canResume).toBe(true);
    vi.setSystemTime(Date.now() + FASHION_DEADLINE_MS);
    value(await s.alex.mutation(f.resumeDiscovery, { roomId: s.roomId, ...job }));
    await s.t.mutation(worker.expireDiscovery, { ...job, pollUntil: until });
    expect((await s.t.run(ctx => ctx.db.get(job.jobId)))?.status).toBe("running");
    vi.stubEnv("APIFY_TOKEN", "test-token");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: { id: "fashion123", status: "SUCCEEDED", defaultDatasetId: "data123" } }))
      .mockResolvedValueOnce(Response.json(recorded.data));
    vi.stubGlobal("fetch", fetcher);
    await s.t.action(worker.pollDiscovery, job);
    expect((await s.t.run(ctx => ctx.db.get(job.jobId)))?.status).toBe("succeeded");
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("allows an explicit new-revision search after a known stale run, but fences unknown paid outcomes", async () => {
    for (const knownRun of [true, false]) {
      const s = await setup();
      const first = value(await s.alex.mutation(f.startDiscovery, s.args));
      await s.t.mutation(worker.claimDiscovery, first);
      if (knownRun) await s.t.mutation(worker.rememberRun, { ...first, runId: "fashion123" });
      await s.t.mutation(worker.settleDiscovery, { ...first, status: "uncertain", message: "Synthetic interrupted response" });
      await s.alex.mutation(api.clues.upsertManualPreference, { roomId: s.roomId, kind: "ownership", text: "Owns a denim jacket" });
      const next = value(await s.alex.mutation(f.startDiscovery, { ...s.args, idempotencyKey: "changed-knowledge" }));
      if (knownRun) {
        expect(next.jobId).not.toBe(first.jobId);
        expect((await s.t.run(ctx => ctx.db.get(first.jobId)))?.status).toBe("stale");
      } else {
        expect(next.jobId).toBe(first.jobId);
        expect((await s.t.run(ctx => ctx.db.get(first.jobId)))?.status).toBe("uncertain");
      }
    }
  });
  it("does not fabricate directions for empty results or contradictory evidence", async () => {
    const s = await setup();
    const job = value(await s.alex.mutation(f.startDiscovery, s.args));
    await s.t.mutation(worker.claimDiscovery, job);
    await s.t.mutation(worker.rememberRun, { ...job, runId: "fashion123" });
    vi.setSystemTime(Date.now() + 100);
    await s.t.mutation(worker.completeDiscovery, { ...job, raw: [], retrievedAt: Date.now() });
    expect(value(await s.alex.query(f.getDiscovery, { roomId: s.roomId })).sample?.directions).toEqual([]);
    const baseline = value(await s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [s.clue._id], idempotencyKey: "no-direction", fashionJobId: job.jobId,
    }));
    const ordinary = await s.t.run(ctx => ctx.db.get(baseline.jobId));
    expect(ordinary?.brief?.queryTerms).toEqual(["vintage denim"]);
    expect(ordinary?.brief?.budgetMinor).toBe(8000);
  });

  it("executes scheduled discovery and hands its sourced query to exactly one shopping start", async () => {
    const s = await setup();
    vi.stubEnv("APIFY_TOKEN", "test-token");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: { id: "fashion123", status: "RUNNING" } }))
      .mockResolvedValueOnce(Response.json({ data: { id: "fashion123", status: "SUCCEEDED", defaultDatasetId: "data123" } }))
      .mockResolvedValueOnce(Response.json(recorded.data))
      .mockResolvedValueOnce(Response.json({ data: { id: "shopping123", status: "RUNNING" } }));
    vi.stubGlobal("fetch", fetcher);
    const discovery = value(await s.alex.mutation(f.startDiscovery, s.args));
    await vi.advanceTimersByTimeAsync(1000);
    await s.t.finishInProgressScheduledFunctions();
    await vi.advanceTimersByTimeAsync(4000);
    await s.t.finishInProgressScheduledFunctions();
    expect((await s.t.run(ctx => ctx.db.get(discovery.jobId)))?.status).toBe("succeeded");
    const shopping = value(await s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [s.clue._id], idempotencyKey: "scheduled-style-shopping", fashionJobId: discovery.jobId,
    }));
    await s.t.action(internal.research.research.runResearch, shopping);
    await s.t.action(internal.research.research.runResearch, shopping);
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(writes).toHaveLength(2); // One social source run, one existing shopping source run.
    expect(JSON.parse(String(writes[1]?.[1]?.body))).toMatchObject({ q: "vintage loose fit jeans", max_price: 80 });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});
