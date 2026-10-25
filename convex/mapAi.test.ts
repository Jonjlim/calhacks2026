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
    const otherRoom = await ctx.db.insert("rooms", {
      title: "Sam", recipientDisplayName: "Sam", occasion: "Birthday", currency: "USD",
      knowledgeRevision: 1, inviteToken: "u", createdBy: "mallory", createdAt: 0,
    });
    const alice = await ctx.db.insert("participants", { roomId, userId: "alice", displayName: "Alice", role: "organizer", joinedAt: 0 });
    const bob = await ctx.db.insert("participants", { roomId, userId: "bob", displayName: "Bob", role: "contributor", joinedAt: 1 });
    const clue = (text: string, kind: "interest" | "explicit_wish" | "timing" = "interest", roomIdFor = roomId, publisherId = alice) =>
      ctx.db.insert("publishedClues", { roomId: roomIdFor, publisherId, kind, text, sourceKind: "manual", sourceMessageIds: [], status: "active", publishedAt: 0 });
    const pottery = await clue("Maya loves pottery.");
    const coffee = await clue("Maya wants a slow Sunday with coffee.", "explicit_wish");
    const mornings = await clue("Maya is always cold in the mornings.", "timing");
    const malloryParticipant = await ctx.db.insert("participants", { roomId: otherRoom, userId: "mallory", displayName: "Mallory", role: "organizer", joinedAt: 0 });
    const foreign = await clue("Sam likes trains.", "interest", otherRoom, malloryParticipant);
    const jobId = await ctx.db.insert("researchJobs", { roomId, knowledgeRevision: 1, publishedClueIds: [], status: "succeeded", inputHash: "h", idempotencyKey: "k", attempt: 1, createdAt: 0 });
    const listing = (title: string) => ctx.db.insert("productListings", {
      roomId, jobId, source: "manual_fixture", sourceUrl: "https://example.com/x", title, currency: "USD", priceMinor: 4000,
      priceStatus: "observed", availability: "in_stock", shippingStatus: "unknown", retrievedAt: 0, status: "active",
    });
    const kit = await listing("Pottery starter kit");
    const mug = await listing("Handmade mug");
    for (const [listingId, score] of [[kit, 0.8], [mug, 0.7]] as const) {
      await ctx.db.insert("recommendations", { roomId, listingId, publishedClueIds: [pottery], score, personalRelevance: score, budgetFit: 1, trendSignal: 0, explanation: "Fits", createdAt: 0 });
    }
    return { roomId, otherRoom, alice, bob, pottery, coffee, mornings, foreign, kit, mug };
  });
  return { t, ids, alice: t.withIdentity({ subject: "alice" }), bob: t.withIdentity({ subject: "bob" }), mallory: t.withIdentity({ subject: "mallory" }) };
}

describe("direction signals on memories and themes", () => {
  it("keeps one attributed signal per member per target, and lets them take it back", async () => {
    const { ids, alice, bob } = await setup();
    value(await alice.mutation(api.mapSignals.setDirection, { roomId: ids.roomId, targetKind: "clue", targetId: ids.pottery, value: 1 }));
    value(await bob.mutation(api.mapSignals.setDirection, { roomId: ids.roomId, targetKind: "clue", targetId: ids.pottery, value: -1 }));
    value(await bob.mutation(api.mapSignals.setDirection, { roomId: ids.roomId, targetKind: "clue", targetId: ids.pottery, value: 1 }));
    value(await alice.mutation(api.mapSignals.setDirection, { roomId: ids.roomId, targetKind: "theme", targetId: "interest", value: -1 }));
    const rows = value(await bob.query(api.mapSignals.listSignals, { roomId: ids.roomId }));
    expect(rows.find((r) => r.targetKind === "clue")).toMatchObject({ targetId: ids.pottery, up: 2, down: 0 });
    expect(rows.find((r) => r.targetKind === "theme")).toMatchObject({ targetId: "interest", up: 0, down: 1 });
    value(await alice.mutation(api.mapSignals.setDirection, { roomId: ids.roomId, targetKind: "clue", targetId: ids.pottery, value: 0 }));
    expect(value(await bob.query(api.mapSignals.listSignals, { roomId: ids.roomId })).find((r) => r.targetKind === "clue")).toMatchObject({ up: 1 });
  });

  it("only accepts things on this room's map, from members", async () => {
    const { ids, alice, mallory } = await setup();
    expect(await alice.mutation(api.mapSignals.setDirection, { roomId: ids.roomId, targetKind: "clue", targetId: ids.foreign, value: 1 })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await alice.mutation(api.mapSignals.setDirection, { roomId: ids.roomId, targetKind: "theme", targetId: "made-up", value: 1 })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await mallory.mutation(api.mapSignals.setDirection, { roomId: ids.roomId, targetKind: "clue", targetId: ids.pottery, value: 1 })).toMatchObject({ ok: false });
    expect(await mallory.query(api.mapSignals.listSignals, { roomId: ids.roomId })).toMatchObject({ ok: false });
  });
});

