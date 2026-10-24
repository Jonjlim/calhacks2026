import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "./_generated/api";
import { modules } from "./test.setup";
import { anonymize, budgetBandOf } from "./worlds";

afterEach(() => vi.unstubAllEnvs());

function value<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      title: "Priya's party", recipientDisplayName: "Priya", occasion: "Birthday", currency: "USD",
      budgetMinor: 6000, knowledgeRevision: 1, inviteToken: "INVITE-SECRET-77", createdBy: "alice", createdAt: 0,
    });
    const alice = await ctx.db.insert("participants", { roomId, userId: "alice", displayName: "Alice", role: "organizer", joinedAt: 0 });
    await ctx.db.insert("participants", { roomId, userId: "bob", displayName: "Bobby", role: "contributor", joinedAt: 0 });
    const clue = (text: string, status: "active" | "withdrawn" = "active") =>
      ctx.db.insert("publishedClues", {
        roomId, publisherId: alice, kind: "interest", text, sourceKind: "manual", sourceMessageIds: [], status, publishedAt: 0,
      });
    const pottery = await clue("Priya keeps saying she wants to try pottery, Bobby agrees");
    const sensitive = await clue("Priya is on medication for anxiety");
    const old = await clue("Withdrawn thing", "withdrawn");
    const other = await ctx.db.insert("rooms", {
      title: "Other", recipientDisplayName: "Zed", occasion: "x", currency: "USD", knowledgeRevision: 0,
      inviteToken: "t2", createdBy: "carol", createdAt: 0,
    });
    const otherP = await ctx.db.insert("participants", { roomId: other, userId: "carol", displayName: "Carol", role: "organizer", joinedAt: 0 });
    const foreign = await ctx.db.insert("publishedClues", {
      roomId: other, publisherId: otherP, kind: "interest", text: "elsewhere", sourceKind: "manual", sourceMessageIds: [], status: "active", publishedAt: 0,
    });
    return { roomId, pottery, sensitive, old, foreign };
  });
  return { t, ids, alice: t.withIdentity({ subject: "alice" }), bob: t.withIdentity({ subject: "bob" }) };
}

describe("helpers", () => {
  it("bands budgets", () => {
    expect(budgetBandOf(undefined)).toBe("unknown");
    expect(budgetBandOf(2_499)).toBe("under_25");
    expect(budgetBandOf(5_000)).toBe("50_100");
    expect(budgetBandOf(10_000)).toBe("100_plus");
  });
  it("replaces names case-insensitively, including special characters", () => {
    expect(anonymize("PRIYA and bobby, plus A.J.", ["Priya", "Bobby", "A.J."], "Someone")).toBe("Someone and Someone, plus Someone");
    expect(anonymize("x", ["Y"], "z")).toBe("x");
  });
});

