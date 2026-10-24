/** Executes an already-authorized durable organizer claim. No schema/policy decisions. */
import type { OrganizerCheckoutStore, StripeAdapterResult, StripeTestSession } from "../../lib/contracts";
import type { createStripeTestAdapter } from "./stripe";

type CheckoutAdapter = Pick<ReturnType<typeof createStripeTestAdapter>, "createCheckout" | "retrieveCheckout">;
const uncertain = (): StripeAdapterResult<never> => ({ kind: "uncertain", message: "Checkout is unresolved. Reconcile the saved attempt before starting another." });

export async function runOrganizerCheckout(store: OrganizerCheckoutStore, adapter: CheckoutAdapter): Promise<StripeAdapterResult<StripeTestSession>> {
  try {
    const claimed = await store.claim(); // Authorization + intent + operation key persisted atomically by Dev 2.
    if (claimed.kind !== "ok") return claimed;
    if (!claimed.value) return uncertain(); // Someone else owns the pending operation.
    const { claimId, input, checkoutSessionId } = claimed.value;
    if (!claimId || input.mode !== "collect") return { kind: "failed", message: "Organizer Checkout requires an authorized collection claim." };
    let result: StripeAdapterResult<StripeTestSession>;
    try { result = checkoutSessionId ? await adapter.retrieveCheckout(checkoutSessionId) : await adapter.createCheckout(input); }
    catch { result = uncertain(); }
    if (result.kind === "ok") {
      const s = result.value;
      if (s.amountMinor !== input.amountMinor || s.currency !== "USD"
        || (checkoutSessionId && s.id !== checkoutSessionId)
        || (["roomId", "revisionId", "participantId", "attemptId"] as const).some(field => s.binding[field] !== input[field]))
        result = uncertain();
    }
    // Persistence must succeed before returning even an open session's bearer URL.
    if (!await store.settle(claimId, result)) return uncertain();
    if (result.kind === "ok" && (result.value.status !== "open" || !result.value.checkoutUrl || result.value.paymentStatus !== "unpaid"))
      return { kind: "failed", message: "This Checkout is already completed or expired. Reconcile the saved attempt; no replacement was created." };
    return result;
  } catch { return uncertain(); }
}
