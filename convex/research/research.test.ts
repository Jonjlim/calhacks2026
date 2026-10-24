// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import fixture from "./fixtures/johnvc-shopping.json";
import catalogFixture from "../../lib/research/fixtures/trend-shopping.json";

const modules = Object.fromEntries(Object.entries(
  import.meta.glob(["../**/*.{ts,js}", "!../**/*.test.ts", "!../**/*.d.ts"]),
).map(([path, load]) => [path.startsWith("./") ? "../research/" + path.slice(2) : path, load]));
const research = internal.research.research;
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code + ": " + result.error.message);
  return result.value;
}
async function setup() {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "user_alex|session1" });
  const eve = t.withIdentity({ subject: "user_eve|session2" });
  const created = unwrap(await alex.mutation(api.rooms.createRoom, {
    title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday", budgetMinor: 8000,
  }));
  const roomId = created.room._id;
  const clue = unwrap(await alex.mutation(api.clues.upsertManualPreference, {
    roomId, kind: "interest", text: "interested in pottery",
  }));
  const input = { roomId, publishedClueIds: [clue._id], idempotencyKey: "request1" };
  return { t, alex, eve, roomId, clue, input };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("research pipeline", () => {
  it("denies outsiders and rejects cross-room clue IDs", async () => {
    const { t, alex, eve, input } = await setup();
    expect(await eve.mutation(api.research.research.startResearch, input)).toMatchObject({
      ok: false, error: { code: "unauthorized" },
    });
    expect(await eve.query(api.research.research.listRecommendations, { roomId: input.roomId }))
      .toMatchObject({ ok: false, error: { code: "unauthorized" } });
    const second = unwrap(await alex.mutation(api.rooms.createRoom, {
      title: "Other", recipientDisplayName: "Other", occasion: "Birthday",
    }));
    expect(await alex.mutation(api.research.research.startResearch, { ...input, roomId: second.room._id }))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await t.run(ctx => ctx.db.query("researchJobs").collect())).toHaveLength(0);
  });

  it("deduplicates key retries and matching open inputs without a second provider job", async () => {
    const { t, alex, input } = await setup();
    const first = unwrap(await alex.mutation(api.research.research.startResearch, input));
    const retry = unwrap(await alex.mutation(api.research.research.startResearch, input));
    const duplicate = unwrap(await alex.mutation(api.research.research.startResearch, {
      ...input, idempotencyKey: "request2",
    }));
    expect(retry.jobId).toBe(first.jobId);
    expect(duplicate.jobId).toBe(first.jobId);
    expect(await t.run(ctx => ctx.db.query("researchJobs").collect())).toHaveLength(1);
    expect(await alex.mutation(api.research.research.startResearch, { ...input, budgetMinor: 9000 }))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const job = await t.run(ctx => ctx.db.get(first.jobId));
    expect(job?.status).toBe("pending");
    expect(job?.brief).not.toHaveProperty("roomId"); // explicit adapter to Dev 2's storage shape
  });

  it("rejects bad budgets, no positive clues, and withdrawn clues before a provider call", async () => {
    const { alex, clue, input } = await setup();
    expect(await alex.mutation(api.research.research.startResearch, { ...input, budgetMinor: 1.5 }))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await alex.mutation(api.research.research.startResearch, { ...input, publishedClueIds: [] }))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    await alex.mutation(api.clues.withdrawClue, { publishedClueId: clue._id });
    expect(await alex.mutation(api.research.research.startResearch, input))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("claims once and stores valid real-response listings once", async () => {
    const { t, alex, input } = await setup();
    const { jobId } = unwrap(await alex.mutation(api.research.research.startResearch, input));
    expect(await t.mutation(research.claimJob, { jobId })).not.toBeNull();
    expect(await t.mutation(research.claimJob, { jobId })).toBeNull();
    await t.mutation(research.completeJob, { jobId, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
    await t.mutation(research.completeJob, { jobId, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
    expect(await t.run(ctx => ctx.db.query("productListings").collect())).toHaveLength(4);
    expect((await t.run(ctx => ctx.db.get(jobId)))?.status).toBe("succeeded");
    const results = unwrap(await alex.query(api.research.research.listRecommendations, { roomId: input.roomId }));
    expect(results.listings).toHaveLength(4);
    expect(results.recommendations[0]?.publishedClueIds).toContain(input.publishedClueIds[0]);
    expect(results.recommendations.every(rec => results.listings.some(listing => listing.id === rec.listingId))).toBe(true);
  });

  it("re-ranks cached candidates immediately when ownership is published, without another search", async () => {
    const { t, alex, input } = await setup();
    const { jobId } = unwrap(await alex.mutation(api.research.research.startResearch, input));
    await t.mutation(research.claimJob, { jobId });
    const raw = structuredClone(fixture.pages);
    raw[0]!.shopping_results[0]!.title = "Complete Pottery Starter Kit";
    await t.mutation(research.completeJob, { jobId, raw, retrievedAt: fixture.retrievedAt });
    const before = unwrap(await alex.query(api.research.research.listRecommendations, { roomId: input.roomId }));
    expect(before.listings.some(listing => listing.title === "Complete Pottery Starter Kit")).toBe(true);
    await alex.mutation(api.clues.upsertManualPreference, {
      roomId: input.roomId, kind: "ownership", text: "already owns a starter kit",
    });
    const after = unwrap(await alex.query(api.research.research.listRecommendations, { roomId: input.roomId }));
    expect(after.listings.some(listing => listing.title === "Complete Pottery Starter Kit")).toBe(false);
    expect(after.listings.some(listing => listing.title === "Amaco Pottery Tool Kit")).toBe(true);
    expect(after.listings.some(listing => listing.title === "Mudtools Do All Trim Tool")).toBe(true);
    expect(await t.run(ctx => ctx.db.query("researchJobs").collect())).toHaveLength(1);
  });

  it("serves reviewed model matches and removes explicitly excluded categories without another provider call", async () => {
    const { t, alex, input } = await setup();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const { jobId } = unwrap(await alex.mutation(api.research.research.startResearch, input));
    await t.mutation(research.claimJob, { jobId });
    await t.mutation(research.completeJob, { jobId, raw: catalogFixture.data, retrievedAt: catalogFixture.provenance.retrievedAt });
    const before = unwrap(await alex.query(api.research.research.listRecommendations, { roomId: input.roomId }));
    const roller = before.listings.find(listing => listing.title.startsWith("BHR-051"))!;
    const recommendation = before.recommendations.find(row => row.listingId === roller.id)!;
    expect(recommendation.publishedClueIds).toEqual(input.publishedClueIds);
    expect(recommendation.personalRelevance).toBe(0.7);
    expect(recommendation.explanation).toContain("https://mkmpotterytools.com/product/bhr-051");
    await alex.mutation(api.clues.upsertManualPreference, {
      roomId: input.roomId, kind: "exclusion", text: "No more pottery",
    });
    const after = unwrap(await alex.query(api.research.research.listRecommendations, { roomId: input.roomId }));
    expect(after.listings.some(listing => listing.id === roller.id)).toBe(false);
    expect(after.listings.some(listing => listing.title.startsWith("DD-10"))).toBe(false);
    expect(await t.run(ctx => ctx.db.query("researchJobs").collect())).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects old knowledge and older requests finishing late", async () => {
    const { t, alex, input } = await setup();
    const old = unwrap(await alex.mutation(api.research.research.startResearch, input));
    await t.mutation(research.claimJob, old);
    vi.setSystemTime(Date.now() + 1);
    const newer = unwrap(await alex.mutation(api.research.research.startResearch, {
      ...input, budgetMinor: 10000, idempotencyKey: "newer",
    }));
    await t.mutation(research.claimJob, newer);
    await t.mutation(research.completeJob, { ...newer, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
    await t.mutation(research.completeJob, { ...old, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
    expect((await t.run(ctx => ctx.db.get(old.jobId)))?.status).toBe("stale");
    const listings = await t.run(ctx => ctx.db.query("productListings").collect());
    expect(listings.every(listing => listing.jobId === newer.jobId)).toBe(true);
    vi.setSystemTime(Date.now() + 1);
    const stale = unwrap(await alex.mutation(api.research.research.startResearch, {
      ...input, budgetMinor: 11000, idempotencyKey: "stale",
    }));
    await t.mutation(research.claimJob, stale);
    await alex.mutation(api.clues.upsertManualPreference, {
      roomId: input.roomId, kind: "exclusion", text: "no pink",
    });
    await t.mutation(research.completeJob, { ...stale, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
    expect((await t.run(ctx => ctx.db.get(stale.jobId)))?.status).toBe("stale");
    expect(await t.run(ctx => ctx.db.query("productListings").collect())).toHaveLength(4);
  });

  it("marks timeouts uncertain and prevents an automatic second paid start", async () => {
    const { t, alex, input } = await setup();
    const { jobId } = unwrap(await alex.mutation(api.research.research.startResearch, input));
    vi.stubEnv("APIFY_TOKEN", "fake-token");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private provider error"));
    vi.stubGlobal("fetch", fetcher);
    await t.action(research.runResearch, { jobId });
    expect((await t.run(ctx => ctx.db.get(jobId)))?.status).toBe("uncertain");
    await t.action(research.runResearch, { jobId });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const status = unwrap(await alex.query(api.jobs.listRoomJobs, { roomId: input.roomId }));
    expect(status.researchJobs[0]?.status).toBe("uncertain");
    expect(JSON.stringify(status)).not.toContain("fake-token");
    expect(JSON.stringify(status)).not.toContain("private provider error");
  });

  it("polls successful runs and stores their dataset", async () => {
    const { t, alex, input } = await setup();
    const { jobId } = unwrap(await alex.mutation(api.research.research.startResearch, input));
    await t.mutation(research.claimJob, { jobId });
    vi.stubEnv("APIFY_TOKEN", "fake-token");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { id: "run123", status: "SUCCEEDED", defaultDatasetId: "dataset123" },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture.pages))));
    await t.action(research.pollResearch, { jobId, runId: "run123", startedAt: Date.now() });
    expect((await t.run(ctx => ctx.db.get(jobId)))?.status).toBe("succeeded");
    expect(await t.run(ctx => ctx.db.query("productListings").collect())).toHaveLength(4);
  });

  it("shows empty results as a failed search and expires a lost worker", async () => {
    const { t, alex, input } = await setup();
    const { jobId } = unwrap(await alex.mutation(api.research.research.startResearch, input));
    await t.mutation(research.claimJob, { jobId });
    await t.mutation(research.completeJob, { jobId, raw: [], retrievedAt: fixture.retrievedAt });
    expect((await t.run(ctx => ctx.db.get(jobId)))?.status).toBe("failed");
    expect(unwrap(await alex.query(api.research.research.listRecommendations, { roomId: input.roomId })).listings).toEqual([]);
    vi.setSystemTime(Date.now() + 1);
    const next = unwrap(await alex.mutation(api.research.research.startResearch, {
      ...input, idempotencyKey: "next",
    }));
    await t.mutation(research.claimJob, next);
    await t.mutation(research.expireJob, next);
    expect((await t.run(ctx => ctx.db.get(next.jobId)))?.status).toBe("uncertain");
  });
  it("keeps the last successful catalog when a replacement search fails, without restarting it", async () => {
    const { t, alex, input } = await setup();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const first = unwrap(await alex.mutation(api.research.research.startResearch, input));
    await t.mutation(research.claimJob, first);
    await t.mutation(research.completeJob, { ...first, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
    const before = unwrap(await alex.query(api.research.research.listRecommendations, { roomId: input.roomId }));
    vi.setSystemTime(Date.now() + 1);
    const replacementInput = { ...input, idempotencyKey: "replacement" };
    const replacement = unwrap(await alex.mutation(api.research.research.startResearch, replacementInput));
    await t.mutation(research.claimJob, replacement);
    await t.mutation(research.completeJob, { ...replacement, raw: [], retrievedAt: fixture.retrievedAt });
    const after = unwrap(await alex.query(api.research.research.listRecommendations, { roomId: input.roomId }));
    expect(after).toEqual(before);
    const jobs = unwrap(await alex.query(api.jobs.listRoomJobs, { roomId: input.roomId }));
    expect(jobs.researchJobs.find(job => job._id === replacement.jobId)?.status).toBe("failed");
    expect(unwrap(await alex.mutation(api.research.research.startResearch, replacementInput))).toEqual(replacement);
    await t.action(research.runResearch, replacement);
    expect(await t.run(ctx => ctx.db.query("researchJobs").collect())).toHaveLength(2);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fences an obsolete scheduled poll before it can contact the provider", async () => {
    const { t, alex, input } = await setup();
    const old = unwrap(await alex.mutation(api.research.research.startResearch, input));
    await t.mutation(research.claimJob, old);
    vi.setSystemTime(Date.now() + 1);
    await alex.mutation(api.research.research.startResearch, {
      ...input, budgetMinor: 9000, idempotencyKey: "replacement",
    });
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    await t.action(research.pollResearch, { ...old, runId: "old-run", startedAt: Date.now() });
    expect((await t.run(ctx => ctx.db.get(old.jobId)))?.status).toBe("stale");
    expect(await t.run(ctx => ctx.db.query("productListings").collect())).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("runs the scheduled start and poll path without a second paid POST", async () => {
    const { t, alex, input } = await setup();
    vi.stubEnv("APIFY_TOKEN", "fake-token");
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "run123", status: "RUNNING" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { id: "run123", status: "SUCCEEDED", defaultDatasetId: "dataset123" },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture.pages)));
    vi.stubGlobal("fetch", fetcher);
    const { jobId } = unwrap(await alex.mutation(api.research.research.startResearch, input));
    await vi.advanceTimersByTimeAsync(1_000);
    await t.finishInProgressScheduledFunctions();
    expect((await t.run(ctx => ctx.db.get(jobId)))?.status).toBe("running");
    await vi.advanceTimersByTimeAsync(4_000);
    await t.finishInProgressScheduledFunctions();
    expect((await t.run(ctx => ctx.db.get(jobId)))?.status).toBe("succeeded");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

});
