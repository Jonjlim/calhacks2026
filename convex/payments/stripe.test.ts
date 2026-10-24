import { describe, expect, it, vi } from "vitest";
import { createStripeTestAdapter, STRIPE_API_VERSION } from "./stripe";
import type { StripeCheckoutInput } from "../../lib/contracts";

const input: StripeCheckoutInput = { roomId: "room1", revisionId: "revision1", participantId: "alex", attemptId: "attempt1", amountMinor: 2500, currency: "USD", mode: "authorize", idempotencyKey: "attempt1:create" };
const metadata = { roomId: input.roomId, revisionId: input.revisionId, participantId: input.participantId, attemptId: input.attemptId };
const session = { metadata, id: "cs_test_123", object: "checkout.session", livemode: false, url: "https://checkout.stripe.com/c/pay/cs_test_123", status: "open", payment_status: "unpaid", payment_intent: null, amount_total: 2500, currency: "usd", customer_email: "must-not-leak@example.com", client_secret: "must-not-leak" };
const intent = { metadata, id: "pi_123", object: "payment_intent", livemode: false, status: "requires_capture", capture_method: "manual", amount: 2500, amount_capturable: 2500, amount_received: 0, currency: "usd", client_secret: "must-not-leak" };
function setup(raw: unknown = session, secretKey = "sk_test_synthetic") {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw));
  return { fetcher, adapter: createStripeTestAdapter({ secretKey, frontendOrigin: "http://localhost:3000" }, fetcher) };
}

