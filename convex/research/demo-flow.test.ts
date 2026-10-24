// @vitest-environment edge-runtime
/** Offline two-user backend rehearsal. Real recorded shopping data; no provider/LLM calls. */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { modules } from "../test.setup";
import shopping from "../../lib/research/fixtures/trend-shopping.json";

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code + ": " + result.error.message);
  return result.value;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("rehearses two members finding a sourced tool, approving pledges, revising caps and recovering an invalid listing", async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetcher);
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "alex_demo|session_a" });
  const jordan = t.withIdentity({ subject: "jordan_demo|session_b" });
  const outsider = t.withIdentity({ subject: "outsider_demo|session_c" });
  const created = value(await alex.mutation(api.rooms.createRoom, {
    title: "Maya's birthday", recipientDisplayName: "Maya", occasion: "Birthday", budgetMinor: 8000, displayName: "Alex",
  }));
  const roomId = created.room._id;
  value(await jordan.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Jordan" }));
  const interest = value(await alex.mutation(api.clues.upsertManualPreference, {
    roomId, kind: "interest", text: "Interested in pottery",
  }));
  value(await jordan.mutation(api.clues.upsertManualPreference, {
    roomId, kind: "ownership", text: "Already owns a starter kit",
  }));
  const { jobId } = value(await alex.mutation(api.research.research.startResearch, {
    roomId, publishedClueIds: [interest._id], idempotencyKey: "offline-demo-research",
  }));
  // Recorded response injection at the provider-completion boundary. Not a live-source test.
  await t.mutation(internal.research.research.claimJob, { jobId });
  await t.mutation(internal.research.research.completeJob, { jobId, raw: shopping.data, retrievedAt: shopping.provenance.retrievedAt });
  const catalog = value(await jordan.query(api.research.research.listRecommendations, { roomId }));
  const roller = catalog.listings.find(listing => listing.title.startsWith("BHR-051"))!;
  expect(roller).toBeDefined();
  const listingId = roller.id as Id<"productListings">; // Public view uses string IDs; source is a real DB row.
  expect(catalog.recommendations.find(row => row.listingId === roller.id)?.publishedClueIds).toEqual([interest._id]);
  expect(await outsider.query(api.research.research.listRecommendations, { roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  expect(await jordan.mutation(api.proposals.selectGift, { roomId, listingId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });

  value(await alex.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 1500 }));
  value(await jordan.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 1500 }));
  value(await alex.mutation(api.proposals.selectGift, { roomId, listingId }));
  const proposal = value(await alex.mutation(api.proposals.createProposal, { roomId }));
  expect(proposal.feasible).toBe(true);
  expect(proposal.revision?.payableTotalMinor).toBe(2095);
  expect(proposal.shares.reduce((sum, share) => sum + share.amountMinor, 0)).toBe(2095);
  expect(proposal.revision?.conditions).toContain("Shipping is not yet known and is not included.");
  expect(proposal.revision?.conditions).toContain("Tax is not included.");
  const selectedListingId = value(await alex.query(api.proposals.getSelection, { roomId }))!.listingId;
  expect(selectedListingId).toBe(roller.id); // Selection is the actual normalized listing.
  const revisionDoc = (await t.run(ctx => ctx.db.get(roomId)))!.currentRevisionId!;
  value(await alex.mutation(api.proposals.approveRevision, { revisionId: revisionDoc }));
  value(await jordan.mutation(api.proposals.approveRevision, { revisionId: revisionDoc }));
  expect(value(await jordan.query(api.proposals.getProposal, { roomId })).revision?.status).toBe("approved_pledged");

  // A changed cap changes shares and invalidates both old approvals.
  value(await jordan.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 1000 }));
  const changed = value(await alex.query(api.proposals.getProposal, { roomId }));
  expect(changed.revision?.id).not.toBe(proposal.revision?.id);
  expect(changed.revision?.status).toBe("awaiting_approval");
  expect(changed.approvals.every(approval => approval.status === "pending")).toBe(true);
  expect(changed.myLimit?.amountMinor).toBe(1500); // Alex sees only Alex's cap.
  expect(value(await jordan.query(api.proposals.getProposal, { roomId })).myLimit?.amountMinor).toBe(1000);
  expect(await alex.mutation(api.proposals.approveRevision, { revisionId: revisionDoc })).toMatchObject({ ok: false, error: { code: "invalid_revision" } });

  const invalidated = value(await alex.mutation(api.research.research.invalidateListing, { roomId, listingId }));
  expect(invalidated.cleared).toBe(1);
  expect(value(await jordan.query(api.proposals.getSelection, { roomId }))).toBeNull();
  expect(value(await alex.query(api.research.research.listRecommendations, { roomId })).listings.some(listing => listing.id === roller.id)).toBe(false);
  expect(await t.run(ctx => ctx.db.query("researchJobs").collect())).toHaveLength(1);
  expect(fetcher).not.toHaveBeenCalled();
});
