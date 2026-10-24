import { describe, expect, it } from "vitest";
import { observeStripePayment } from "./reconcile";
import type { StripePaymentExpectation, StripeTestIntent, StripeTestRefund } from "../../lib/contracts";
const binding = { roomId: "room", revisionId: "rev", participantId: "alex", attemptId: "attempt" };
const expected: StripePaymentExpectation = { binding, mode: "authorize", amountMinor: 2500, paymentIntentId: "pi_123" };
const authorized: StripeTestIntent = { id: "pi_123", binding, amountMinor: 2500, amountCapturableMinor: 2500, amountReceivedMinor: 0, currency: "USD", captureMethod: "manual", status: "requires_capture" };
const captured: StripeTestIntent = { ...authorized, status: "succeeded", amountCapturableMinor: 0, amountReceivedMinor: 2500 };
const refund: StripeTestRefund = { id: "re_123", paymentIntentId: "pi_123", amountMinor: 2500, status: "succeeded" };
const observe = (intent = authorized, refunds: StripeTestRefund[] = []) => observeStripePayment({ expected, intent, refunds });

describe("Stripe reconciliation observations", () => {
  it("distinguishes a full authorization from a completed capture", () => {
    expect(observe()).toMatchObject({ kind: "ok", value: { status: "authorized", capturedMinor: 0 } });
    expect(observe(captured)).toMatchObject({ kind: "ok", value: { status: "captured", capturedMinor: 2500 } });
  });
  it.each(["roomId", "revisionId", "participantId", "attemptId"] as const)("refuses mismatched %s bindings", field => {
    expect(observe({ ...authorized, binding: { ...binding, [field]: "other" } }).kind).toBe("failed");
  });
  it("refuses mismatched intent IDs, amounts, capture modes and impossible balances", () => {
    for (const changed of [
      { ...authorized, id: "pi_other" }, { ...authorized, amountMinor: 2501 },
      { ...authorized, captureMethod: "automatic" as const },
      { ...authorized, amountReceivedMinor: 1 }, { ...authorized, amountCapturableMinor: -1 },
      { ...authorized, status: "canceled" as const },
    ]) expect(observe(changed).kind).toBe("failed");
  });
  it("keeps an incomplete authorization pending and processing uncertain", () => {
    expect(observe({ ...authorized, status: "requires_payment_method", amountCapturableMinor: 0 })).toMatchObject({ kind: "ok", value: { status: "authorization_pending" } });
    expect(observe({ ...authorized, status: "processing", amountCapturableMinor: 0 })).toMatchObject({ kind: "ok", value: { status: "uncertain" } });
  });
  it("requires attention for partial captures and insufficient holds", () => {
    expect(observe({ ...captured, amountReceivedMinor: 1000 })).toMatchObject({ kind: "ok", value: { status: "action_required", capturedMinor: 1000 } });
    expect(observe({ ...authorized, amountCapturableMinor: 1000 })).toMatchObject({ kind: "ok", value: { status: "action_required" } });
  });
  it("reports cancellation only from a provider-canceled intent with no captured funds", () => {
    expect(observe({ ...authorized, status: "canceled", amountCapturableMinor: 0 })).toMatchObject({ kind: "ok", value: { status: "canceled" } });
    expect(observe({ ...captured, status: "canceled" })).toMatchObject({ kind: "ok", value: { status: "action_required" } });
  });
  it("deduplicates refund delivery and distinguishes partial/pending/full recovery", () => {
    expect(observe(captured, [refund, refund])).toMatchObject({ kind: "ok", value: { status: "refunded", refundedMinor: 2500 } });
    expect(observe(captured, [{ ...refund, amountMinor: 1000 }])).toMatchObject({ kind: "ok", value: { status: "action_required", refundedMinor: 1000 } });
    expect(observe(captured, [{ ...refund, status: "pending" }])).toMatchObject({ kind: "ok", value: { status: "refund_pending", refundedMinor: 0 } });
    expect(observe(captured, [{ ...refund, status: "failed" }])).toMatchObject({ kind: "ok", value: { status: "action_required", refundedMinor: 0 } });
  });
  it("refuses conflicting, foreign or impossible refunds instead of inventing refunded funds", () => {
    for (const refunds of [[refund, { ...refund, status: "pending" as const }], [{ ...refund, paymentIntentId: "pi_other" }], [{ ...refund, amountMinor: 2600 }]])
      expect(observe(captured, refunds).kind).toBe("failed");
  });
  it("supports several partial refunds only when their observed sum covers the actual capture", () => {
    expect(observe(captured, [{ ...refund, amountMinor: 1000 }, { ...refund, id: "re_456", amountMinor: 1500 }])).toMatchObject({ kind: "ok", value: { status: "refunded", refundedMinor: 2500 } });
  });
  it("does not grant organizer collection a manual authorization status", () => {
    expect(observeStripePayment({ expected: { ...expected, mode: "collect" }, intent: authorized }).kind).toBe("failed");
    expect(observeStripePayment({ expected: { ...expected, mode: "collect" }, intent: { ...captured, captureMethod: "automatic" } })).toMatchObject({ kind: "ok", value: { status: "captured" } });
  });
});
