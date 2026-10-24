/** Server-only Stripe REST transport. Caller owns permissions, durable intent and revision locks. */
import { z } from "zod";
import type { StripeAdapterResult, StripeCheckoutInput, StripeTestIntent, StripeTestRefund, StripeTestSession } from "../../lib/contracts";

export const STRIPE_API_VERSION = "2025-06-30.basil";
const cents = z.number().int().min(0).max(99_999_999);
const ref = z.string().min(1).max(200);
const keySchema = z.string().regex(/^[\x21-\x7e]{1,255}$/);
const sessionId = z.string().regex(/^cs_test_[A-Za-z0-9]+$/);
const intentId = z.string().regex(/^pi_[A-Za-z0-9]+$/);
const checkoutInput = z.strictObject({
  roomId: ref, revisionId: ref, participantId: ref, attemptId: ref,
  amountMinor: cents.min(50), currency: z.literal("USD"),
  mode: z.enum(["authorize", "collect"]), idempotencyKey: keySchema,
});
const bindingSchema = z.object({ roomId: ref, revisionId: ref, participantId: ref, attemptId: ref });
const sessionSchema = z.object({
  metadata: bindingSchema,
  id: sessionId, object: z.literal("checkout.session"), livemode: z.literal(false),
  url: z.string().nullable(), status: z.enum(["open", "complete", "expired"]),
  payment_status: z.enum(["paid", "unpaid", "no_payment_required"]),
  payment_intent: intentId.nullable(), amount_total: cents, currency: z.literal("usd"),
});
const intentSchema = z.object({
  metadata: bindingSchema,
  id: intentId, object: z.literal("payment_intent"), livemode: z.literal(false),
  status: z.enum(["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture", "canceled", "succeeded"]),
  amount: cents, amount_capturable: cents, amount_received: cents, currency: z.literal("usd"),
  capture_method: z.enum(["automatic", "automatic_async", "manual"]),
});
const refundSchema = z.object({
  id: z.string().regex(/^re_[A-Za-z0-9]+$/), object: z.literal("refund"),
  payment_intent: intentId, amount: cents.min(1), currency: z.literal("usd"),
  status: z.enum(["pending", "requires_action", "succeeded", "failed", "canceled"]),
});
const refundListSchema = z.object({ object: z.literal("list"), has_more: z.literal(false), data: z.array(refundSchema).max(100) });
const failed = (message: string): StripeAdapterResult<never> => ({ kind: "failed", message });
const uncertain = (message: string): StripeAdapterResult<never> => ({ kind: "uncertain", message });

function checkoutUrl(value: string | null): string | undefined {
  if (value === null) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "checkout.stripe.com" && !u.username && !u.password && !u.port ? u.href : undefined;
  } catch { return undefined; }
}

