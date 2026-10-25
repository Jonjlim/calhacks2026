import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { storySentence } from "../lib/story/sentence";
import { topWords } from "../lib/story/words";
import schema from "./schema";
import { api } from "./_generated/api";
import { modules } from "./test.setup";

type R<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
function value<T>(r: R<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

async function setup({ chosen = true } = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", { title: "Maya", recipientDisplayName: "Maya Chen", occasion: "birthday", currency: "USD", knowledgeRevision: 1, inviteToken: "tok", createdBy: "alice", createdAt: 0 });
    const alice = await ctx.db.insert("participants", { roomId, userId: "alice", displayName: "Alice Park", role: "organizer", joinedAt: 0 });
    const bob = await ctx.db.insert("participants", { roomId, userId: "bob", displayName: "Bob", role: "contributor", joinedAt: 0 });
    const clue = (kind: "interest" | "explicit_wish" | "exclusion" | "ownership", text: string, status: "active" | "withdrawn" = "active") =>
      ctx.db.insert("publishedClues", { roomId, publisherId: bob, kind, text, sourceKind: "manual", sourceMessageIds: [], status, publishedAt: 0 });
    await clue("interest", "Loves matcha and hiking on weekends");
    await clue("explicit_wish", "Wants a good matcha whisk");
    await clue("exclusion", "Hates scented candles");
    await clue("ownership", "Already owns a tent");
    await clue("interest", "Gift idea: a Kindle");
    await clue("interest", "Secretly into karaoke", "withdrawn");
    const jobId = await ctx.db.insert("researchJobs", { roomId, knowledgeRevision: 1, publishedClueIds: [], status: "succeeded", inputHash: "h", idempotencyKey: "k", attempt: 1, createdAt: 0 });
    const listingId = await ctx.db.insert("productListings", { roomId, jobId, source: "manual_fixture", sourceUrl: "https://shop.example/whisk", title: "Bamboo matcha whisk", currency: "USD", priceMinor: 2400, priceStatus: "observed", availability: "in_stock", shippingStatus: "unknown", imageUrl: "https://img.example/whisk.jpg", retrievedAt: 0, status: "active" });
    await ctx.db.insert("votes", { roomId, listingId, participantId: bob, value: "up", updatedAt: 0 });
    await ctx.db.insert("roomTrail", { roomId, at: 0, stage: "council", actor: "checks", outcome: "rejected", text: "Threw out a perfume idea." });
    if (chosen) {
      const selectionId = await ctx.db.insert("giftSelections", { roomId, listingId, quantity: 1, status: "active", selectedBy: alice, selectedAt: 0,
        listingSnapshot: { title: "Bamboo matcha whisk", sourceUrl: "https://shop.example/whisk", priceMinor: 2400, priceStatus: "observed", retrievedAt: 0 } });
      await ctx.db.patch(roomId, { currentSelectionId: selectionId });
    }
    return { roomId, alice, bob };
  });
  return { t, ids, alice: t.withIdentity({ subject: "alice" }), bob: t.withIdentity({ subject: "bob" }), outsider: t.withIdentity({ subject: "mallory" }) };
}

describe("gift story", () => {
  it("counts what the room did for members only", async () => {
    const { ids, bob, outsider } = await setup();
    const story = value(await bob.query(api.story.summary, { roomId: ids.roomId }));
    expect(story.stats).toMatchObject({ memories: 5, friends: 2, products: 1, searches: 1, votes: 1, thrownOut: 1 });
    expect(story.friends).toEqual(["Alice", "Bob"]);
    expect(await outsider.query(api.story.summary, { roomId: ids.roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("only the organizer makes or takes back the tag, and only once a gift is chosen", async () => {
    const { ids, alice, bob } = await setup();
    expect(await bob.mutation(api.story.createTag, { roomId: ids.roomId, includePhotos: false })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    const tag = value(await alice.mutation(api.story.createTag, { roomId: ids.roomId, includePhotos: false }));
    expect(tag.token).toMatch(/^[0-9a-f]{32}$/);
    // Making it again keeps the printed QR working.
    expect(value(await alice.mutation(api.story.createTag, { roomId: ids.roomId, includePhotos: true })).token).toBe(tag.token);
    expect(await bob.mutation(api.story.revokeTag, { roomId: ids.roomId })).toMatchObject({ ok: false });

    const empty = await setup({ chosen: false });
    expect(await empty.alice.mutation(api.story.createTag, { roomId: empty.ids.roomId, includePhotos: false })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("shows her only kind, published memories and the gift without a price", async () => {
    const { t, ids, alice } = await setup();
    const { token } = value(await alice.mutation(api.story.createTag, { roomId: ids.roomId, includePhotos: false }));
    const story = value(await t.query(api.story.byToken, { token }));
    expect(story.memories).toEqual(["Loves matcha and hiking on weekends", "Wants a good matcha whisk"]);
    expect(story.gifts).toEqual([{ title: "Bamboo matcha whisk", imageUrl: "https://img.example/whisk.jpg" }]);
    expect(story.recipientName).toBe("Maya");
    const raw = JSON.stringify(story);
    for (const secret of ["candles", "tent", "Kindle", "karaoke", "2400", "shop.example", "Park"]) expect(raw).not.toContain(secret);
  });

  it("stops working when revoked, when the gift is cleared, or for a made-up token", async () => {
    const { t, ids, alice } = await setup();
    const { token } = value(await alice.mutation(api.story.createTag, { roomId: ids.roomId, includePhotos: false }));
    expect(await t.query(api.story.byToken, { token: "nope" })).toMatchObject({ ok: false, error: { code: "not_found" } });
    await t.run(async (ctx) => {
      const room = (await ctx.db.get(ids.roomId))!;
      await ctx.db.patch(room.currentSelectionId!, { status: "cleared" });
    });
    expect(await t.query(api.story.byToken, { token })).toMatchObject({ ok: false });
    value(await alice.mutation(api.story.revokeTag, { roomId: ids.roomId }));
    expect(value(await alice.query(api.story.tag, { roomId: ids.roomId }))).toBeNull();
    expect(await t.query(api.story.byToken, { token })).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("topWords", () => {
  it("counts each word once per memory and skips filler and her name", () => {
    expect(topWords(["Maya loves matcha matcha", "matcha lattes with Maya", "hiking gifts"], { exclude: ["Maya Chen"] }))
      .toEqual([{ word: "matcha", count: 2 }, { word: "hiking", count: 1 }, { word: "lattes", count: 1 }]);
  });
});

describe("storySentence", () => {
  it("reads the numbers back in one line", () => {
    expect(storySentence({ memories: 12, directions: 6, thrownOut: 3, searches: 4, products: 38, votes: 21 }))
      .toBe("The council read 12 memories, proposed 6 directions and threw out 3, searched 4 times across 38 products; your group voted 21 times → this gift.");
    expect(storySentence({ memories: 1, directions: 0, thrownOut: 0, searches: 1, products: 1, votes: 0 }, { gifts: 2 }))
      .toBe("The council read 1 memory and searched 1 time across 1 product → these gifts.");
  });
});
