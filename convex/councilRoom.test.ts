// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../lib/contracts";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import fixture from "./research/fixtures/johnvc-shopping.json";
const modules = import.meta.glob("./**/*.*s");
function value<T>(r: Result<T>): T { if (!r.ok) throw new Error(r.error.message); return r.value; }
async function setup() {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "alex|session1" });
  const eve = t.withIdentity({ subject: "eve|session2" });
  const room = value(await alex.mutation(api.rooms.createRoom, { title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday", budgetMinor: 8000 })).room;
  const other = value(await eve.mutation(api.rooms.createRoom, { title: "Other", recipientDisplayName: "Other", occasion: "Birthday" })).room;
  const clue = value(await alex.mutation(api.clues.upsertManualPreference, { roomId: room._id, kind: "interest", text: "pottery" }));
  const args = { roomId: room._id, publishedClueIds: [clue._id], idempotencyKey: "council-request1" };
  return { t, alex, eve, room, other, clue, args };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("room council boundaries and recovery", () => {
  it("requires membership, rejects other-room clues and deduplicates active jobs", async () => {
    const { t, alex, eve, room, other, clue, args } = await setup();
    expect(await eve.mutation(api.councilRoom.start, args)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await eve.mutation(api.councilRoom.start, { ...args, roomId: other._id })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const a = value(await alex.mutation(api.councilRoom.start, args));
    expect(value(await alex.mutation(api.councilRoom.start, { ...args, idempotencyKey: "new-click" }))).toEqual(a);
    expect(await t.run(ctx => ctx.db.query("researchJobs").collect())).toHaveLength(1);
    expect(await eve.query(api.councilRoom.state, { roomId: room._id })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    const ctx = await t.query(internal.councilRoom.context, { runId: a.runId });
    expect(ctx?.clues.map(c => c._id)).toEqual([clue._id]);
    expect(ctx?.job.brief?.budgetMinor).toBe(8000);
  });
  it("persists observed products once, hides unfinished/rejected results and keeps selection usable", async () => {
    const { t, alex, room, args } = await setup();
    const run = value(await alex.mutation(api.councilRoom.start, args));
    await t.mutation(internal.research.research.claimJob, { jobId: run.jobId });
    await t.mutation(internal.research.research.completeJob, { jobId: run.jobId, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
    expect(value(await alex.query(api.research.research.listRecommendations, { roomId: room._id })).listings).toHaveLength(0);
    const rows = await t.run(ctx => ctx.db.query("productListings").collect());
    const keep = rows.find(l => l.priceStatus === "observed" && (l.priceMinor ?? 999999) <= 8000)!;
    const body = JSON.stringify({ runId: run.runId, kept: [{ sourceUrl: keep.sourceUrl, notes: ["Within the shared gift budget."] }], excluded: [], cached: false });
    expect(await t.mutation(internal.councilRoom.storeResults, { body })).toEqual({ ok: true, value: null });
    await t.mutation(internal.councilRoom.storeResults, { body });
    const recs = value(await alex.query(api.research.research.listRecommendations, { roomId: room._id }));
    expect(recs.listings).toHaveLength(1);
    expect(recs.recommendations[0]?.explanation).toContain("Within the shared gift budget");
    expect(value(await alex.query(api.councilRoom.state, { roomId: room._id })).run?.status).toBe("completed");
    expect((await alex.mutation(api.proposals.selectGift, { roomId: room._id, listingId: keep._id })).ok).toBe(true);
  });
  it("refuses invented sources and stale knowledge, even from a trusted callback", async () => {
    const { t, alex, room, args } = await setup();
    const run = value(await alex.mutation(api.councilRoom.start, args));
    await t.mutation(internal.research.research.claimJob, { jobId: run.jobId });
    await t.mutation(internal.research.research.completeJob, { jobId: run.jobId, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
    const body = JSON.stringify({ runId: run.runId, kept: [{ sourceUrl: "https://invented.invalid/gift", notes: [] }], excluded: [], cached: false });
    expect(await t.mutation(internal.councilRoom.storeResults, { body })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    await alex.mutation(api.clues.upsertManualPreference, { roomId: room._id, kind: "ownership", text: "already owns a mug" });
    expect(await t.mutation(internal.councilRoom.storeResults, { body })).toMatchObject({ ok: false, error: { code: "stale_job" } });
  });
  it("does not expose room charms through demo keys and removes withdrawn clues from decorations", async () => {
    const { t, alex, room, clue, args } = await setup();
    const run = value(await alex.mutation(api.councilRoom.start, args));
    const event = { eventId: "ev_roomcharm001", runId: run.runId, actor: "muse" as const, task: "design_decoration", status: "completed" as const, sequence: 1, timestamp: Date.now(), result: { decorations: [{ memoryId: `mem_${clue._id}`, jar: "interest", assetId: "ceramic_charm", color: "terracotta", placement: "front_ribbon", label: "Pottery" }] } };
    await t.mutation(internal.council.ingestEvent, event);
    await t.mutation(internal.council.ingestEvent, { ...event, eventId: "ev_roomcharm002", sequence: 2 });
    expect(value(await alex.query(api.councilRoom.state, { roomId: room._id })).decorations).toHaveLength(1);
    expect((await t.query(api.council.demoState, { demoKey: room._id }))?.decorations).toHaveLength(0);
    await alex.mutation(api.clues.withdrawClue, { publishedClueId: clue._id });
    expect(value(await alex.query(api.councilRoom.state, { roomId: room._id })).decorations).toHaveLength(0);
  });
  it("keeps uncertain work on the same job rather than charging for a retry", async () => {
    const { t, alex, args, room } = await setup();
    const run = value(await alex.mutation(api.councilRoom.start, args));
    await t.mutation(internal.councilRoom.expire, { runId: run.runId });
    expect(value(await alex.mutation(api.councilRoom.start, { ...args, idempotencyKey: "try-again" }))).toEqual(run);
    expect(await alex.mutation(api.councilRoom.resume, { roomId: room._id, runId: run.runId })).toEqual({ ok: true, value: null });
    expect(await t.run(ctx => ctx.db.query("researchJobs").collect())).toHaveLength(1);
  });
});
