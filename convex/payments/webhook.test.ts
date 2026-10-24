import { describe, expect, it } from "vitest";
import { verifyStripeTestEvent } from "./webhook";

const secret = "whsec_synthetic";
const now = 1_792_843_200_000;
const body = JSON.stringify({ id: "evt_123", livemode: false, type: "checkout.session.completed", data: { object: { id: "cs_test_123", object: "checkout.session", client_secret: "must-not-leak", customer_email: "private@example.com" } } });
async function signature(raw = body, time = Math.floor(now / 1000), signingSecret = secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${time}.${raw}`));
  return `t=${time},v1=${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("")}`;
}

describe("Stripe test webhook verification", () => {
  it("verifies a raw-body signature and returns references, not payer information or payment success", async () => {
    expect(await verifyStripeTestEvent(body, await signature(), secret, now)).toEqual({ kind: "ok", value: { id: "evt_123", type: "checkout.session.completed", objectId: "cs_test_123", objectType: "checkout.session" } });
  });
  it("supports signing-secret rotation with multiple v1 signatures", async () => {
    expect((await verifyStripeTestEvent(body, `${await signature()},v1=${"a".repeat(64)}`, secret, now)).kind).toBe("ok");
  });
  it("refuses tampered bodies and a signature from another secret", async () => {
    expect((await verifyStripeTestEvent(body + " ", await signature(), secret, now)).kind).toBe("failed");
    expect((await verifyStripeTestEvent(body, await signature(body, undefined, "whsec_other"), secret, now)).kind).toBe("failed");
  });
  it.each([-301, 301])("refuses a timestamp %s seconds away", async seconds => {
    expect((await verifyStripeTestEvent(body, await signature(body, now / 1000 + seconds), secret, now)).kind).toBe("failed");
  });
  it("refuses malformed or duplicate timestamps and malformed signatures", async () => {
    for (const header of ["", "t=1,v1=bad", `${await signature()},t=${now / 1000}`, `t=${now / 1000},v0=${"a".repeat(64)}`])
      expect((await verifyStripeTestEvent(body, header, secret, now)).kind).toBe("failed");
  });
  it("refuses a correctly signed live event and malformed JSON", async () => {
    const live = body.replace('"livemode":false', '"livemode":true');
    expect((await verifyStripeTestEvent(live, await signature(live), secret, now)).kind).toBe("failed");
    expect((await verifyStripeTestEvent("bad", await signature("bad"), secret, now)).kind).toBe("failed");
  });
  it("refuses oversized input and invalid configuration", async () => {
    expect((await verifyStripeTestEvent("x".repeat(128001), "", secret, now)).kind).toBe("failed");
    expect((await verifyStripeTestEvent(body, await signature(), "", now)).kind).toBe("failed");
    expect((await verifyStripeTestEvent(body, await signature(), secret, NaN)).kind).toBe("failed");
  });
});
