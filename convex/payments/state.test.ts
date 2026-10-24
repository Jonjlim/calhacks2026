// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** BE-015: payment state machine against the real schema and proposal engine. */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { modules } from "../test.setup";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
function code<T>(result: Result<T>): string | null {
  return result.ok ? null : result.error.code;
}

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "user_alice|s1" });
  const bob = t.withIdentity({ subject: "user_bob|s2" });
  const eve = t.withIdentity({ subject: "user_eve|s3" });
  const created = unwrap(
    await alice.mutation(api.rooms.createRoom, {
      title: "Maya",
      recipientDisplayName: "Maya",
      occasion: "Birthday",
      displayName: "Alice",
    }),
  );
  const roomId = created.room._id;
  const bobP = unwrap(await bob.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Bob" }))
    .participant._id;
  const listingId = await t.run(async (ctx) => {
    const jobId = await ctx.db.insert("researchJobs", {
      roomId,
      knowledgeRevision: 0,
      publishedClueIds: [],
      status: "succeeded",
      inputHash: "h",
      idempotencyKey: "k",
      attempt: 1,
      createdAt: Date.now(),
    });
    return await ctx.db.insert("productListings", {
      roomId,
      jobId,
      source: "manual_fixture",
      sourceUrl: "https://example.com/wheel",
      title: "Mini pottery wheel",
      currency: "USD",
      priceMinor: 9000,
      priceStatus: "observed",
      availability: "in_stock",
      shippingStatus: "unknown",
      retrievedAt: Date.now(),
      status: "active",
    });
  });
  unwrap(await alice.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 6000 }));
  unwrap(await bob.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 6000 }));
  const revision = unwrap(await alice.mutation(api.proposals.selectGift, { roomId, listingId })).revision!;
  return { t, alice, bob, eve, roomId, listingId, revisionId: revision._id, aliceP: created.participant._id, bobP };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function approveAll({ alice, bob, revisionId }: Ctx) {
  unwrap(await alice.mutation(api.proposals.approveRevision, { revisionId }));
  unwrap(await bob.mutation(api.proposals.approveRevision, { revisionId }));
}

async function authorize(c: Ctx, who: "alice" | "bob", key = `${who}-1`) {
  const intent = unwrap(await c[who].mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: key }));
  unwrap(await c.t.mutation(internal.payments.state.attachProviderObject, { attemptId: intent.attemptId, providerObjectId: `pi_${who}_${key}` }));
  unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: intent.attemptId, status: "authorized" }));
  return intent.attemptId;
}

async function revisionStatus(c: Ctx, id: Id<"proposalRevisions"> = c.revisionId) {
  return (await c.t.run((ctx) => ctx.db.get(id)))!.status;
}
async function attemptStatus(c: Ctx, id: Id<"paymentAttempts">) {
  return (await c.t.run((ctx) => ctx.db.get(id)))!.status;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PAYMENTS_SANDBOX_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("payments gating and access", () => {
  it("refuses everything when sandbox payments are disabled and reports pledges", async () => {
    const c = await setup();
    await approveAll(c);
    vi.stubEnv("PAYMENTS_SANDBOX_ENABLED", "");
    expect(code(await c.alice.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "k" }))).toBe("refused");
    expect(code(await c.alice.mutation(api.payments.state.beginCapture, { revisionId: c.revisionId }))).toBe("refused");
    const status = unwrap(await c.alice.query(api.payments.state.getPaymentStatus, { roomId: c.roomId }));
    expect(status).toMatchObject({ enabled: false, groupStatus: "approved_pledged", merchantOrder: { status: "not_implemented" } });
  });

  it("requires a human member with a share on the current, fully approved revision", async () => {
    const c = await setup();
    expect(code(await c.alice.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "k" }))).toBe("invalid_revision");
    await approveAll(c);
    // Scheduled agent actions run with no identity.
    expect(code(await c.t.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "k" }))).toBe("unauthorized");
    expect(code(await c.eve.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "k" }))).toBe("unauthorized");
    expect(code(await c.alice.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: " " }))).toBe("validation_failed");
    expect(code(await c.eve.query(api.payments.state.getPaymentStatus, { roomId: c.roomId }))).toBe("unauthorized");
  });
});