describe("Stripe sandbox transport", () => {
  it("creates hosted card Checkout with exact cents, manual capture, revision metadata and stable idempotency", async () => {
    const { adapter, fetcher } = setup();
    const result = await adapter.createCheckout(input);
    expect(result).toMatchObject({ kind: "ok", value: { id: session.id, amountMinor: 2500, paymentStatus: "unpaid" } });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(options?.headers).toMatchObject({ "Stripe-Version": STRIPE_API_VERSION, "Idempotency-Key": input.idempotencyKey });
    const body = new URLSearchParams(String(options?.body));
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2500");
    expect(body.get("payment_intent_data[capture_method]")).toBe("manual");
    expect(body.get("metadata[revisionId]")).toBe(input.revisionId);
    expect(body.get("payment_intent_data[metadata][attemptId]")).toBe(input.attemptId);
    expect(body.get("success_url")).toBe("http://localhost:3000/room/room1?checkout=returned");
    expect(body.get("payment_method_types[0]")).toBe("card");
    expect(body.get("customer_email")).toBeNull();
  });

  it("supports organizer collection without changing the authorized amount", async () => {
    const { adapter, fetcher } = setup();
    await adapter.createCheckout({ ...input, mode: "collect" });
    expect(new URLSearchParams(String(fetcher.mock.calls[0]?.[1]?.body)).get("payment_intent_data[capture_method]")).toBe("automatic");
  });

  it.each(["sk_live_secret", "rk_live_secret", "pk_test_public", "", "sk_test_bad\nheader"])("refuses non-test-secret configuration %s before networking", async key => {
    const { adapter, fetcher } = setup(session, key);
    expect((await adapter.createCheckout(input)).kind).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([0, 49, -1, 1.5, NaN, Infinity, 100_000_000])("rejects invalid/unsupported checkout cents %s without rounding", async amountMinor => {
    const { adapter, fetcher } = setup();
    expect((await adapter.createCheckout({ ...input, amountMinor })).kind).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["https://evil.test/path", "http://evil.test", "https://token@example.com", "not-a-url"])("rejects invalid frontend origins %s", async frontendOrigin => {
    const { fetcher } = setup();
    const adapter = createStripeTestAdapter({ secretKey: "sk_test_synthetic", frontendOrigin }, fetcher);
    expect((await adapter.createCheckout(input)).kind).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ...session, livemode: true }, { ...session, amount_total: 2501 },
    { ...session, currency: "eur" }, { ...session, url: "https://checkout.stripe.com.evil.test/pay" },
    { ...session, id: "cs_live_123" }, { ...session, status: "complete" },
    { ...session, metadata: { ...metadata, revisionId: "wrong-revision" } },
    { ...session, metadata: undefined },
  ])("does not accept mismatched, live or unsupported provider objects", async raw => {
    const { adapter } = setup(raw);
    expect((await adapter.createCheckout(input)).kind).toBe("uncertain");
  });

  it("does not retry a lost POST or expose the key/private provider error", async () => {
    const { adapter, fetcher } = setup();
    fetcher.mockRejectedValue(new Error("private provider key sk_test_synthetic"));
    const result = await adapter.createCheckout(input);
    expect(result.kind).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("sk_test");
  });

  it.each([[400, "failed"], [401, "failed"], [409, "uncertain"], [429, "uncertain"], [500, "uncertain"]])("classifies HTTP %s without passing raw provider bodies through", async (status, kind) => {
    const { adapter, fetcher } = setup();
    fetcher.mockResolvedValue(new Response("private error body", { status: Number(status) }));
    const result = await adapter.createCheckout(input);
    expect(result.kind).toBe(kind);
    expect(JSON.stringify(result)).not.toContain("private error body");
  });

  it("retrieves provider state and captures only through an explicitly keyed write", async () => {
    const { adapter, fetcher } = setup(intent);
    expect(await adapter.retrieveIntent("pi_123")).toMatchObject({ kind: "ok", value: { status: "requires_capture", amountCapturableMinor: 2500 } });
    fetcher.mockResolvedValueOnce(Response.json({ ...intent, status: "succeeded", amount_capturable: 0, amount_received: 2500 }));
    expect(await adapter.captureIntent("pi_123", "attempt1:capture")).toMatchObject({ kind: "ok", value: { status: "succeeded", amountReceivedMinor: 2500 } });
    expect(fetcher.mock.calls[1]?.[0]).toBe("https://api.stripe.com/v1/payment_intents/pi_123/capture");
    expect(JSON.stringify(await adapter.captureIntent("pi_123", ""))).toContain("failed");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("expires an open Checkout without claiming a refund or cancellation of captured money", async () => {
    const { adapter, fetcher } = setup({ ...session, status: "expired", url: null });
    expect(await adapter.expireCheckout(session.id, "attempt1:expire")).toMatchObject({ kind: "ok", value: { status: "expired", paymentStatus: "unpaid" } });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://api.stripe.com/v1/checkout/sessions/${session.id}/expire`);
  });

  it("retrieves a succeeded test intent before refunding and preserves a pending refund", async () => {
    const { adapter, fetcher } = setup();
    fetcher.mockResolvedValueOnce(Response.json({ ...intent, status: "succeeded", amount_received: 2500, amount_capturable: 0 }))
      .mockResolvedValueOnce(Response.json({ id: "re_123", object: "refund", payment_intent: "pi_123", amount: 1000, currency: "usd", status: "pending", customer: "private" }));
    expect(await adapter.refundIntent("pi_123", 1000, "attempt1:refund:1")).toEqual({ kind: "ok", value: { id: "re_123", paymentIntentId: "pi_123", amountMinor: 1000, status: "pending" } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects refunds from a live, unauthorized or insufficient payment without posting a refund", async () => {
    for (const parent of [intent, { ...intent, livemode: true }, { ...intent, status: "succeeded", amount_received: 500 }]) {
      const { adapter, fetcher } = setup(parent);
      expect((await adapter.refundIntent("pi_123", 1000, "attempt1:refund")).kind).not.toBe("ok");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects path injection IDs and malformed keys before a write", async () => {
    const { adapter, fetcher } = setup();
    expect((await adapter.retrieveCheckout("cs_test_123/expire")).kind).toBe("failed");
    expect((await adapter.captureIntent("pi_123?secret=x", "safe")).kind).toBe("failed");
    expect((await adapter.createCheckout({ ...input, idempotencyKey: "bad\nheader" })).kind).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retrieves a refund only with a matching test-mode parent and strips payer data", async () => {
    const { adapter, fetcher } = setup();
    fetcher.mockResolvedValueOnce(Response.json({ id: "re_123", object: "refund", payment_intent: "pi_123", amount: 1000, currency: "usd", status: "succeeded", customer: "private" }))
      .mockResolvedValueOnce(Response.json({ ...intent, status: "succeeded", amount_received: 2500, amount_capturable: 0 }));
    expect(await adapter.retrieveRefund("re_123")).toEqual({ kind: "ok", value: { id: "re_123", paymentIntentId: "pi_123", amountMinor: 1000, status: "succeeded" } });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://api.stripe.com/v1/refunds/re_123", "https://api.stripe.com/v1/payment_intents/pi_123"]);
  });

  it("rejects a mismatched refund reference without querying its parent", async () => {
    const { adapter, fetcher } = setup({ id: "re_other", object: "refund", payment_intent: "pi_123", amount: 1000, currency: "usd", status: "pending" });
    expect((await adapter.retrieveRefund("re_123")).kind).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("lists a complete refund history for a verified test intent and strips payer data", async () => {
    const { adapter, fetcher } = setup();
    fetcher.mockResolvedValueOnce(Response.json({ ...intent, status: "succeeded", amount_received: 2500, amount_capturable: 0 }))
      .mockResolvedValueOnce(Response.json({ object: "list", has_more: false, data: [
        { id: "re_untracked", object: "refund", payment_intent: intent.id, amount: 2500, currency: "usd", status: "succeeded", customer: "private", destination_details: { card: "private" } },
      ] }));
    expect(await adapter.listIntentRefunds(intent.id)).toEqual({ kind: "ok", value: [
      { id: "re_untracked", paymentIntentId: intent.id, amountMinor: 2500, status: "succeeded" },
    ] });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.stripe.com/v1/payment_intents/pi_123", "https://api.stripe.com/v1/refunds?payment_intent=pi_123&limit=100",
    ]);
    expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });

  it("does not list refunds for a live or mismatched parent", async () => {
    for (const parent of [{ ...intent, livemode: true }, { ...intent, id: "pi_other" }]) {
      const { adapter, fetcher } = setup(parent);
      expect((await adapter.listIntentRefunds(intent.id)).kind).toBe("uncertain");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("leaves truncated, foreign, duplicate and impossible refund histories unresolved", async () => {
    const refund = { id: "re_123", object: "refund", payment_intent: intent.id, amount: 1000, currency: "usd", status: "succeeded" };
    for (const history of [
      { object: "list", has_more: true, data: [refund] },
      { object: "list", has_more: false, data: [{ ...refund, payment_intent: "pi_other" }] },
      { object: "list", has_more: false, data: [refund, refund] },
      { object: "list", has_more: false, data: [{ ...refund, amount: 2501 }] },
      { object: "list", has_more: false, data: [{ ...refund, currency: "eur" }] },
    ]) {
      const { adapter, fetcher } = setup();
      fetcher.mockResolvedValueOnce(Response.json({ ...intent, status: "succeeded", amount_received: 2500, amount_capturable: 0 }))
        .mockResolvedValueOnce(Response.json(history));
      expect((await adapter.listIntentRefunds(intent.id)).kind).toBe("uncertain");
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it("rejects raw card details or other unexpected checkout inputs", async () => {
    const { adapter, fetcher } = setup();
    expect((await adapter.createCheckout({ ...input, cardNumber: "synthetic-unaccepted-field" } as typeof input)).kind).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects returned object IDs that differ from the requested object", async () => {
    const one = setup({ ...session, id: "cs_test_other" });
    expect((await one.adapter.retrieveCheckout(session.id)).kind).toBe("uncertain");
    const two = setup({ ...intent, id: "pi_other" });
    expect((await two.adapter.retrieveIntent(intent.id)).kind).toBe("uncertain");
  });

  it("bounds successful responses and leaves malformed JSON unresolved", async () => {
    const { adapter, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response("x".repeat(128_001))).mockResolvedValueOnce(new Response("bad json"));
    expect((await adapter.retrieveIntent("pi_123")).kind).toBe("uncertain");
    expect((await adapter.retrieveIntent("pi_123")).kind).toBe("uncertain");
  });
});
