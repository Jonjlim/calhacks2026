// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import schema from "../schema";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code + ": " + result.error.message);
  return result.value;
}

async function setup() {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "user_alex|session1" });
  const bob = t.withIdentity({ subject: "user_bob|session2" });
  const eve = t.withIdentity({ subject: "user_eve|session3" });
  const created = unwrap(await alex.mutation(api.rooms.createRoom, {
    title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday", budgetMinor: 8000,
  }));
  const roomId = created.room._id;
  unwrap(await bob.mutation(api.rooms.joinRoom, {
    inviteToken: created.inviteToken, displayName: "Bob",
  }));
  const [listingId, otherId] = await t.run(async ctx => {
    const jobId = await ctx.db.insert("researchJobs", {
      roomId, knowledgeRevision: 0, publishedClueIds: [], status: "succeeded",
      inputHash: "fixture", idempotencyKey: "fixture", attempt: 1, createdAt: Date.now(),
    });
    const seed = async (title: string, priceMinor: number) => ctx.db.insert("productListings", {
      roomId, jobId, source: "manual_fixture", sourceUrl: "https://example.com/fixture",
      title, currency: "USD", priceMinor, priceStatus: "observed",
      availability: "unknown", shippingStatus: "unknown", retrievedAt: Date.now(), status: "active",
    });
    return [await seed("Pottery Tools", 2230), await seed("Pottery Glaze Set", 1250)] as const;
  });
  unwrap(await alex.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 5000 }));
  unwrap(await bob.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 5000 }));
  const selected = unwrap(await alex.mutation(api.proposals.selectGift, { roomId, listingId }));
  const revision = selected.revision!;
  unwrap(await alex.mutation(api.proposals.approveRevision, { revisionId: revision._id }));
  unwrap(await bob.mutation(api.proposals.approveRevision, { revisionId: revision._id }));
  return { t, alex, bob, eve, roomId, listingId, otherId, revision, selectionId: selected.selection._id };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("listing invalidation (RC-007)", () => {
  it("atomically clears a selected gift and supersedes its pledged proposal and approvals", async () => {
    const { t, alex, bob, roomId, listingId, revision, selectionId } = await setup();
    const result = unwrap(await alex.mutation(api.research.research.invalidateListing, { roomId, listingId }));
    expect(result).toEqual({ listingId, cleared: 1 });
    const state = await t.run(async ctx => ({
      listing: await ctx.db.get(listingId),
      selection: await ctx.db.get(selectionId),
      revision: await ctx.db.get(revision._id),
      room: await ctx.db.get(roomId),
      approvals: await ctx.db.query("approvals")
        .withIndex("by_revision", q => q.eq("revisionId", revision._id)).collect(),
    }));
    expect(state.listing?.status).toBe("invalid");
    expect(state.selection?.status).toBe("cleared");
    expect(state.revision?.status).toBe("superseded");
    expect(state.revision?.payableTotalMinor).toBe(2230); // immutable deal snapshot retained
    expect(state.room?.currentSelectionId).toBeUndefined();
    expect(state.room?.currentRevisionId).toBeUndefined();
    expect(state.approvals).toHaveLength(2);
    expect(state.approvals.every(approval => approval.status === "invalidated")).toBe(true);
    expect(unwrap(await alex.query(api.proposals.getSelection, { roomId }))).toBeNull();
    expect(unwrap(await alex.query(api.proposals.getProposal, { roomId })).revision).toBeNull();
    expect(await bob.mutation(api.proposals.approveRevision, { revisionId: revision._id }))
      .toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    expect(await alex.mutation(api.proposals.selectGift, { roomId, listingId }))
      .toMatchObject({ ok: false, error: { code: "not_found" } });
    const candidates = unwrap(await alex.query(api.research.research.listRecommendations, { roomId }));
    expect(candidates.listings.some(row => row.id === listingId)).toBe(false);
    expect(candidates.recommendations.some(row => row.listingId === listingId)).toBe(false);
  });

  it("denies outsiders and ordinary members without changing the listing or deal", async () => {
    const { t, bob, eve, roomId, listingId, revision } = await setup();
    for (const actor of [bob, eve]) {
      expect(await actor.mutation(api.research.research.invalidateListing, { roomId, listingId }))
        .toMatchObject({ ok: false, error: { code: "unauthorized" } });
    }
    expect((await t.run(ctx => ctx.db.get(listingId)))?.status).toBe("active");
    expect((await t.run(ctx => ctx.db.get(revision._id)))?.status).toBe("approved_pledged");
  });

  it("rejects a listing from another room even when the caller organizes both", async () => {
    const { t, alex, listingId } = await setup();
    const second = unwrap(await alex.mutation(api.rooms.createRoom, {
      title: "Other", recipientDisplayName: "Other", occasion: "Birthday",
    }));
    expect(await alex.mutation(api.research.research.invalidateListing, {
      roomId: second.room._id, listingId,
    })).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect((await t.run(ctx => ctx.db.get(listingId)))?.status).toBe("active");
  });

  it("invalidates an unselected listing without disturbing the approved gift", async () => {
    const { t, alex, roomId, listingId, otherId, revision, selectionId } = await setup();
    expect(unwrap(await alex.mutation(api.research.research.invalidateListing, {
      roomId, listingId: otherId,
    }))).toEqual({ listingId: otherId, cleared: 0 });
    expect((await t.run(ctx => ctx.db.get(otherId)))?.status).toBe("invalid");
    expect((await t.run(ctx => ctx.db.get(listingId)))?.status).toBe("active");
    expect((await t.run(ctx => ctx.db.get(selectionId)))?.status).toBe("active");
    expect((await t.run(ctx => ctx.db.get(revision._id)))?.status).toBe("approved_pledged");
    expect(unwrap(await alex.query(api.proposals.getProposal, { roomId })).approvals
      .every(approval => approval.status === "approved")).toBe(true);
  });

  it("is idempotent and does not clear a different replacement gift", async () => {
    const { t, alex, roomId, listingId, otherId, revision } = await setup();
    unwrap(await alex.mutation(api.research.research.invalidateListing, { roomId, listingId }));
    const replacement = unwrap(await alex.mutation(api.proposals.selectGift, { roomId, listingId: otherId }));
    expect(unwrap(await alex.mutation(api.research.research.invalidateListing, { roomId, listingId })))
      .toEqual({ listingId, cleared: 0 });
    expect(unwrap(await alex.query(api.proposals.getSelection, { roomId }))?._id)
      .toBe(replacement.selection._id);
    expect(unwrap(await alex.query(api.proposals.getProposal, { roomId })).revision?.id)
      .toBe(replacement.revision?._id);
    expect((await t.run(ctx => ctx.db.get(revision._id)))?.status).toBe("superseded");
  });

  it("refuses a payment-locked selected deal without partially invalidating its listing", async () => {
    const { t, alex, roomId, listingId, revision, selectionId } = await setup();
    await t.run(ctx => ctx.db.patch(revision._id, { status: "capturing" }));
    expect(await alex.mutation(api.research.research.invalidateListing, { roomId, listingId }))
      .toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    expect((await t.run(ctx => ctx.db.get(listingId)))?.status).toBe("active");
    expect((await t.run(ctx => ctx.db.get(selectionId)))?.status).toBe("active");
    expect((await t.run(ctx => ctx.db.get(revision._id)))?.status).toBe("capturing");
    expect((await t.run(ctx => ctx.db.get(roomId)))?.currentRevisionId).toBe(revision._id);
  });

  it("provides the same atomic behavior through the trusted internal entry point", async () => {
    const { t, listingId, revision } = await setup();
    expect(unwrap(await t.mutation(internal.research.research.invalidateListingInternal, { listingId })))
      .toEqual({ listingId, cleared: 1 });
    expect((await t.run(ctx => ctx.db.get(listingId)))?.status).toBe("invalid");
    expect((await t.run(ctx => ctx.db.get(revision._id)))?.status).toBe("superseded");
    expect(unwrap(await t.mutation(internal.research.research.invalidateListingInternal, { listingId })))
      .toEqual({ listingId, cleared: 0 });
  });

  it("returns not_found for deleted listings", async () => {
    const { t, alex, roomId, otherId } = await setup();
    await t.run(ctx => ctx.db.delete(otherId));
    expect(await alex.mutation(api.research.research.invalidateListing, { roomId, listingId: otherId }))
      .toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await t.mutation(internal.research.research.invalidateListingInternal, { listingId: otherId }))
      .toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});