describe("authorization and capture", () => {
  it("records intent idempotently, freezes on capture, and funds only after every capture", async () => {
    const c = await setup();
    await approveAll(c);
    const first = unwrap(await c.alice.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "a1" }));
    expect(first).toMatchObject({ created: true, status: "authorization_pending", amountMinor: 4500, currency: "USD" });
    expect(await revisionStatus(c)).toBe("authorizing");
    const again = unwrap(await c.alice.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "a1" }));
    const otherKey = unwrap(await c.alice.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "a2" }));
    expect(again).toMatchObject({ attemptId: first.attemptId, created: false });
    expect(otherKey.attemptId).toBe(first.attemptId);

    unwrap(await c.t.mutation(internal.payments.state.attachProviderObject, { attemptId: first.attemptId, providerObjectId: "pi_a" }));
    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: first.attemptId, status: "authorized" }));
    const bobAttempt = await authorize(c, "bob");
    expect(await revisionStatus(c)).toBe("ready_to_capture");

    const bobView = unwrap(await c.bob.query(api.payments.state.getPaymentStatus, { roomId: c.roomId }));
    expect(bobView).toMatchObject({ enabled: true, payerCount: 2, authorizedCount: 2, frozen: false });
    expect(bobView.myAttempt?.id).toBe(bobAttempt);
    expect(Object.keys(bobView.myAttempt!)).not.toContain("providerObjectId");
    expect(Object.keys(bobView.myAttempt!)).not.toContain("idempotencyKey");

    expect(code(await c.bob.mutation(api.payments.state.beginCapture, { revisionId: c.revisionId }))).toBe("unauthorized");
    const capture = unwrap(await c.alice.mutation(api.payments.state.beginCapture, { revisionId: c.revisionId }));
    expect(capture.attempts).toHaveLength(2);
    expect(JSON.stringify(capture)).not.toContain("pi_");
    expect(await revisionStatus(c)).toBe("capturing");
    const retry = unwrap(await c.alice.mutation(api.payments.state.beginCapture, { revisionId: c.revisionId }));
    expect(retry.attempts).toHaveLength(2);

    // Freeze: no edits while capturing.
    expect(code(await c.bob.mutation(api.proposals.setContributionLimit, { roomId: c.roomId, amountMinor: 9000 }))).toBe("invalid_revision");
    expect(code(await c.alice.mutation(api.proposals.clearSelection, { roomId: c.roomId }))).toBe("invalid_revision");
    expect(code(await c.alice.mutation(api.payments.state.cancelPayments, { revisionId: c.revisionId }))).toBe("invalid_revision");
    expect(unwrap(await c.bob.query(api.payments.state.getPaymentStatus, { roomId: c.roomId })).frozen).toBe(true);

    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: first.attemptId, status: "captured" }));
    expect(await revisionStatus(c)).toBe("capturing");
    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: bobAttempt, status: "captured" }));
    expect(await revisionStatus(c)).toBe("test_funded");
    const done = unwrap(await c.alice.query(api.payments.state.getPaymentStatus, { roomId: c.roomId }));
    expect(done).toMatchObject({ groupStatus: "test_funded", capturedCount: 2, frozen: true, merchantOrder: { status: "not_implemented" } });
  });

  it("refuses capture until every payer is authorized", async () => {
    const c = await setup();
    await approveAll(c);
    await authorize(c, "alice");
    expect(code(await c.alice.mutation(api.payments.state.beginCapture, { revisionId: c.revisionId }))).toBe("infeasible");
  });

  it("blocks on a failed authorization and resumes after a retry", async () => {
    const c = await setup();
    await approveAll(c);
    await authorize(c, "alice");
    const bobFirst = unwrap(await c.bob.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "b1" }));
    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: bobFirst.attemptId, status: "authorization_failed", lastError: "Card declined (test)." }));
    expect(await revisionStatus(c)).toBe("blocked");
    expect(unwrap(await c.bob.query(api.payments.state.getPaymentStatus, { roomId: c.roomId })).myAttempt?.lastError).toBe("Card declined (test).");
    await authorize(c, "bob", "b2");
    expect(await revisionStatus(c)).toBe("ready_to_capture");
  });
});