describe("sharing a room", () => {
  it("lets only the organizer share, and shows anonymized lines only", async () => {
    const { ids, alice, bob } = await setup();
    expect(await bob.mutation(api.worlds.shareWorld, { roomId: ids.roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    const shared = value(
      await alice.mutation(api.worlds.shareWorld, {
        roomId: ids.roomId, recipientAlias: "A new potter", highlightClueIds: [ids.pottery],
      }),
    );
    expect(shared.highlights).toEqual(["A new potter keeps saying she wants to try pottery, A new potter agrees"]);
  });

  it("rejects sensitive, withdrawn, foreign, and too many clues", async () => {
    const { ids, alice } = await setup();
    const share = (highlightClueIds: typeof ids.pottery[]) => alice.mutation(api.worlds.shareWorld, { roomId: ids.roomId, highlightClueIds });
    expect(await share([ids.sensitive])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await share([ids.old])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await share([ids.foreign])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await share([ids.pottery, ids.sensitive, ids.old, ids.foreign])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("exposes no room, account, invite or real names to other readers", async () => {
    const { ids, alice, bob, t } = await setup();
    value(await alice.mutation(api.worlds.shareWorld, { roomId: ids.roomId, recipientAlias: "A new potter", highlightClueIds: [ids.pottery] }));
    const asBob = JSON.stringify(value(await bob.query(api.worlds.listWorlds, {})));
    for (const secret of [ids.roomId, "INVITE-SECRET-77", "alice", "bob", "Priya", "Bobby", "Alice"]) expect(asBob).not.toContain(secret);
    expect(asBob).toContain("A new potter");
    // An unauthenticated reader gets nothing.
    expect(await t.query(api.worlds.listWorlds, {})).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("reflects the chosen gift, updates in place when shared again, and disappears when unshared", async () => {
    const { ids, alice, bob, t } = await setup();
    const first = value(await alice.mutation(api.worlds.shareWorld, { roomId: ids.roomId }));
    let worlds = value(await bob.query(api.worlds.listWorlds, {})).worlds;
    expect(worlds).toHaveLength(1);
    expect(worlds[0]).toMatchObject({ state: "exploring", budgetBand: "50_100", friends: 2, mine: false });

    await t.run(async (ctx) => {
      const jobId = await ctx.db.insert("researchJobs", {
        roomId: ids.roomId, knowledgeRevision: 1, publishedClueIds: [], status: "succeeded", inputHash: "h",
        idempotencyKey: "k", attempt: 1, createdAt: 0,
      });
      const listingId = await ctx.db.insert("productListings", {
        roomId: ids.roomId, jobId, source: "manual_fixture", sourceUrl: "https://example.com/x", title: "Priya's pottery class",
        currency: "USD", priceMinor: 9500, priceStatus: "observed", availability: "in_stock", shippingStatus: "unknown",
        retrievedAt: 0, status: "active",
      });
      const alicePart = (await ctx.db.query("participants").collect()).find((p) => p.userId === "alice")!;
      await ctx.db.insert("giftSelections", {
        roomId: ids.roomId, listingId, quantity: 1, status: "active", selectedBy: alicePart._id, selectedAt: 0,
        listingSnapshot: { title: "Priya's pottery class", sourceUrl: "https://example.com/x", priceMinor: 9500, priceStatus: "observed", retrievedAt: 0 },
      });
    });
    const second = value(await alice.mutation(api.worlds.shareWorld, { roomId: ids.roomId, recipientAlias: "A new potter" }));
    expect(second.id).toBe(first.id);
    worlds = value(await bob.query(api.worlds.listWorlds, {})).worlds;
    expect(worlds).toHaveLength(1);
    expect(worlds[0]).toMatchObject({ state: "chosen", outcome: { title: "A new potter's pottery class", priceMinor: 9500, source: "manual_fixture" } });
    expect(JSON.stringify(worlds)).not.toContain("Priya");

    expect((value(await alice.query(api.worlds.getMyWorldShare, { roomId: ids.roomId })))?.mine).toBe(true);
    value(await alice.mutation(api.worlds.unshareWorld, { roomId: ids.roomId }));
    expect(value(await bob.query(api.worlds.listWorlds, {})).worlds).toEqual([]);
    expect(value(await alice.query(api.worlds.getMyWorldShare, { roomId: ids.roomId }))).toBeNull();
  });
});

describe("samples and aggregates", () => {
  it("seeds labelled samples once, only when enabled, and reports real aggregates", async () => {
    const { alice, t } = await setup();
    expect(await alice.mutation(api.worlds.seedSampleWorlds, {})).toMatchObject({ ok: false, error: { code: "refused" } });
    vi.stubEnv("DEMO_SEED_ENABLED", "true");
    expect(value(await alice.mutation(api.worlds.seedSampleWorlds, {})).added).toBe(6);
    expect(value(await alice.mutation(api.worlds.seedSampleWorlds, {})).added).toBe(0);
    const { worlds, aggregate } = value(await alice.query(api.worlds.listWorlds, {}));
    expect(worlds.every((w) => w.isSample)).toBe(true);
    expect(aggregate).toMatchObject({ worlds: 6, samples: 6, chosen: 5 });
    expect(aggregate.medianChosenPriceMinor).toBe(9_500);
    expect(aggregate.topOccasions[0]).toEqual({ occasion: "Birthday", count: 2 });
    expect(t).toBeDefined();
  });
});