describe("council themes", () => {
  it("falls back to the clue groups without a model, and lists them for members", async () => {
    const { ids, bob, mallory } = await setup();
    expect(value(await bob.action(api.agents.themes.suggestThemes, { roomId: ids.roomId }))).toMatchObject({ source: "preset", themes: 3 });
    const themes = value(await bob.query(api.agents.themes.listThemes, { roomId: ids.roomId }));
    expect(themes.map((t) => t.label).sort()).toEqual(["Moments and habits", "Things she loves", "Wishes she has mentioned"]);
    expect(themes.find((t) => t.label === "Things she loves")?.clueIds).toEqual([ids.pottery]);
    expect(await mallory.query(api.agents.themes.listThemes, { roomId: ids.roomId })).toMatchObject({ ok: false });
  });

  it("rejects themes built on older memories and drops clues from other rooms", async () => {
    const { t, ids } = await setup();
    const stale = await t.mutation(internal.agents.themes.storeThemes, { roomId: ids.roomId, knowledgeRevision: 0, source: "agent", themes: [{ label: "Makes things", clueIds: [ids.pottery] }] });
    expect(stale).toEqual({ stored: 0, stale: true });
    const stored = await t.mutation(internal.agents.themes.storeThemes, { roomId: ids.roomId, knowledgeRevision: 1, source: "agent", themes: [
      { label: "Makes things", clueIds: [ids.pottery, ids.foreign, ids.pottery] },
      { label: "Slow mornings", clueIds: [ids.coffee, ids.mornings] },
    ] });
    expect(stored).toMatchObject({ stored: 2, stale: false });
    const rows = await t.run((ctx) => ctx.db.query("mapThemes").collect());
    expect(rows.find((r) => r.label === "Makes things")?.clueIds).toEqual([ids.pottery]);
  });

  it("asks for a few memories before grouping", async () => {
    const { t, ids, bob } = await setup();
    await t.run(async (ctx) => {
      for (const c of await ctx.db.query("publishedClues").collect()) if (c.roomId === ids.roomId && c._id !== ids.pottery) await ctx.db.patch(c._id, { status: "withdrawn" });
    });
    expect(await bob.action(api.agents.themes.suggestThemes, { roomId: ids.roomId })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });
});

describe("sharpen", () => {
  it("asks one question between the two leading gifts; a preset answer is the member's vote, not a memory", async () => {
    const { t, ids, alice, bob } = await setup();
    const { sharpenId, source } = value(await alice.action(api.agents.themes.sharpen, { roomId: ids.roomId }));
    expect(source).toBe("preset");
    const open = value(await bob.query(api.agents.themes.getSharpen, { roomId: ids.roomId }))!;
    expect(open.finalistIds).toEqual([ids.kit, ids.mug]);
    expect(open.options.map((o) => o.listingIds[0])).toEqual([ids.kit, ids.mug]);
    const cluesBefore = (await t.run((ctx) => ctx.db.query("publishedClues").collect())).length;
    const answered = value(await bob.mutation(api.agents.themes.answerSharpen, { sharpenId, option: 1 }));
    expect(answered.clueId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.query("publishedClues").collect())).length).toBe(cluesBefore);
    expect(await t.run((ctx) => ctx.db.query("votes").collect())).toMatchObject([{ listingId: ids.mug, participantId: ids.bob, value: "up" }]);
    expect(await alice.mutation(api.agents.themes.answerSharpen, { sharpenId, option: 0 })).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    const room = await t.run((ctx) => ctx.db.get(ids.roomId));
    expect(room?.knowledgeRevision).toBe(1);
    expect(value(await alice.query(api.agents.themes.getSharpen, { roomId: ids.roomId }))).toMatchObject({ status: "answered", answer: 1 });
  });

  it("a question the model wrote is still published as the answering member's own memory", async () => {
    const { t, ids, bob } = await setup();
    const sharpenId = await t.run((ctx) => ctx.db.insert("mapSharpens", {
      roomId: ids.roomId, question: "Does Maya love making things, or having handmade things around?", source: "agent", askedBy: ids.alice,
      options: [{ label: "Making them", clue: "Maya loves making things herself.", listingIds: [ids.kit] }, { label: "Having them", clue: "Maya loves handmade things around her.", listingIds: [ids.mug] }],
      finalistIds: [ids.kit, ids.mug], status: "open", knowledgeRevision: 1, createdAt: 0,
    }));
    const { clueId } = value(await bob.mutation(api.agents.themes.answerSharpen, { sharpenId, option: 1 }));
    expect(await t.run((ctx) => ctx.db.get(clueId as Id<"publishedClues">))).toMatchObject({ publisherId: ids.bob, kind: "interest", status: "active", text: "Maya loves handmade things around her." });
  });

  it("needs two gifts, and skips gifts someone said she already owns", async () => {
    const { t, ids, alice } = await setup();
    await t.run((ctx) => ctx.db.insert("mapFeedback", { roomId: ids.roomId, participantId: ids.alice, listingId: ids.kit, kind: "owned", active: true, createdAt: 0 }));
    expect(await alice.action(api.agents.themes.sharpen, { roomId: ids.roomId })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });
});

describe("room deletion", () => {
  it("purges map signals, themes and sharpen rounds with the room", async () => {
    const { t, ids, alice } = await setup();
    value(await alice.mutation(api.mapSignals.setDirection, { roomId: ids.roomId, targetKind: "clue", targetId: ids.pottery, value: 1 }));
    value(await alice.action(api.agents.themes.suggestThemes, { roomId: ids.roomId }));
    value(await alice.action(api.agents.themes.sharpen, { roomId: ids.roomId }));
    const { purgeRoomStep } = await import("./lib/roomPurge");
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) if ((await purgeRoomStep(ctx, ids.roomId, 500)).done) break;
    });
    const left = await t.run(async (ctx) => [
      ...(await ctx.db.query("mapSignals").collect()),
      ...(await ctx.db.query("mapThemes").collect()),
      ...(await ctx.db.query("mapSharpens").collect()),
    ].filter((r) => r.roomId === ids.roomId).length);
    expect(left).toBe(0);
  });
});
