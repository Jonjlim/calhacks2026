import { describe, expect, it, vi } from "vitest";
import { readStripePayment } from "./read";
import type { StripePaymentReadInput, StripeTestIntent, StripeTestSession } from "../../lib/contracts";
const binding = { roomId: "room", revisionId: "rev", participantId: "alex", attemptId: "attempt" };
const input: StripePaymentReadInput = { expected: { binding, amountMinor: 2500, mode: "authorize" }, checkoutSessionId: "cs_test_123" };
const session: StripeTestSession = { id: "cs_test_123", binding, amountMinor: 2500, currency: "USD", status: "open", paymentStatus: "unpaid" };
const intent: StripeTestIntent = { id: "pi_123", binding, amountMinor: 2500, currency: "USD", captureMethod: "manual", status: "requires_capture", amountReceivedMinor: 0, amountCapturableMinor: 2500 };
function setup(s = session) {
  return { retrieveCheckout: vi.fn().mockResolvedValue({ kind: "ok", value: s }), retrieveIntent: vi.fn().mockResolvedValue({ kind: "ok", value: intent }), listIntentRefunds: vi.fn().mockResolvedValue({ kind: "ok", value: [] }) };
}

describe("read-only Stripe reconciliation", () => {
  it("keeps an open session pending without inventing an intent or charge", async () => {
    const reader = setup();
    expect(await readStripePayment(input, reader)).toMatchObject({ kind: "ok", value: { status: "authorization_pending", checkoutSessionId: session.id, capturedMinor: 0 } });
    expect(reader.retrieveIntent).not.toHaveBeenCalled();
    expect(reader.listIntentRefunds).not.toHaveBeenCalled();
  });
  it("observes expired unpaid Checkout as canceled only when no intent is known", async () => {
    expect(await readStripePayment(input, setup({ ...session, status: "expired" }))).toMatchObject({ kind: "ok", value: { status: "canceled" } });
    const reader = setup({ ...session, status: "expired" });
    expect(await readStripePayment({ ...input, paymentIntentId: intent.id }, reader)).toMatchObject({ kind: "ok", value: { status: "authorized" } });
    expect(reader.retrieveIntent).toHaveBeenCalledWith(intent.id);
  });
  it("does not treat Checkout completion or redirects as captured funds", async () => {
    expect((await readStripePayment(input, setup({ ...session, status: "complete", paymentStatus: "paid" }))).kind).toBe("uncertain");
    expect(await readStripePayment(input, setup({ ...session, status: "complete", paymentIntentId: intent.id }))).toMatchObject({ kind: "ok", value: { status: "authorized", capturedMinor: 0 } });
  });
  it("freshly retrieves intent state on repeated notifications, rather than replaying an old status", async () => {
    const reader = setup({ ...session, paymentIntentId: intent.id });
    expect(await readStripePayment(input, reader)).toMatchObject({ kind: "ok", value: { status: "authorized" } });
    reader.retrieveIntent.mockResolvedValueOnce({ kind: "ok", value: { ...intent, status: "succeeded", amountReceivedMinor: 2500, amountCapturableMinor: 0 } });
    expect(await readStripePayment(input, reader)).toMatchObject({ kind: "ok", value: { status: "captured", capturedMinor: 2500 } });
    expect(reader.retrieveIntent).toHaveBeenCalledTimes(2);
  });
  it("refuses a foreign revision or conflicting intent without making further calls", async () => {
    for (const s of [{ ...session, binding: { ...binding, revisionId: "other" } }, { ...session, paymentIntentId: "pi_other" }]) {
      const reader = setup(s);
      expect((await readStripePayment({ ...input, paymentIntentId: intent.id }, reader)).kind).toBe("failed");
      expect(reader.retrieveIntent).not.toHaveBeenCalled();
    }
  });
  it("reconciles tracked refunds once each from current provider state", async () => {
    const reader = setup({ ...session, paymentIntentId: intent.id });
    reader.retrieveIntent.mockResolvedValueOnce({ kind: "ok", value: { ...intent, status: "succeeded", amountReceivedMinor: 2500, amountCapturableMinor: 0 } });
    reader.listIntentRefunds.mockResolvedValueOnce({ kind: "ok", value: [{ id: "re_123", paymentIntentId: intent.id, amountMinor: 2500, status: "succeeded" }] });
    expect(await readStripePayment({ ...input, refundIds: ["re_123", "re_123"] }, reader)).toMatchObject({ kind: "ok", value: { status: "refunded", refundedMinor: 2500 } });
    expect(reader.listIntentRefunds).toHaveBeenCalledExactlyOnceWith(intent.id);
  });
  it("discovers a refund whose write response and ID were lost", async () => {
    const reader = setup({ ...session, paymentIntentId: intent.id });
    reader.retrieveIntent.mockResolvedValueOnce({ kind: "ok", value: { ...intent, status: "succeeded", amountReceivedMinor: 2500, amountCapturableMinor: 0 } });
    reader.listIntentRefunds.mockResolvedValueOnce({ kind: "ok", value: [{ id: "re_untracked", paymentIntentId: intent.id, amountMinor: 2500, status: "succeeded" }] });
    expect(await readStripePayment(input, reader)).toMatchObject({ kind: "ok", value: { status: "refunded", refundedMinor: 2500 } });
    expect(reader.listIntentRefunds).toHaveBeenCalledExactlyOnceWith(intent.id);
  });
  it.each(["pending", "failed"])("discovers an untracked %s refund without reporting a clean capture", async status => {
    const reader = setup({ ...session, paymentIntentId: intent.id });
    reader.retrieveIntent.mockResolvedValueOnce({ kind: "ok", value: { ...intent, status: "succeeded", amountReceivedMinor: 2500, amountCapturableMinor: 0 } });
    reader.listIntentRefunds.mockResolvedValueOnce({ kind: "ok", value: [{ id: "re_untracked", paymentIntentId: intent.id, amountMinor: 2500, status }] });
    expect(await readStripePayment(input, reader)).toMatchObject({ kind: "ok", value: { status: status === "pending" ? "refund_pending" : "action_required", refundedMinor: 0 } });
  });
  it("leaves a missing tracked refund or incomplete provider list uncertain", async () => {
    const reader = setup({ ...session, paymentIntentId: intent.id });
    reader.retrieveIntent.mockResolvedValue({ kind: "ok", value: { ...intent, status: "succeeded", amountReceivedMinor: 2500, amountCapturableMinor: 0 } });
    expect((await readStripePayment({ ...input, refundIds: ["re_missing"] }, reader)).kind).toBe("uncertain");
    reader.listIntentRefunds.mockResolvedValueOnce({ kind: "uncertain", message: "Incomplete provider page" });
    expect((await readStripePayment(input, reader)).kind).toBe("uncertain");
  });
  it("does not scan refunds for an uncaptured authorization", async () => {
    const reader = setup({ ...session, paymentIntentId: intent.id });
    expect(await readStripePayment(input, reader)).toMatchObject({ kind: "ok", value: { status: "authorized" } });
    expect(reader.listIntentRefunds).not.toHaveBeenCalled();
  });
  it("leaves interrupted reads uncertain and never invokes a write", async () => {
    const reader = setup();
    reader.retrieveCheckout.mockResolvedValueOnce({ kind: "uncertain", message: "Synthetic provider timeout" });
    expect((await readStripePayment(input, reader)).kind).toBe("uncertain");
    expect(reader.retrieveIntent).not.toHaveBeenCalled();
  });
  it("turns unexpected reader rejection into a sanitized unresolved result", async () => {
    const reader = setup();
    reader.retrieveCheckout.mockRejectedValueOnce(new Error("private provider detail"));
    const result = await readStripePayment(input, reader);
    expect(result.kind).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("private provider detail");
  });

  it("rejects unbounded recovery, path injection and missing references before networking", async () => {
    const reader = setup();
    for (const bad of [{ ...input, checkoutSessionId: "cs_test_123/expire" }, { ...input, refundIds: Array.from({ length: 11 }, (_, i) => `re_${i}`) }, { expected: input.expected }])
      expect((await readStripePayment(bad, reader)).kind).toBe("failed");
    expect(reader.retrieveCheckout).not.toHaveBeenCalled();
  });
});
