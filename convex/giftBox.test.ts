// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../lib/contracts";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_MINOR } from "./lib/input";
import schema from "./schema";
import { modules } from "./test.setup";

function value<T>(r: Result<T>): T { if (!r.ok) throw new Error(r.error.message); return r.value; }
async function setup() {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "alex|box" });
  const sam = t.withIdentity({ subject: "sam|box" });
  const outsider = t.withIdentity({ subject: "outsider|box" });
  const room = value(await alex.mutation(api.rooms.createRoom, {
    title: "Gift box", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alex",
  }));
  const roomId = room.room._id;
  value(await sam.mutation(api.rooms.joinRoom, { inviteToken: room.inviteToken, displayName: "Sam" }));
  const jobId = await t.run(ctx => ctx.db.insert("researchJobs", { roomId, knowledgeRevision: 0,
    status: "succeeded", publishedClueIds: [], inputHash: "box", idempotencyKey: "box", attempt: 1, createdAt: Date.now() }));
  async function listing(title: string, overrides: Partial<Doc<"productListings">> = {}) {
    return t.run(ctx => ctx.db.insert("productListings", { roomId, jobId, source: "manual_fixture",
      sourceUrl: `https://example.com/${title}`, title, priceMinor: 4000, priceStatus: "observed", currency: "USD",
      availability: "unknown", shippingStatus: "unknown", retrievedAt: Date.now(), status: "active", ...overrides }));
  }
  const first = await listing("Fleece");
  const second = await listing("Trail-guide", { priceMinor: 1001, shippingStatus: "observed", shippingMinor: 200 });
  value(await alex.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 5000 }));
  value(await sam.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 1500 }));
  async function choose(listingIds: Id<"productListings">[] = [first, second]) {
    value(await alex.mutation(api.proposals.setGiftBox, { roomId, listingIds }));
    const r = value(await alex.query(api.proposals.getProposal, { roomId })).revision;
    if (!r) throw new Error("No revision");
    return r;
  }
  async function approve(revisionId: string) {
    const id = revisionId as Id<"proposalRevisions">;
    value(await alex.mutation(api.proposals.approveRevision, { revisionId: id }));
    value(await sam.mutation(api.proposals.approveRevision, { revisionId: id }));
    return { roomId, revisionId: id };
  }
  return { t, alex, sam, outsider, roomId, first, second, listing, choose, approve };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("one or multiple gifts use one approved proposal and contribution simulation", () => {
  it("freezes every source and sums each observed price and shipping, with capped shares", async () => {
    const s = await setup(); const r = await s.choose();
    expect(r.items?.map(i => i.listingId)).toEqual([s.first, s.second]);
    expect(r.items?.map(i => i.listingSnapshot.sourceUrl)).toEqual(["https://example.com/Fleece", "https://example.com/Trail-guide"]);
    expect(r.payableTotalMinor).toBe(5201);
    expect(r.shares.map(i => i.amountMinor)).toEqual([3701, 1500]);
    expect(r.conditions.join(" ")).toContain("Shipping is not yet known and is not included");
    expect(r.conditions.join(" ")).toContain("Tax is not included");
    const stable = await s.choose(); expect(stable.id).toBe(r.id);
    const args = await s.approve(r.id);
    expect(value(await s.alex.mutation(api.payments.simulation.simulateContribution, args))).toMatchObject({ myShareMinor: 3701, completedCount: 1 });
    value(await s.sam.mutation(api.payments.simulation.simulateContribution, args));
    expect(value(await s.alex.mutation(api.payments.simulation.wrapGift, args)).status).toBe("wrapped");
    expect(await s.t.run(ctx => ctx.db.query("paymentAttempts").collect())).toEqual([]);
    expect(await s.t.run(ctx => ctx.db.query("providerEvents").collect())).toEqual([]);
  });
  it("keeps selectGift as replace-with-one and clears the whole box with an empty array", async () => {
    const s = await setup(); const multi = await s.choose();
    const single = value(await s.alex.mutation(api.proposals.selectGift, { roomId: s.roomId, listingId: s.second }));
    expect(single.selection.items).toHaveLength(1);
    expect(single.revision?.payableTotalMinor).toBe(1201);
    expect(single.revision?._id).not.toBe(multi.id);
    expect(value(await s.alex.mutation(api.proposals.setGiftBox, { roomId: s.roomId, listingIds: [] }))).toEqual({ selection: null });
    expect(value(await s.alex.query(api.proposals.getSelection, { roomId: s.roomId }))).toBeNull();
    expect(value(await s.alex.query(api.payments.simulation.getState, { roomId: s.roomId })).status).toBe("no_proposal");
  });
  it("resets approvals and simulation after adding or removing items, even at the same total", async () => {
    const s = await setup(); const r = await s.choose(); const args = await s.approve(r.id);
    value(await s.alex.mutation(api.payments.simulation.simulateContribution, args));
    const replacement = await s.listing("Different-guide", { priceMinor: 1001, shippingStatus: "observed", shippingMinor: 200 });
    const next = await s.choose([s.first, replacement]);
    expect(next.payableTotalMinor).toBe(r.payableTotalMinor);
    expect(next.id).not.toBe(r.id);
    expect(value(await s.alex.query(api.payments.simulation.getState, { roomId: s.roomId }))).toMatchObject({ completedCount: 0, status: "waiting_for_approvals" });
    expect(await s.alex.mutation(api.payments.simulation.simulateContribution, args)).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    const approvals = await s.t.run(ctx => ctx.db.query("approvals").withIndex("by_revision", q => q.eq("revisionId", args.revisionId)).collect());
    expect(approvals.every(a => a.status === "invalidated")).toBe(true);
    expect((await s.choose([s.first])).payableTotalMinor).toBe(4000);
  });
  it.each(["approve", "simulate", "wrap"] as const)("rechecks a second item's changed price before %s and keeps the old snapshot immutable", async action => {
    const s = await setup(); const r = await s.choose(); const args = await s.approve(r.id);
    if (action === "wrap") {
      value(await s.alex.mutation(api.payments.simulation.simulateContribution, args));
      value(await s.sam.mutation(api.payments.simulation.simulateContribution, args));
    }
    await s.t.run(ctx => ctx.db.patch(s.second, { priceMinor: 1101 }));
    const result = action === "approve" ? await s.alex.mutation(api.proposals.approveRevision, { revisionId: args.revisionId })
      : action === "wrap" ? await s.alex.mutation(api.payments.simulation.wrapGift, args)
      : await s.alex.mutation(api.payments.simulation.simulateContribution, args);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    const next = value(await s.alex.query(api.proposals.getProposal, { roomId: s.roomId })).revision!;
    expect(next.payableTotalMinor).toBe(5301);
    expect(next.id).not.toBe(r.id);
    const old = await s.t.run(ctx => ctx.db.get(args.revisionId));
    expect(old?.items?.[1]?.listingSnapshot.priceMinor).toBe(1001);
    expect(old?.status).toBe("superseded");
    expect(value(await s.alex.query(api.proposals.getSelection, { roomId: s.roomId }))?.items?.[1]?.listingSnapshot.priceMinor).toBe(1101);
  });
  it("resets approval when component prices change but the combined total stays the same", async () => {
    const s = await setup(); const r = await s.choose(); await s.approve(r.id);
    await s.t.run(async ctx => { await ctx.db.patch(s.first, { priceMinor: 3900 }); await ctx.db.patch(s.second, { priceMinor: 1101 }); });
    const next = value(await s.alex.mutation(api.proposals.createProposal, { roomId: s.roomId })).revision!;
    expect(next.payableTotalMinor).toBe(r.payableTotalMinor); expect(next.id).not.toBe(r.id);
    expect(next.status).toBe("awaiting_approval");
  });
  it("includes second-item shipping changes in a fresh revision", async () => {
    const s = await setup(); const r = await s.choose();
    await s.t.run(ctx => ctx.db.patch(s.second, { shippingMinor: 300 }));
    const next = value(await s.alex.mutation(api.proposals.createProposal, { roomId: s.roomId })).revision!;
    expect(next.payableTotalMinor).toBe(5301); expect(next.id).not.toBe(r.id);
  });
  it.each([
    { priceStatus: "unknown" as const, priceMinor: undefined },
    { priceMinor: -1 }, { priceMinor: 0 }, { priceMinor: 1.5 },
    { priceMinor: Number.MAX_SAFE_INTEGER }, { priceMinor: MAX_MINOR },
    { shippingStatus: "observed" as const, shippingMinor: -1 },
    { shippingStatus: "observed" as const, shippingMinor: undefined },
  ])("refuses funding a partially known or invalid box: %j", async overrides => {
    const s = await setup(); await s.t.run(ctx => ctx.db.patch(s.second, overrides));
    const r = await s.choose(); expect(r.status).toBe("infeasible"); expect(r.shares).toEqual([]);
    expect(await s.alex.mutation(api.proposals.approveRevision, { revisionId: r.id as Id<"proposalRevisions"> })).toMatchObject({ ok: false, error: { code: "infeasible" } });
  });
  it("makes the combined proposal infeasible when caps cover one gift but not the box", async () => {
    const s = await setup(); await s.t.run(ctx => ctx.db.patch(s.second, { priceMinor: 4000 }));
    const r = await s.choose(); expect(r.status).toBe("infeasible"); expect(r.payableTotalMinor).toBe(8200);
    expect(r.shares).toEqual([]);
  });
  it("denies nonorganizers, outsiders, duplicates and oversize boxes without touching the selection", async () => {
    const s = await setup(); const r = await s.choose();
    for (const client of [s.sam, s.outsider, s.t]) {
      expect(await client.mutation(api.proposals.setGiftBox, { roomId: s.roomId, listingIds: [s.first] })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
      expect(await client.mutation(api.proposals.setGiftBox, { roomId: s.roomId, listingIds: [] })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    }
    for (const listingIds of [[s.first, s.first], Array.from({ length: 13 }, () => s.first)]) {
      expect(await s.alex.mutation(api.proposals.setGiftBox, { roomId: s.roomId, listingIds })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    }
    expect(value(await s.alex.query(api.proposals.getProposal, { roomId: s.roomId })).revision?.id).toBe(r.id);
  });
  it("accepts twelve distinct gifts but rejects a thirteenth without changing the box", async () => {
    const s = await setup();
    const listingIds = [s.first, s.second];
    for (let i = 2; i < 13; i++) listingIds.push(await s.listing(`Extra-${i}`, { priceMinor: 100 }));
    const r = await s.choose(listingIds.slice(0, 12));
    expect(r.items).toHaveLength(12);
    expect(await s.alex.mutation(api.proposals.setGiftBox, { roomId: s.roomId, listingIds })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(value(await s.alex.query(api.proposals.getProposal, { roomId: s.roomId })).revision?.id).toBe(r.id);
  });
  it("rejects a foreign, unavailable or invalid second item atomically", async () => {
    const s = await setup(); const r = await s.choose([s.first]);
    const foreign = value(await s.outsider.mutation(api.rooms.createRoom, { title: "Other", recipientDisplayName: "Other", occasion: "Birthday" })).room._id;
    for (const overrides of [{ roomId: foreign }, { availability: "unavailable" as const }, { status: "invalid" as const }]) {
      const id = await s.listing("Bad-item", overrides);
      expect(await s.alex.mutation(api.proposals.setGiftBox, { roomId: s.roomId, listingIds: [s.first, id] })).toMatchObject({ ok: false, error: { code: "not_found" } });
      expect(value(await s.alex.query(api.proposals.getProposal, { roomId: s.roomId })).revision?.id).toBe(r.id);
    }
  });
  it("clears the box and simulation if any selected item is invalidated", async () => {
    const s = await setup(); const r = await s.choose(); const args = await s.approve(r.id);
    value(await s.alex.mutation(api.payments.simulation.simulateContribution, args));
    expect(value(await s.alex.mutation(api.research.research.invalidateListing, { roomId: s.roomId, listingId: s.second })).cleared).toBe(1);
    expect(value(await s.alex.query(api.proposals.getSelection, { roomId: s.roomId }))).toBeNull();
    expect(value(await s.alex.query(api.payments.simulation.getState, { roomId: s.roomId })).status).toBe("no_proposal");
    expect((await s.t.run(ctx => ctx.db.get(args.revisionId)))?.status).toBe("superseded");
  });
  it("keeps payment-frozen boxes immutable", async () => {
    const s = await setup(); const r = await s.choose();
    await s.t.run(ctx => ctx.db.patch(r.id as Id<"proposalRevisions">, { status: "capturing" }));
    for (const listingIds of [[], [s.first]]) {
      expect(await s.alex.mutation(api.proposals.setGiftBox, { roomId: s.roomId, listingIds })).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    }
    expect(await s.alex.mutation(api.research.research.invalidateListing, { roomId: s.roomId, listingId: s.second })).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    expect((await s.t.run(ctx => ctx.db.get(s.second)))?.status).toBe("active");
  });
  it("reads legacy single-gift rows and upgrades snapshots without an external data migration", async () => {
    const s = await setup(); const r = await s.choose([s.first]);
    await s.t.run(async ctx => {
      const room = (await ctx.db.get(s.roomId))!;
      await ctx.db.patch(room.currentSelectionId!, { items: undefined });
      await ctx.db.patch(r.id as Id<"proposalRevisions">, { items: undefined });
    });
    const view = value(await s.alex.mutation(api.proposals.createProposal, { roomId: s.roomId }));
    expect(view.revision?.items?.map(i => i.listingId)).toEqual([s.first]);
    expect(view.revision?.payableTotalMinor).toBe(4000);
  });
  it("atomically adds multiple gifts under concurrent clicks and removes only one at a time", async () => {
    const s = await setup();
    const add = (listingId: Id<"productListings">) => s.alex.mutation(api.proposals.addGiftToBox, { roomId: s.roomId, listingId });
    await Promise.all([add(s.first), add(s.second), add(s.first)]);
    const selection = value(await s.alex.query(api.proposals.getSelection, { roomId: s.roomId }))!;
    expect(new Set(selection.items?.map(item => item.listingId))).toEqual(new Set([s.first, s.second]));
    const before = value(await s.alex.query(api.proposals.getProposal, { roomId: s.roomId })).revision!;
    await add(s.first);
    expect(value(await s.alex.query(api.proposals.getProposal, { roomId: s.roomId })).revision?.id).toBe(before.id);
    value(await s.alex.mutation(api.proposals.removeGiftFromBox, { roomId: s.roomId, listingId: s.second }));
    expect(value(await s.alex.query(api.proposals.getSelection, { roomId: s.roomId }))?.items?.map(item => item.listingId)).toEqual([s.first]);
    expect(value(await s.alex.query(api.proposals.getProposal, { roomId: s.roomId })).revision?.payableTotalMinor).toBe(4000);
    value(await s.alex.mutation(api.proposals.removeGiftFromBox, { roomId: s.roomId, listingId: s.first }));
    expect(value(await s.alex.query(api.proposals.getSelection, { roomId: s.roomId }))).toBeNull();
  });
  it("keeps selected items available after a newer search replaces the candidate pool", async () => {
    const s = await setup(); await s.choose();
    await s.t.run(async ctx => {
      const source = (await ctx.db.get(s.first))!;
      const jobId = await ctx.db.insert("researchJobs", { roomId: s.roomId, knowledgeRevision: 0, status: "succeeded", publishedClueIds: [], inputHash: "new-search", idempotencyKey: "new-search", attempt: 1, createdAt: Date.now() + 1 });
      const { _id, _creationTime, ...fields } = source;
      await ctx.db.insert("productListings", { ...fields, jobId, title: "New search result", sourceUrl: "https://example.com/new" });
    });
    const results = value(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId }));
    expect(results.recommendations.map(r => r.listingId)).toEqual(expect.arrayContaining([s.first, s.second]));
    expect(results.listings.map(l => l.id)).toEqual(expect.arrayContaining([s.first, s.second]));
  });
  it("denies contributor box edits and protects locked boxes for additive operations", async () => {
    const s = await setup(); const r = await s.choose();
    expect(await s.sam.mutation(api.proposals.addGiftToBox, { roomId: s.roomId, listingId: s.first })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await s.sam.mutation(api.proposals.removeGiftFromBox, { roomId: s.roomId, listingId: s.first })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    await s.t.run(ctx => ctx.db.patch(r.id as Id<"proposalRevisions">, { status: "capturing" }));
    expect(await s.alex.mutation(api.proposals.addGiftToBox, { roomId: s.roomId, listingId: s.first })).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    expect(await s.alex.mutation(api.proposals.removeGiftFromBox, { roomId: s.roomId, listingId: s.first })).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
  });

});
