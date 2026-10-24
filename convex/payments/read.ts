/** Read-only provider reconciliation. Persist/deduplicate under Dev 2's database transaction. */
import type { StripeAdapterResult, StripePaymentObservation, StripePaymentReadInput } from "../../lib/contracts";
import type { createStripeTestAdapter } from "./stripe";
import { observeStripePayment } from "./reconcile";

type StripeReader = Pick<ReturnType<typeof createStripeTestAdapter>, "retrieveCheckout" | "retrieveIntent" | "listIntentRefunds">;
const invalid = (): StripeAdapterResult<never> => ({ kind: "failed", message: "Provider references do not match the stored payment attempt." });
const unresolved = (): StripeAdapterResult<never> => ({ kind: "uncertain", message: "Payment state is unresolved; no additional payment operation was started." });

async function readPayment(input: StripePaymentReadInput, reader: StripeReader): Promise<StripeAdapterResult<StripePaymentObservation>> {
  const { expected, checkoutSessionId } = input;
  let intentId = input.paymentIntentId ?? expected.paymentIntentId;
  const refundIds = [...new Set(input.refundIds ?? [])];
  if ((!checkoutSessionId && !intentId) || (checkoutSessionId && !/^cs_test_[A-Za-z0-9]+$/.test(checkoutSessionId))
    || (intentId && !/^pi_[A-Za-z0-9]+$/.test(intentId)) || refundIds.length > 10
    || refundIds.some(id => !/^re_[A-Za-z0-9]+$/.test(id))
    || (input.paymentIntentId && expected.paymentIntentId && input.paymentIntentId !== expected.paymentIntentId)) return invalid();
  if (checkoutSessionId) {
    const session = await reader.retrieveCheckout(checkoutSessionId);
    if (session.kind !== "ok") return session;
    const s = session.value;
    if (s.id !== checkoutSessionId || s.currency !== "USD" || s.amountMinor !== expected.amountMinor
      || (["roomId", "revisionId", "participantId", "attemptId"] as const).some(field => s.binding[field] !== expected.binding[field])
      || (intentId && s.paymentIntentId && intentId !== s.paymentIntentId)) return invalid();
    intentId ??= s.paymentIntentId;
    if (!intentId) {
      if (refundIds.length || !["open", "expired"].includes(s.status) || s.paymentStatus !== "unpaid") return unresolved();
      return { kind: "ok", value: {
        status: s.status === "expired" ? "canceled" : "authorization_pending",
        checkoutSessionId, capturedMinor: 0, refundedMinor: 0,
        reason: s.status === "expired" ? "The unpaid Checkout expired before any observed authorization." : "The customer has not completed Checkout.",
      } };
    }
  }
  if (!intentId) return unresolved();
  const intent = await reader.retrieveIntent(intentId);
  if (intent.kind !== "ok") return intent;
  if (intent.value.id !== intentId) return invalid();
  const base = observeStripePayment({ expected: { ...expected, paymentIntentId: intentId }, intent: intent.value });
  if (base.kind !== "ok") return base;
  // Do not assume a missing locally stored refund ID means no refund happened:
  // its POST response may have been lost, or it may have been issued in Stripe.
  const refunds = intent.value.amountReceivedMinor > 0 || refundIds.length
    ? await reader.listIntentRefunds(intentId)
    : { kind: "ok" as const, value: [] };
  if (refunds.kind !== "ok") return refunds;
  if (refundIds.some(id => !refunds.value.some(refund => refund.id === id))) return unresolved();
  const observation = observeStripePayment({ expected: { ...expected, paymentIntentId: intentId }, intent: intent.value,
    refunds: refunds.value,
  });
  return observation.kind === "ok" && checkoutSessionId
    ? { kind: "ok", value: { ...observation.value, checkoutSessionId } }
    : observation;
}

/** Never expose a raw transport failure through an internal webhook caller. */
export async function readStripePayment(input: StripePaymentReadInput, reader: StripeReader): Promise<StripeAdapterResult<StripePaymentObservation>> {
  try { return await readPayment(input, reader); }
  catch { return unresolved(); }
}
