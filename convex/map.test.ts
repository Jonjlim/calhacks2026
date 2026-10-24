import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { modules } from "./test.setup";
import type { Id } from "./_generated/dataModel";

function value<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday", currency: "USD",
      knowledgeRevision: 1, inviteToken: "t", createdBy: "alice", createdAt: 0,
    });
    const alice = await ctx.db.insert("participants", { roomId, userId: "alice", displayName: "Alice", role: "organizer", joinedAt: 0 });
    const bob = await ctx.db.insert("participants", { roomId, userId: "bob", displayName: "Bob", role: "contributor", joinedAt: 1 });
    const seed = await ctx.db.insert("publishedClues", {
      roomId, publisherId: alice, kind: "interest", text: "Maya loves hiking.", sourceKind: "manual",
      sourceMessageIds: [], status: "active", publishedAt: 0,
    });
    return { roomId, alice, bob, seed };
  });
  return { t, ids, alice: t.withIdentity({ subject: "alice" }), bob: t.withIdentity({ subject: "bob" }), mallory: t.withIdentity({ subject: "mallory" }) };
}

describe("live cursors", () => {
  it("shows other members' cursors with names and freshness, never your own", async () => {
    const { ids, alice, bob, mallory } = await setup();
    value(await bob.mutation(api.map.moveCursor, { roomId: ids.roomId, x: 10, y: -20 }));
    value(await alice.mutation(api.map.moveCursor, { roomId: ids.roomId, x: 1, y: 1 }));
    expect(value(await alice.query(api.map.listCursors, { roomId: ids.roomId }))).toMatchObject([
      { participantId: ids.bob, displayName: "Bob", x: 10, y: -20 },
    ]);
    // Moving again updates in place.
    value(await bob.mutation(api.map.moveCursor, { roomId: ids.roomId, x: 50, y: 60 }));
    expect(value(await alice.query(api.map.listCursors, { roomId: ids.roomId }))[0]).toMatchObject({ x: 50, y: 60 });
    expect(await mallory.mutation(api.map.moveCursor, { roomId: ids.roomId, x: 0, y: 0 })).toMatchObject({ ok: false });
    expect(await bob.mutation(api.map.moveCursor, { roomId: ids.roomId, x: Number.NaN, y: 0 })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });
});

describe("shared layout and sprouts", () => {
  it("shares node positions and rejects unknown node keys", async () => {
    const { ids, alice, bob } = await setup();
    value(await bob.mutation(api.map.moveNode, { roomId: ids.roomId, nodeKey: `seed:${ids.seed}`, x: 120, y: 40 }));
    expect(value(await alice.query(api.map.getMapState, { roomId: ids.roomId })).positions).toEqual([{ nodeKey: `seed:${ids.seed}`, x: 120, y: 40 }]);
    expect(await bob.mutation(api.map.moveNode, { roomId: ids.roomId, nodeKey: "<script>", x: 0, y: 0 })).toMatchObject({ ok: false });
  });

  it("caps sprouts per seed, and planting one publishes it as a memory in one step", async () => {
    const { t, ids, alice, bob } = await setup();
    const sprouts = Array.from({ length: 15 }, (_, i) => ({ label: `Idea ${i}`, emoji: "🥾", clue: `Maya loves idea ${i}.` }));
    const store = (batch: typeof sprouts) => t.mutation(internal.map.storeSprouts, { roomId: ids.roomId, seedClueId: ids.seed, grownBy: ids.alice, source: "agent", sprouts: batch });
    expect(await store(sprouts)).toBe(6);
    expect(await store(sprouts.slice(6))).toBe(6);
    expect(await store(sprouts.slice(12))).toBe(0);
    const state = value(await bob.query(api.map.getMapState, { roomId: ids.roomId }));
    expect(state.sprouts).toHaveLength(12);
    const before = (await t.run((ctx) => ctx.db.get(ids.roomId)))!.knowledgeRevision;
    const planted = value(await bob.mutation(api.map.plantSprout, { sproutId: state.sprouts[0]!._id }));
    expect(planted).toMatchObject({ kind: "interest", text: "Maya loves idea 0.", publisherId: ids.bob, status: "active" });
    expect(value(await alice.query(api.map.getMapState, { roomId: ids.roomId })).sprouts).toHaveLength(11);
    expect((await t.run((ctx) => ctx.db.get(ids.roomId)))!.knowledgeRevision).toBe(before + 1);
    expect(await bob.mutation(api.map.plantSprout, { sproutId: state.sprouts[0]!._id })).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

async function listing(t: Awaited<ReturnType<typeof setup>>["t"], roomId: Id<"rooms">) {
  return t.run(async ctx => {
    const jobId = await ctx.db.insert("researchJobs", { roomId, knowledgeRevision: 1, publishedClueIds: [], status: "succeeded", attempt: 1, inputHash: "map-fixture", idempotencyKey: "map-fixture", createdAt: 0 });
    return ctx.db.insert("productListings", { roomId, jobId, title: "Trail hiking kit", source: "manual_fixture", sourceUrl: "https://example.com/map-test", priceMinor: 3400, priceStatus: "observed", currency: "USD", shippingStatus: "unknown", availability: "in_stock", retrievedAt: 0, status: "active" });
  });
}

describe("memory tree reactions and editing", () => {
  it("makes ownership idempotent and attributable; only its author can undo its backing clue", async () => {
    const { t, ids, alice, bob, mallory } = await setup();
    const listingId = await listing(t, ids.roomId);
    const args = { roomId: ids.roomId, listingId, kind: "owned" as const };
    expect(await mallory.mutation(api.map.setFeedback, args)).toMatchObject({ ok: false });
    const first = value(await bob.mutation(api.map.setFeedback, args));
    expect(value(await bob.mutation(api.map.setFeedback, args))).toEqual(first);
    const state = value(await alice.query(api.map.getMapState, { roomId: ids.roomId }));
    expect(state.feedback).toMatchObject([{ id: first.feedbackId, participantId: ids.bob, kind: "owned", listing: { _id: listingId } }]);
    const owned = await t.run(ctx => ctx.db.query("publishedClues").withIndex("by_room", q => q.eq("roomId", ids.roomId)).collect());
    expect(owned.filter(c => c.kind === "ownership")).toHaveLength(1);
    expect((await t.run(ctx => ctx.db.get(ids.roomId)))?.knowledgeRevision).toBe(2);
    expect(await alice.mutation(api.map.undoFeedback, first)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await bob.mutation(api.map.undoFeedback, first)).toMatchObject({ ok: true });
    expect(value(await alice.query(api.map.getMapState, { roomId: ids.roomId })).feedback).toEqual([]);
    expect((await t.run(ctx => ctx.db.get(ids.seed)))?.status).toBe("active");
    expect((await t.run(ctx => ctx.db.get(owned.find(c => c.kind === "ownership")!._id)))?.status).toBe("withdrawn");
    const revision = (await t.run(ctx => ctx.db.get(ids.roomId)))?.knowledgeRevision;
    await bob.mutation(api.map.undoFeedback, first);
    expect((await t.run(ctx => ctx.db.get(ids.roomId)))?.knowledgeRevision).toBe(revision);
  });

  it("price reactions do not publish clues, change room knowledge or private caps", async () => {
    const { t, ids, alice, bob } = await setup();
    const listingId = await listing(t, ids.roomId);
    await t.run(ctx => ctx.db.insert("contributionLimits", { roomId: ids.roomId, participantId: ids.bob, amountMinor: 2500, updatedAt: 1 }));
    const before = await t.run(ctx => ctx.db.get(ids.roomId));
    const result = value(await bob.mutation(api.map.setFeedback, { roomId: ids.roomId, listingId, kind: "price" }));
    expect(await t.run(ctx => ctx.db.get(ids.roomId))).toEqual(before);
    expect(await t.run(ctx => ctx.db.query("publishedClues").collect())).toHaveLength(1);
    expect((await t.run(ctx => ctx.db.query("contributionLimits").first()))?.amountMinor).toBe(2500);
    expect(value(await alice.query(api.map.getMapState, { roomId: ids.roomId })).feedback[0]?.participantId).toBe(ids.bob);
    expect(await bob.mutation(api.map.undoFeedback, result)).toMatchObject({ ok: true });
  });

  it("rejects cross-room listing reactions", async () => {
    const { t, ids, alice } = await setup();
    const other = value(await alice.mutation(api.rooms.createRoom, { title: "Other", recipientDisplayName: "Other", occasion: "Birthday" })).room;
    const listingId = await listing(t, other._id);
    expect(await alice.mutation(api.map.setFeedback, { roomId: ids.roomId, listingId, kind: "owned" })).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("only edits the publisher's active manual clue, fences old model work, and clears stale suggestions", async () => {
    const { t, ids, alice, bob } = await setup();
    const payload = { clueId: ids.seed, expectedText: "Maya loves hiking.", text: "Maya loves camping." };
    expect(await bob.mutation(api.map.editMemory, payload)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    await t.mutation(internal.map.storeSprouts, { roomId: ids.roomId, seedClueId: ids.seed, grownBy: ids.alice, source: "preset", sprouts: [{ label: "Day hike", emoji: "🥾", clue: "Maya enjoys day hikes." }] });
    expect(await alice.mutation(api.map.editMemory, payload)).toMatchObject({ ok: true });
    expect(value(await alice.query(api.map.getMapState, { roomId: ids.roomId })).sprouts).toEqual([]);
    expect(await alice.mutation(api.map.editMemory, { ...payload, text: "Lost update" })).toMatchObject({ ok: false, error: { code: "stale_job" } });
    expect(await t.mutation(internal.map.storeSprouts, { roomId: ids.roomId, seedClueId: ids.seed, grownBy: ids.alice, source: "agent", expectedText: payload.expectedText, sprouts: [{ label: "Old idea", emoji: "🥾", clue: "Maya enjoys hiking." }] })).toBe(0);
    await t.run(ctx => ctx.db.patch(ids.seed, { sourceKind: "paste" }));
    expect(await alice.mutation(api.map.editMemory, { clueId: ids.seed, expectedText: payload.text, text: "Edited private-source clue" })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("rejects planting a suggestion whose original memory was withdrawn", async () => {
    const { t, ids, alice, bob } = await setup();
    const args = { roomId: ids.roomId, seedClueId: ids.seed, grownBy: ids.alice, source: "agent" as const, sprouts: [{ label: "Day hike", emoji: "🥾", clue: "Maya enjoys day hikes." }] };
    expect(await t.mutation(internal.map.storeSprouts, args)).toBe(1);
    expect(await t.mutation(internal.map.storeSprouts, args)).toBe(0);
    const sprout = value(await alice.query(api.map.getMapState, { roomId: ids.roomId })).sprouts[0]!;
    await alice.mutation(api.clues.withdrawClue, { publishedClueId: ids.seed });
    expect(await bob.mutation(api.map.plantSprout, { sproutId: sprout._id })).toMatchObject({ ok: false, error: { code: "stale_job" } });
    expect(await t.mutation(internal.map.storeSprouts, args)).toBe(0);
    expect(value(await bob.query(api.map.getMapState, { roomId: ids.roomId })).sprouts).toEqual([]);
  });
});
