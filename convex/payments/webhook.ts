/** Raw-body verification only. A verified event still requires durable deduplication and provider reconciliation. */
import { z } from "zod";
import type { StripeAdapterResult, StripeTestEvent } from "../../lib/contracts";

const eventSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9]+$/), livemode: z.literal(false),
  type: z.string().min(1).max(200),
  data: z.object({ object: z.object({ id: z.string().min(1).max(200), object: z.string().min(1).max(100) }) }),
});
const invalid = (): StripeAdapterResult<never> => ({ kind: "failed", message: "Invalid or expired Stripe test webhook." });

export async function verifyStripeTestEvent(rawBody: string, signature: string, signingSecret: string, nowMs: number): Promise<StripeAdapterResult<StripeTestEvent>> {
  if (!signingSecret.startsWith("whsec_") || signingSecret.length <= 6 || signature.length > 4000
    || !Number.isSafeInteger(nowMs) || nowMs <= 0 || new TextEncoder().encode(rawBody).length > 128_000) return invalid();
  const fields = signature.split(",").map(part => part.trim().split("="));
  const times = fields.filter(([key]) => key === "t").map(([, value]) => value);
  const signatures = fields.filter(([key, value]) => key === "v1" && /^[a-f0-9]{64}$/i.test(value ?? "")).map(([, value]) => value!);
  if (times.length !== 1 || !/^\d+$/.test(times[0] ?? "") || signatures.length < 1 || signatures.length > 5) return invalid();
  const time = Number(times[0]);
  if (!Number.isSafeInteger(time) || time <= 0 || Math.abs(nowMs - time * 1000) > 300_000) return invalid();
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${times[0]}.${rawBody}`);
    let valid = false;
    for (const hex of signatures) {
      const bytes = Uint8Array.from(hex.match(/.{2}/g)!, part => Number.parseInt(part, 16));
      if (await crypto.subtle.verify("HMAC", key, bytes, signed)) valid = true;
    }
    if (!valid) return invalid();
    const parsed = eventSchema.safeParse(JSON.parse(rawBody) as unknown);
    if (!parsed.success) return invalid();
    return { kind: "ok", value: { id: parsed.data.id, type: parsed.data.type,
      objectId: parsed.data.data.object.id, objectType: parsed.data.data.object.object } };
  } catch { return invalid(); }
}
