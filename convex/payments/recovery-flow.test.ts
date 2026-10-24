import { describe, expect, it, vi } from "vitest";
import { createStripeTestAdapter } from "./stripe";
import { readStripePayment } from "./read";

const binding = { roomId: "room", revisionId: "revision", participantId: "alex", attemptId: "attempt" };
const captured = {
  id: "pi_123", object: "payment_intent", livemode: false, metadata: binding,
  status: "succeeded", amount: 2500, amount_received: 2500, amount_capturable: 0,
  currency: "usd", capture_method: "manual",
};
const refund = {
  id: "re_lost", object: "refund", payment_intent: captured.id,
  amount: 2500, currency: "usd", status: "pending",
};
const input = { expected: { binding, amountMinor: 2500, mode: "authorize" as const }, paymentIntentId: captured.id };

describe("Stripe transport and reconciliation recovery", () => {
  it("recovers a lost refund response through GETs, then observes completion on a repeated event", async () => {
    let providerRefund: typeof refund | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).endsWith("payment_intents/pi_123")) return Response.json(captured);
      if (String(url).endsWith("/refunds") && options?.method === "POST") {
        providerRefund = refund; // The provider committed before the connection dropped.
        throw new Error("synthetic lost response with private provider detail");
      }
      if (String(url).endsWith("/refunds?payment_intent=pi_123&limit=100"))
        return Response.json({ object: "list", has_more: false, data: providerRefund ? [providerRefund] : [] });
      throw new Error("Unexpected provider path");
    });
    const adapter = createStripeTestAdapter({ secretKey: "sk_test_fixture", frontendOrigin: "http://localhost:3000" }, fetcher);
    expect(await adapter.refundIntent(captured.id, 2500, "attempt:refund:1")).toMatchObject({ kind: "uncertain" });
    expect(await readStripePayment(input, adapter)).toMatchObject({ kind: "ok", value: { status: "refund_pending", capturedMinor: 2500, refundedMinor: 0 } });
    providerRefund = { ...refund, status: "succeeded" };
    expect(await readStripePayment(input, adapter)).toMatchObject({ kind: "ok", value: { status: "refunded", capturedMinor: 2500, refundedMinor: 2500 } });
    const writes = fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(writes).toHaveLength(1); // Neither reconciliation nor repeated delivery retries the write.
    expect(writes[0]?.[1]?.headers).toMatchObject({ "Idempotency-Key": "attempt:refund:1" });
  });

  it("does not report a clean capture when the refund page cannot be completed", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).includes("/refunds?")
      ? Response.json({ object: "list", has_more: true, data: [] }) : Response.json(captured));
    const adapter = createStripeTestAdapter({ secretKey: "sk_test_fixture", frontendOrigin: "http://localhost:3000" }, fetcher);
    expect((await readStripePayment(input, adapter)).kind).toBe("uncertain");
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
});
