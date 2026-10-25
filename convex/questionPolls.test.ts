// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../lib/contracts";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

function value<T>(r: Result<T>): T { if (!r.ok) throw new Error(r.error.message); return r.value; }
async function setup() {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "alex|poll" });
  const sam = t.withIdentity({ subject: "sam|poll" });
  const outsider = t.withIdentity({ subject: "outsider|poll" });
  const created = value(await alex.mutation(api.rooms.createRoom, { title: "Group vote", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alex" }));
  const roomId = created.room._id;
  value(await sam.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Sam" }));
  const ids = await t.run(async ctx => {
    const clueId = await ctx.db.insert("publishedClues", { roomId, publisherId: created.participant._id, kind: "interest", text: "Hiking", sourceKind: "manual", sourceMessageIds: [], status: "active", publishedAt: Date.now() });
    const jobId = await ctx.db.insert("researchJobs", { roomId, knowledgeRevision: 0, publishedClueIds: [clueId], status: "succeeded", inputHash: "poll-fixture", idempotencyKey: "poll-fixture", attempt: 1, createdAt: Date.now(), brief: { knowledgeRevision: 0, queryTerms: ["hiking"], mustExclude: [], listingLimit: 2 } });
    const listings = [];
    for (const title of ["Hiking boots", "Hiking tent", "Ceramic coffee cup"]) listings.push(await ctx.db.insert("productListings", { roomId, jobId, source: "manual_fixture", sourceUrl: `https://example.com/${title.replaceAll(" ", "-")}`, title, currency: "USD", priceMinor: 2000, priceStatus: "observed", shippingStatus: "unknown", availability: "unknown", retrievedAt: Date.now(), status: "active" }));
    const questionId = await ctx.db.insert("mapSharpens", { roomId, askedBy: created.participant._id, knowledgeRevision: 0, createdAt: Date.now(), source: "preset", status: "open", question: "Which gift fits her?", finalistIds: [listings[0]!, listings[2]!], options: [
      { label: "Trail gear", clue: "", listingIds: [listings[0]!] },
      { label: "A quiet coffee ritual", clue: "Maya likes quiet coffee rituals", listingIds: [listings[2]!] },
    ] });
    return { questionId, listings };
  });
  return { t, alex, sam, outsider, roomId, ...ids };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("group questions steer gifts without publishing facts", () => {
  it("lets everyone vote, change and withdraw without first-answer closing or duplicate counts", async () => {
    const s = await setup(); const args = { questionId: s.questionId, option: 1 };
    await s.alex.mutation(api.questionPolls.vote, args);
    await s.alex.mutation(api.questionPolls.vote, args);
    expect(await s.sam.mutation(api.agents.themes.answerSharpen, { sharpenId: s.questionId, option: 1 })).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    expect(value(await s.sam.query(api.questionPolls.state, { roomId: s.roomId }))).toMatchObject({ counts: [0, 1], myOption: null, votedCount: 1, open: true });
    await s.sam.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 0 });
    expect(value(await s.alex.query(api.questionPolls.state, { roomId: s.roomId }))).toMatchObject({ counts: [1, 1], tied: true, leader: null });
    await s.sam.mutation(api.questionPolls.vote, args);
    expect(value(await s.sam.query(api.questionPolls.state, { roomId: s.roomId }))).toMatchObject({ counts: [0, 2], myOption: 1, memberCount: 2, leader: 1 });
    await s.alex.mutation(api.questionPolls.vote, { questionId: s.questionId, option: null });
    expect(value(await s.alex.query(api.questionPolls.state, { roomId: s.roomId }))).toMatchObject({ counts: [0, 1], myOption: null, votedCount: 1 });
    expect((await s.t.run(ctx => ctx.db.get(s.questionId)))?.status).toBe("open");
    expect((await s.t.run(ctx => ctx.db.query("publishedClues").collect()))).toHaveLength(1);
    expect((await s.t.run(ctx => ctx.db.get(s.roomId)))?.knowledgeRevision).toBe(0);
    expect(await s.t.run(ctx => ctx.db.query("votes").collect())).toEqual([]);
  });
  it("allows simultaneous votes without losing either member's ballot", async () => {
    const s = await setup();
    await Promise.all([s.alex.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 1 }), s.sam.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 1 })]);
    expect(value(await s.alex.query(api.questionPolls.state, { roomId: s.roomId }))).toMatchObject({ votedCount: 2, counts: [0, 2] });
  });
  it("moves a previously truncated product into the shortlist from a question vote", async () => {
    const s = await setup();
    const before = value(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId }));
    expect(before.recommendations.map(r => r.listingId)).not.toContain(s.listings[2]);
    await s.sam.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 1 });
    const after = value(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId }));
    expect(after.recommendations[0]?.listingId).toBe(s.listings[2]);
    expect(after.recommendations[0]?.publishedClueIds).toEqual([]);
    expect(after.recommendations).toHaveLength(2);
    await s.sam.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 0 });
    expect(value(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId })).recommendations[0]?.listingId).toBe(s.listings[0]);
  });
  it("applies explicit gift votes before trimming and never restores excluded products", async () => {
    const s = await setup();
    await s.sam.mutation(api.votes.castVote, { roomId: s.roomId, listingId: s.listings[2]!, value: "up" });
    expect(value(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId })).recommendations[0]?.listingId).toBe(s.listings[2]);
    await s.alex.mutation(api.clues.upsertManualPreference, { roomId: s.roomId, kind: "exclusion", text: "No coffee cup" });
    expect(value(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId })).recommendations.map(r => r.listingId)).not.toContain(s.listings[2]);
  });
  it("requires an organizer and a unique leader to finish, keeping opinion separate from facts", async () => {
    const s = await setup();
    await s.alex.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 0 });
    await s.sam.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 1 });
    expect(await s.alex.mutation(api.questionPolls.finish, { questionId: s.questionId })).toMatchObject({ ok: false, error: { code: "infeasible" } });
    await s.alex.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 1 });
    expect(await s.sam.mutation(api.questionPolls.finish, { questionId: s.questionId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    value(await s.alex.mutation(api.questionPolls.finish, { questionId: s.questionId }));
    expect((await s.t.run(ctx => ctx.db.get(s.questionId)))?.status).toBe("answered");
    expect(await s.sam.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 0 })).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    expect((await s.t.run(ctx => ctx.db.query("publishedClues").collect()))).toHaveLength(1);
    // The saved group choice keeps steering after the poll closes.
    expect(value(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId })).recommendations[0]?.listingId).toBe(s.listings[2]);
  });
  it("denies outsiders and malformed answers and makes stale polls explicit", async () => {
    const s = await setup();
    for (const client of [s.outsider, s.t]) expect(await client.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 0 })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    for (const option of [-1, 0.5, 99]) expect(await s.alex.mutation(api.questionPolls.vote, { questionId: s.questionId, option })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    await s.alex.mutation(api.clues.upsertManualPreference, { roomId: s.roomId, kind: "interest", text: "Gardening" });
    expect(value(await s.alex.query(api.questionPolls.state, { roomId: s.roomId }))?.stale).toBe(true);
    expect(await s.alex.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 0 })).toMatchObject({ ok: false, error: { code: "stale_job" } });
  });
  it("purges ballots with their question when the room is deleted", async () => {
    const s = await setup();
    await s.alex.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 0 });
    value(await s.alex.mutation(api.rooms.deleteRoom, { roomId: s.roomId, confirmTitle: "Group vote" }));
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.t.run(ctx => ctx.db.query("mapSharpens").collect())).toEqual([]);
    expect(await s.alex.mutation(api.questionPolls.vote, { questionId: s.questionId, option: 0 })).toMatchObject({ ok: false });
  });
});