export function createStripeTestAdapter(config: { secretKey: string; frontendOrigin: string }, fetcher: typeof fetch = fetch) {
  let origin: URL | undefined;
  try {
    const u = new URL(config.frontendOrigin);
    if ((u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)))
      && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/") origin = u;
  } catch { /* Invalid server configuration fails before any network call. */ }
  async function request(path: string, method = "GET", body?: URLSearchParams, idempotencyKey?: string): Promise<StripeAdapterResult<unknown>> {
    if (!/^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(config.secretKey)) return failed("A Stripe test-mode secret key is required.");
    if (method === "POST" && !keySchema.safeParse(idempotencyKey).success) return failed("A stable payment idempotency key is required.");
    try {
      const response = await fetcher(`https://api.stripe.com/v1/${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${config.secretKey}`, "Stripe-Version": STRIPE_API_VERSION,
          ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey! } : {}) },
        ...(body ? { body: body.toString() } : {}),
      });
      if (!response.ok) return response.status >= 500 || [408, 409, 429].includes(response.status)
        ? uncertain(`Stripe request unresolved (HTTP ${response.status}).`)
        : failed(`Stripe rejected the request (HTTP ${response.status}).`);
      const reader = response.body?.getReader();
      if (!reader) return uncertain("Stripe returned an empty response.");
      const decoder = new TextDecoder();
      let size = 0, text = "";
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 128_000) { await reader.cancel(); return uncertain("Stripe response exceeded its supported size."); }
        text += decoder.decode(part.value, { stream: true });
      }
      return { kind: "ok", value: JSON.parse(text + decoder.decode()) as unknown };
    } catch { return uncertain("Stripe response was interrupted or could not be decoded. Reconcile before retrying."); }
  }
  async function session(path: string, method?: string, body?: URLSearchParams, key?: string): Promise<StripeAdapterResult<StripeTestSession>> {
    const result = await request(path, method, body, key);
    if (result.kind !== "ok") return result;
    const parsed = sessionSchema.safeParse(result.value);
    if (!parsed.success) return uncertain("Stripe returned an unsupported test Checkout object.");
    const s = parsed.data, url = checkoutUrl(s.url);
    const expectedId = path.split("/")[2];
    if (expectedId && s.id !== expectedId) return uncertain("Stripe returned a different Checkout object.");
    if (s.url !== null && !url) return uncertain("Stripe returned an unsupported Checkout URL.");
    return { kind: "ok", value: { id: s.id, binding: s.metadata, status: s.status, paymentStatus: s.payment_status,
      amountMinor: s.amount_total, currency: "USD", ...(url ? { checkoutUrl: url } : {}),
      ...(s.payment_intent ? { paymentIntentId: s.payment_intent } : {}) } };
  }
  async function intent(path: string, method?: string, key?: string): Promise<StripeAdapterResult<StripeTestIntent>> {
    const result = await request(path, method, undefined, key);
    if (result.kind !== "ok") return result;
    const parsed = intentSchema.safeParse(result.value);
    if (!parsed.success) return uncertain("Stripe returned an unsupported test PaymentIntent.");
    const p = parsed.data;
    if (p.id !== path.split("/")[1]) return uncertain("Stripe returned a different PaymentIntent.");
    return { kind: "ok", value: { id: p.id, binding: p.metadata, status: p.status, amountMinor: p.amount,
      amountCapturableMinor: p.amount_capturable, amountReceivedMinor: p.amount_received,
      captureMethod: p.capture_method, currency: "USD" } };
  }
  return {
    async createCheckout(input: StripeCheckoutInput): Promise<StripeAdapterResult<StripeTestSession>> {
      const parsed = checkoutInput.safeParse(input);
      if (!parsed.success || !origin) return failed("Checkout requires valid revision-bound USD amounts and frontend origin.");
      const v = parsed.data;
      const success = new URL(`/room/${encodeURIComponent(v.roomId)}`, origin);
      success.searchParams.set("checkout", "returned"); // Returning is not payment confirmation.
      const cancel = new URL(`/room/${encodeURIComponent(v.roomId)}`, origin);
      const body = new URLSearchParams({ mode: "payment", success_url: success.href, cancel_url: cancel.href,
        "payment_method_types[0]": "card", client_reference_id: v.attemptId,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(v.amountMinor),
        "line_items[0][price_data][product_data][name]": "Unwrap sandbox contribution",
        "payment_intent_data[capture_method]": v.mode === "authorize" ? "manual" : "automatic" });
      for (const field of ["roomId", "revisionId", "participantId", "attemptId"] as const) {
        body.set(`metadata[${field}]`, v[field]);
        body.set(`payment_intent_data[metadata][${field}]`, v[field]);
      }
      const result = await session("checkout/sessions", "POST", body, v.idempotencyKey);
      if (result.kind === "ok" && (result.value.amountMinor !== v.amountMinor || result.value.status !== "open" || !result.value.checkoutUrl
        || (["roomId", "revisionId", "participantId", "attemptId"] as const).some(field => result.value.binding[field] !== v[field])))
        return uncertain("Created Checkout did not match the requested amount or open-session state.");
      return result;
    },
    retrieveCheckout(id: string) {
      return sessionId.safeParse(id).success ? session(`checkout/sessions/${id}`) : Promise.resolve(failed("Invalid test Checkout ID."));
    },
    expireCheckout(id: string, key: string) {
      return sessionId.safeParse(id).success ? session(`checkout/sessions/${id}/expire`, "POST", undefined, key) : Promise.resolve(failed("Invalid test Checkout ID."));
    },
    retrieveIntent(id: string) {
      return intentId.safeParse(id).success ? intent(`payment_intents/${id}`) : Promise.resolve(failed("Invalid PaymentIntent ID."));
    },
    captureIntent(id: string, key: string) {
      return intentId.safeParse(id).success ? intent(`payment_intents/${id}/capture`, "POST", key) : Promise.resolve(failed("Invalid PaymentIntent ID."));
    },
    async cancelAuthorization(id: string, key: string): Promise<StripeAdapterResult<StripeTestIntent>> {
      if (!intentId.safeParse(id).success || !keySchema.safeParse(key).success) return failed("Cancellation requires a PaymentIntent and stable idempotency key.");
      const parent = await intent(`payment_intents/${id}`);
      if (parent.kind !== "ok") return parent;
      const p = parent.value;
      if (p.status === "canceled" && p.amountReceivedMinor === 0 && p.amountCapturableMinor === 0) return parent;
      if (p.status !== "requires_capture" || p.captureMethod !== "manual" || p.amountReceivedMinor !== 0 || p.amountCapturableMinor <= 0)
        return failed("Only an uncaptured manual authorization can be canceled. Reconcile other states before recovery.");
      const result = await intent(`payment_intents/${id}/cancel`, "POST", key);
      if (result.kind === "ok" && (result.value.status !== "canceled" || result.value.amountReceivedMinor !== 0
        || result.value.amountCapturableMinor !== 0 || result.value.amountMinor !== p.amountMinor
        || (["roomId", "revisionId", "participantId", "attemptId"] as const).some(field => result.value.binding[field] !== p.binding[field])))
        return uncertain("Cancellation did not confirm release of the expected authorization.");
      return result;
    },
    async listIntentRefunds(id: string): Promise<StripeAdapterResult<StripeTestRefund[]>> {
      if (!intentId.safeParse(id).success) return failed("Invalid PaymentIntent ID.");
      // Refund objects have no livemode: validate the parent before listing any.
      const parent = await intent(`payment_intents/${id}`);
      if (parent.kind !== "ok") return parent;
      const result = await request(`refunds?payment_intent=${id}&limit=100`);
      if (result.kind !== "ok") return result;
      const parsed = refundListSchema.safeParse(result.value);
      if (!parsed.success) return uncertain("Stripe refund history is incomplete or unsupported.");
      const seen = new Set<string>();
      const refunds: StripeTestRefund[] = [];
      for (const r of parsed.data.data) {
        if (r.payment_intent !== id || r.amount > parent.value.amountReceivedMinor || seen.has(r.id))
          return uncertain("Stripe refund history does not match the test payment.");
        seen.add(r.id);
        refunds.push({ id: r.id, paymentIntentId: r.payment_intent, amountMinor: r.amount, status: r.status });
      }
      return { kind: "ok", value: refunds };
    },
    async retrieveRefund(id: string): Promise<StripeAdapterResult<StripeTestRefund>> {
      if (!/^re_[A-Za-z0-9]+$/.test(id)) return failed("Invalid refund ID.");
      const result = await request(`refunds/${id}`);
      if (result.kind !== "ok") return result;
      const parsed = refundSchema.safeParse(result.value);
      if (!parsed.success || parsed.data.id !== id) return uncertain("Stripe returned an unsupported or mismatched refund.");
      const r = parsed.data;
      const parent = await intent(`payment_intents/${r.payment_intent}`);
      if (parent.kind !== "ok") return parent;
      if (r.amount > parent.value.amountReceivedMinor) return uncertain("Refund amount exceeds observed captured funds.");
      return { kind: "ok", value: { id: r.id, paymentIntentId: r.payment_intent, amountMinor: r.amount, status: r.status } };
    },
    async refundIntent(id: string, amountMinor: number, key: string): Promise<StripeAdapterResult<StripeTestRefund>> {
      if (!intentId.safeParse(id).success || !cents.min(1).safeParse(amountMinor).success) return failed("Refund requires a PaymentIntent and positive integer USD cents.");
      // Re-fetch first: refunds themselves do not carry livemode, so validate the intent's test mode and amount.
      const parent = await intent(`payment_intents/${id}`);
      if (parent.kind !== "ok") return parent;
      if (parent.value.status !== "succeeded" || parent.value.amountReceivedMinor < amountMinor) return failed("Refund requires a succeeded test payment covering the amount.");
      const result = await request("refunds", "POST", new URLSearchParams({ payment_intent: id, amount: String(amountMinor) }), key);
      if (result.kind !== "ok") return result;
      const parsed = refundSchema.safeParse(result.value);
      if (!parsed.success || parsed.data.payment_intent !== id || parsed.data.amount !== amountMinor) return uncertain("Stripe returned an unsupported or mismatched refund.");
      const r = parsed.data;
      return { kind: "ok", value: { id: r.id, paymentIntentId: r.payment_intent, amountMinor: r.amount, status: r.status } };
    },
  };
}