describe("recovery and unwinding", () => {
  it("stops a partial capture, cancels uncaptured, refunds captured, then mints a new revision", async () => {
    const c = await setup();
    await approveAll(c);
    const a = await authorize(c, "alice");
    const b = await authorize(c, "bob");
    unwrap(await c.alice.mutation(api.payments.state.beginCapture, { revisionId: c.revisionId }));
    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: a, status: "captured" }));
    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: b, status: "authorized", lastError: "Capture failed (test)." }));

    expect(await revisionStatus(c)).toBe("recovery_pending");
    expect(await attemptStatus(c, a)).toBe("refund_pending");
    expect(await attemptStatus(c, b)).toBe("cancellation_pending");
    const work = await c.t.query(internal.payments.state.listPendingProviderWork, { revisionId: c.revisionId });
    expect(work.map((w) => w.status).sort()).toEqual(["cancellation_pending", "refund_pending"]);
    // Still frozen during recovery.
    expect(code(await c.bob.mutation(api.proposals.setContributionLimit, { roomId: c.roomId, amountMinor: 9000 }))).toBe("invalid_revision");

    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: b, status: "canceled" }));
    expect(await revisionStatus(c)).toBe("recovery_pending");
    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: a, status: "refunded" }));
    expect(await revisionStatus(c)).toBe("canceled");

    const room = (await c.t.run((ctx) => ctx.db.get(c.roomId)))!;
    expect(room.currentRevisionId).not.toBe(c.revisionId);
    expect(await revisionStatus(c, room.currentRevisionId!)).toBe("awaiting_approval");
    const oldApprovals = await c.t.run((ctx) =>
      ctx.db.query("approvals").withIndex("by_revision", (q) => q.eq("revisionId", c.revisionId)).collect(),
    );
    expect(oldApprovals.every((x) => x.status === "invalidated")).toBe(true);
  });

  it("supersedes a pre-capture revision on a material edit and unwinds its authorizations", async () => {
    const c = await setup();
    await approveAll(c);
    const a = await authorize(c, "alice");
    unwrap(await c.bob.mutation(api.proposals.setContributionLimit, { roomId: c.roomId, amountMinor: 4000 }));
    expect(await revisionStatus(c)).toBe("superseded");
    expect(await attemptStatus(c, a)).toBe("cancellation_pending");
    expect(code(await c.bob.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "late" }))).toBe("invalid_revision");

    // A late provider event on the dead revision is recorded, then unwound.
    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: a, status: "authorized" }));
    expect(await attemptStatus(c, a)).toBe("cancellation_pending");
  });

  it("lets the organizer cancel before capture and starts a fresh revision", async () => {
    const c = await setup();
    await approveAll(c);
    const a = await authorize(c, "alice");
    expect(code(await c.bob.mutation(api.payments.state.cancelPayments, { revisionId: c.revisionId }))).toBe("unauthorized");
    const out = unwrap(await c.alice.mutation(api.payments.state.cancelPayments, { revisionId: c.revisionId }));
    expect(await revisionStatus(c)).toBe("canceled");
    expect(await attemptStatus(c, a)).toBe("cancellation_pending");
    expect(out.currentRevisionId).not.toBe(c.revisionId);
    expect(await revisionStatus(c, out.currentRevisionId!)).toBe("awaiting_approval");
  });

  it("lets a contributor withdraw only their own authorization", async () => {
    const c = await setup();
    await approveAll(c);
    const a = await authorize(c, "alice");
    expect(code(await c.bob.mutation(api.payments.state.cancelMyAuthorization, { attemptId: a }))).toBe("unauthorized");
    expect(unwrap(await c.alice.mutation(api.payments.state.cancelMyAuthorization, { attemptId: a })).status).toBe("cancellation_pending");
    expect(await revisionStatus(c)).toBe("authorizing");
  });
});

describe("provider events", () => {
  it("dedupes webhooks and refuses illegal transitions", async () => {
    const c = await setup();
    await approveAll(c);
    expect(unwrap(await c.t.mutation(internal.payments.state.recordProviderEvent, { providerEventId: "evt_1", type: "payment_intent.amount_capturable_updated" }))).toEqual({ duplicate: false });
    expect(unwrap(await c.t.mutation(internal.payments.state.recordProviderEvent, { providerEventId: "evt_1", type: "payment_intent.amount_capturable_updated" }))).toEqual({ duplicate: true });

    const intent = unwrap(await c.alice.mutation(api.payments.state.beginAuthorization, { revisionId: c.revisionId, idempotencyKey: "a1" }));
    expect(code(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: intent.attemptId, status: "captured" }))).toBe("validation_failed");
    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: intent.attemptId, status: "authorized" }));
    unwrap(await c.t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: intent.attemptId, status: "authorized" }));

    unwrap(await c.t.mutation(internal.payments.state.attachProviderObject, { attemptId: intent.attemptId, providerObjectId: "pi_x" }));
    expect(code(await c.t.mutation(internal.payments.state.attachProviderObject, { attemptId: intent.attemptId, providerObjectId: "pi_y" }))).toBe("validation_failed");
    expect((await c.t.query(internal.payments.state.findAttemptByProviderObject, { providerObjectId: "pi_x" }))?._id).toBe(intent.attemptId);
  });
});
