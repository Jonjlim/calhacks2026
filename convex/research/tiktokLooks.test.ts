// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code + ": " + result.error.message);
  return result.value;
}
async function setup() {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "user_alex|session1" });
  const roomId = unwrap(await alex.mutation(api.rooms.createRoom, { title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday" })).room._id;
  const clueId = unwrap(await alex.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text: "interested in hiking" }))._id;
  const trendJobId = await t.run(async (ctx) => {
    const room = (await ctx.db.get(roomId))!;
    const me = (await ctx.db.query("participants").first())!;
    const now = Date.now();
    return ctx.db.insert("trendJobs", {
      roomId, knowledgeRevision: room.knowledgeRevision, actingParticipantId: me._id, publishedClueId: clueId, seedTerm: "hiking",
      status: "succeeded", idempotencyKey: "k", createdAt: now,
      sample: {
        mode: "live_sample", label: "Related Google searches", actor: "agenscrape~google-trends-scraper", build: "1", providerRunId: "run1",
        context: { seedTerm: "hiking", geo: "US", timeRange: "today 3-m", retrievedAt: now }, publishedClueId: clueId, screen: "model",
        suggestions: [{ query: "hiking backpack", sourceUrl: "https://trends.google.com/explore?q=hiking%20backpack", signals: [{ kind: "rising_search", growthPercent: 40 }] }],
        evidenceSummary: { returnedRows: 1, observations: 10 },
      },
    });
  });
  return { t, alex, roomId, trendJobId };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("TikTok inspiration for a trend cloud", () => {
  it("only searches a trend idea that is really on this map", async () => {
    const s = await setup();
    const bad = await s.alex.mutation(api.research.tiktokLooks.look, { roomId: s.roomId, trendJobId: s.trendJobId, query: "maya's address" });
    expect(bad.ok).toBe(false);
  });

  it("starts one search per idea and reuses it while it runs", async () => {
    const s = await setup();
    const a = unwrap(await s.alex.mutation(api.research.tiktokLooks.look, { roomId: s.roomId, trendJobId: s.trendJobId, query: "hiking backpack" }));
    const b = unwrap(await s.alex.mutation(api.research.tiktokLooks.look, { roomId: s.roomId, trendJobId: s.trendJobId, query: "hiking backpack" }));
    expect(b.lookId).toBe(a.lookId);
    expect(await s.t.run((ctx) => ctx.db.query("tiktokLooks").collect())).toHaveLength(1);
  });

  it("shows only public post links as embeddable videos, and logs that friends looked", async () => {
    const s = await setup();
    const { lookId } = unwrap(await s.alex.mutation(api.research.tiktokLooks.look, { roomId: s.roomId, trendJobId: s.trendJobId, query: "hiking backpack" }));
    await s.t.mutation(internal.research.tiktokLooks.claim, { lookId });
    await s.t.mutation(internal.research.tiktokLooks.settle, { lookId, status: "succeeded", postUrls: ["https://www.tiktok.com/@trailfriend/video/7312345678901234567"] });
    const [look] = unwrap(await s.alex.query(api.research.tiktokLooks.list, { roomId: s.roomId }));
    expect(look).toMatchObject({ query: "hiking backpack", status: "succeeded", posts: [{ videoId: "7312345678901234567" }] });
    const trail = await s.t.run((ctx) => ctx.db.query("roomTrail").collect());
    expect(trail.at(-1)?.text).toContain("looked at 1 public TikToks for the trend idea “hiking backpack”");
  });
});
