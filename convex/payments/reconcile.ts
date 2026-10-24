/** Provider observations only. Dev 2 owns durable event fencing and application-state writes. */
import { z } from "zod";
import type { StripeAdapterResult, StripePaymentExpectation, StripePaymentObservation, StripeTestIntent, StripeTestRefund } from "../../lib/contracts";

const amount = z.number().int().nonnegative().max(99_999_999);
const binding = z.object({ roomId: z.string().min(1), revisionId: z.string().min(1), participantId: z.string().min(1), attemptId: z.string().min(1) });
const expectedSchema = z.object({ binding, amountMinor: amount.min(50), mode: z.enum(["authorize", "collect"]), paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/).optional() });
const intentSchema = z.object({ id: z.string().regex(/^pi_[A-Za-z0-9]+$/), binding,
  amountMinor: amount, amountCapturableMinor: amount, amountReceivedMinor: amount,
  currency: z.literal("USD"), captureMethod: z.enum(["automatic", "automatic_async", "manual"]),
  status: z.enum(["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture", "canceled", "succeeded"]),
});
const refundSchema = z.object({ id: z.string().regex(/^re_[A-Za-z0-9]+$/), paymentIntentId: z.string(), amountMinor: amount.min(1), status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]) });
const invalid = (): StripeAdapterResult<never> => ({ kind: "failed", message: "Payment observation does not match the stored test attempt." });

export function observeStripePayment(input: {
  expected: StripePaymentExpectation;
  intent: StripeTestIntent;
  refunds?: StripeTestRefund[];
}): StripeAdapterResult<StripePaymentObservation> {
  const expected = expectedSchema.safeParse(input.expected);
  const parsed = intentSchema.safeParse(input.intent);
  const refunds = z.array(refundSchema).max(100).safeParse(input.refunds ?? []);
  if (!expected.success || !parsed.success || !refunds.success) return invalid();
  const e = expected.data, p = parsed.data;
  if ((e.paymentIntentId && e.paymentIntentId !== p.id) || p.amountMinor !== e.amountMinor
    || Object.keys(e.binding).some(field => p.binding[field as keyof typeof e.binding] !== e.binding[field as keyof typeof e.binding])
    || (e.mode === "authorize" && p.captureMethod !== "manual")
    || (e.mode === "collect" && p.captureMethod === "manual")
    || p.amountReceivedMinor > p.amountMinor || p.amountCapturableMinor > p.amountMinor
    || p.amountReceivedMinor + p.amountCapturableMinor > p.amountMinor
    || (["succeeded", "canceled"].includes(p.status) && p.amountCapturableMinor !== 0)) return invalid();
  const unique = new Map<string, StripeTestRefund>();
  for (const refund of refunds.data) {
    if (refund.paymentIntentId !== p.id) return invalid();
    const previous = unique.get(refund.id);
    // Duplicate delivery cannot double-count, and contradictory copies require a new provider fetch.
    if (previous && (previous.amountMinor !== refund.amountMinor || previous.status !== refund.status)) return invalid();
    unique.set(refund.id, refund);
  }
  const known = [...unique.values()];
  const refundedMinor = known.filter(r => r.status === "succeeded").reduce((sum, r) => sum + r.amountMinor, 0);
  if (refundedMinor > p.amountReceivedMinor || known.some(r => r.amountMinor > p.amountReceivedMinor)) return invalid();
  const observed = (status: StripePaymentObservation["status"], reason: string): StripeAdapterResult<StripePaymentObservation> => ({ kind: "ok", value: {
    status, reason, paymentIntentId: p.id, capturedMinor: p.amountReceivedMinor, refundedMinor,
  } });
  if (refundedMinor > 0 && refundedMinor === p.amountReceivedMinor) return observed("refunded", "All observed captured funds were refunded.");
  if (known.some(r => ["requires_action", "failed", "canceled"].includes(r.status))) return observed("action_required", "Refund recovery needs attention.");
  if (known.some(r => r.status === "pending")) return observed("refund_pending", "The provider has not completed the refund.");
  if (refundedMinor > 0) return observed("action_required", "Only part of the captured funds was refunded.");
  if (p.status === "succeeded") return p.amountReceivedMinor === e.amountMinor
    ? observed("captured", "The provider reports the full frozen amount captured.")
    : observed("action_required", "The provider reports only a partial capture.");
  if (p.amountReceivedMinor > 0) return observed("action_required", "Captured funds require reconciliation before another operation.");
  if (p.status === "requires_capture") return p.captureMethod === "manual" && p.amountCapturableMinor === e.amountMinor
    ? observed("authorized", "The full frozen amount is authorized, not captured.")
    : observed("action_required", "The observed authorization does not cover the frozen amount.");
  if (p.status === "canceled") return observed("canceled", "The provider reports no captured funds and a canceled intent.");
  if (p.status === "requires_action") return observed("action_required", "The payment requires customer action.");
  if (p.status === "processing") return observed("uncertain", "The provider is still processing the payment.");
  return observed("authorization_pending", "The customer has not completed authorization.");
}
