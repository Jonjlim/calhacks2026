// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";

function value<T>(r: Result<T>): T { if (!r.ok) throw new Error(r.error.message); return r.value; }
async function setup(bobCap = 1500) {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "alex|s1" });
  const sam = t.withIdentity({ subject: "sam|s2" });
  const outsider = t.withIdentity({ subject: "outsider|s3" });
  const created = value(await alex.mutation(api.rooms.createRoom, { title: "Simulation fixture", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alex" }));
  const roomId = created.room._id;
  value(await sam.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Sam" }));
  const listingId = await t.run(async ctx => {
    const jobId = await ctx.db.insert("researchJobs", { roomId, knowledgeRevision: 0, status: "succeeded", publishedClueIds: [], inputHash: "fixture", idempotencyKey: "fixture", attempt: 1, createdAt: Date.now() });
    return ctx.db.insert("productListings", { roomId, jobId, source: "manual_fixture", sourceUrl: "https://example.com/sample-gift", title: "Sample gift", priceStatus: "observed", priceMinor: 4000, currency: "USD", availability: "unknown", shippingStatus: "unknown", retrievedAt: Date.now(), status: "active" });
  });
  value(await alex.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 5000 }));
  value(await sam.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: bobCap }));
  const selected = value(await alex.mutation(api.proposals.selectGift, { roomId, listingId }));
  const revisionId = selected.revision!._id;
  async function approve() {
    value(await alex.mutation(api.proposals.approveRevision, { revisionId }));
    value(await sam.mutation(api.proposals.approveRevision, { revisionId }));
  }
  return { t, alex, sam, outsider, roomId, revisionId, args: { roomId, revisionId }, approve };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("shared contribution simulation, isolated from actual payments", () => {
  it("denies nonmembers and unauthenticated agent-like calls", async () => {
    const s = await setup(); await s.approve();
    for (const client of [s.outsider, s.t]) {
      expect(await client.query(api.payments.simulation.getState, { roomId: s.roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
      expect(await client.mutation(api.payments.simulation.simulateContribution, s.args)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    }
    expect(await s.t.run(ctx => ctx.db.query("paymentSimulations").collect())).toHaveLength(0);
  });
  it("requires all current approvals before recording any simulation", async () => {
    const s = await setup();
    expect(value(await s.alex.query(api.payments.simulation.getState, { roomId: s.roomId }))).toMatchObject({ mode: "simulation", status: "waiting_for_approvals", canSimulate: false });
    expect(await s.alex.mutation(api.payments.simulation.simulateContribution, s.args)).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    expect(await s.t.run(ctx => ctx.db.query("paymentSimulations").collect())).toHaveLength(0);
  });
  it("records each person's own exact share, synchronizes counts and wraps only after all are done", async () => {
    const s = await setup(); await s.approve();
    expect(value(await s.alex.query(api.payments.simulation.getState, { roomId: s.roomId }))).toMatchObject({ myShareMinor: 2500, payerCount: 2, completedCount: 0, status: "ready" });
    const first = value(await s.alex.mutation(api.payments.simulation.simulateContribution, s.args));
    expect(first).toMatchObject({ completedCount: 1, myCompleted: true, canWrap: false, status: "collecting" });
    expect(value(await s.alex.mutation(api.payments.simulation.simulateContribution, s.args))).toEqual(first);
    expect(value(await s.sam.query(api.payments.simulation.getState, { roomId: s.roomId }))).toMatchObject({ myShareMinor: 1500, completedCount: 1, myCompleted: false, canSimulate: true });
    expect(await s.alex.mutation(api.payments.simulation.wrapGift, s.args)).toMatchObject({ ok: false, error: { code: "refused" } });
    await s.sam.mutation(api.payments.simulation.simulateContribution, s.args);
    expect(await s.sam.mutation(api.payments.simulation.wrapGift, s.args)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(value(await s.alex.mutation(api.payments.simulation.wrapGift, s.args))).toMatchObject({ status: "wrapped", completedCount: 2 });
    expect(value(await s.alex.mutation(api.payments.simulation.wrapGift, s.args)).status).toBe("wrapped");
    expect(value(await s.sam.query(api.payments.simulation.getState, { roomId: s.roomId })).status).toBe("wrapped");
    expect((await s.t.run(ctx => ctx.db.get(s.revisionId)))?.status).toBe("approved_pledged");
    expect(await s.t.run(ctx => ctx.db.query("paymentAttempts").collect())).toEqual([]);
    expect(await s.t.run(ctx => ctx.db.query("providerEvents").collect())).toEqual([]);
    expect(await s.t.run(ctx => ctx.db.query("giftWorlds").collect())).toEqual([]);
    expect(JSON.stringify(first)).not.toMatch(/private|limitMinor|5000|checkout|providerObject/);
  });
  it("keeps concurrent and duplicate clicks on one revision from losing or duplicating marks", async () => {
    const s = await setup(); await s.approve();
    await Promise.all([
      s.alex.mutation(api.payments.simulation.simulateContribution, s.args),
      s.sam.mutation(api.payments.simulation.simulateContribution, s.args),
      s.alex.mutation(api.payments.simulation.simulateContribution, s.args),
    ]);
    expect(value(await s.alex.query(api.payments.simulation.getState, { roomId: s.roomId }))).toMatchObject({ completedCount: 2, status: "complete", canWrap: true });
    const rows = await s.t.run(ctx => ctx.db.query("paymentSimulations").collect());
    expect(rows).toHaveLength(1);
    expect(new Set(rows[0]!.completedParticipantIds).size).toBe(2);
  });
  it("clears visible progress after a cap changes the revision and refuses old clicks", async () => {
    const s = await setup(); await s.approve();
    await s.alex.mutation(api.payments.simulation.simulateContribution, s.args);
    await s.sam.mutation(api.proposals.setContributionLimit, { roomId: s.roomId, amountMinor: 1000 });
    const next = value(await s.alex.query(api.payments.simulation.getState, { roomId: s.roomId }));
    expect(next.revisionId).not.toBe(s.revisionId);
    expect(next).toMatchObject({ status: "waiting_for_approvals", completedCount: 0, myCompleted: false });
    expect(await s.alex.mutation(api.payments.simulation.simulateContribution, s.args)).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
    expect(await s.alex.mutation(api.payments.simulation.wrapGift, s.args)).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
  });
  it("invalidates the shared simulation when an approval is withdrawn and renewed", async () => {
    const s = await setup(); await s.approve();
    await s.alex.mutation(api.payments.simulation.simulateContribution, s.args);
    vi.advanceTimersByTime(5);
    await s.sam.mutation(api.proposals.withdrawApproval, { revisionId: s.revisionId });
    expect(value(await s.alex.query(api.payments.simulation.getState, { roomId: s.roomId }))).toMatchObject({ completedCount: 0, myCompleted: false, canSimulate: false });
    vi.advanceTimersByTime(5);
    await s.sam.mutation(api.proposals.approveRevision, { revisionId: s.revisionId });
    expect(value(await s.alex.query(api.payments.simulation.getState, { roomId: s.roomId }))).toMatchObject({ completedCount: 0, myCompleted: false, canSimulate: true });
  });
  it("requires no simulated contribution for zero-share members", async () => {
    const s = await setup(0); await s.approve();
    expect(await s.sam.mutation(api.payments.simulation.simulateContribution, s.args)).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(value(await s.sam.query(api.payments.simulation.getState, { roomId: s.roomId }))).toMatchObject({ payerCount: 1, myShareMinor: 0, canSimulate: false });
    await s.alex.mutation(api.payments.simulation.simulateContribution, s.args);
    expect(value(await s.alex.mutation(api.payments.simulation.wrapGift, s.args)).status).toBe("wrapped");
  });
  it("purges simulation marks with a deleted room and refuses late writes", async () => {
    const s = await setup(); await s.approve();
    await s.alex.mutation(api.payments.simulation.simulateContribution, s.args);
    value(await s.alex.mutation(api.rooms.deleteRoom, { roomId: s.roomId, confirmTitle: "Simulation fixture" }));
    expect(await s.sam.mutation(api.payments.simulation.simulateContribution, s.args)).toMatchObject({ ok: false, error: { code: "not_found" } });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.t.run(ctx => ctx.db.query("paymentSimulations").collect())).toEqual([]);
  });
});
