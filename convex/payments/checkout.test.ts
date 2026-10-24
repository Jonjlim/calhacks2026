import { describe, expect, it, vi } from "vitest";
import type { OrganizerCheckoutClaim, OrganizerCheckoutStore, StripeCheckoutInput, StripeTestSession } from "../../lib/contracts";
import { runOrganizerCheckout } from "./checkout";

const input: StripeCheckoutInput = { roomId: "room", revisionId: "revision", participantId: "organizer", attemptId: "attempt", amountMinor: 2500, currency: "USD", mode: "collect", idempotencyKey: "attempt:checkout" };
const session: StripeTestSession = { id: "cs_test_123", binding: { roomId: input.roomId, revisionId: input.revisionId, participantId: input.participantId, attemptId: input.attemptId }, amountMinor: input.amountMinor,
  currency: "USD", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123", status: "open", paymentStatus: "unpaid" };
function setup(claim: OrganizerCheckoutClaim | null = { claimId: "claim", input }) {
  const store = { claim: vi.fn<OrganizerCheckoutStore["claim"]>().mockResolvedValue({ kind: "ok", value: claim }), settle: vi.fn<OrganizerCheckoutStore["settle"]>().mockResolvedValue(true) };
  const adapter = { createCheckout: vi.fn().mockResolvedValue({ kind: "ok", value: session }), retrieveCheckout: vi.fn().mockResolvedValue({ kind: "ok", value: session }) };
  return { store, adapter };
}

describe("organizer Checkout durable-claim runner", () => {
  it("claims before calling Stripe, then commits before returning the Checkout URL", async () => {
    const { store, adapter } = setup();
    expect(await runOrganizerCheckout(store, adapter)).toEqual({ kind: "ok", value: session });
    expect(adapter.createCheckout).toHaveBeenCalledExactlyOnceWith(input);
    expect(store.settle).toHaveBeenCalledExactlyOnceWith("claim", { kind: "ok", value: session });
    expect(store.claim.mock.invocationCallOrder[0]).toBeLessThan(adapter.createCheckout.mock.invocationCallOrder[0]!);
    expect(adapter.createCheckout.mock.invocationCallOrder[0]).toBeLessThan(store.settle.mock.invocationCallOrder[0]!);
  });
  it("does not contact Stripe when policy refuses or another worker owns the claim", async () => {
    const { store, adapter } = setup(null);
    expect((await runOrganizerCheckout(store, adapter)).kind).toBe("uncertain");
    store.claim.mockResolvedValueOnce({ kind: "failed", message: "Current revision requires approvals." });
    expect((await runOrganizerCheckout(store, adapter)).kind).toBe("failed");
    expect(adapter.createCheckout).not.toHaveBeenCalled();
    expect(adapter.retrieveCheckout).not.toHaveBeenCalled();
    expect(store.settle).not.toHaveBeenCalled();
  });
  it("retrieves a saved session on repeated requests without a second create", async () => {
    const { store, adapter } = setup({ claimId: "read-claim", input, checkoutSessionId: session.id });
    expect((await runOrganizerCheckout(store, adapter)).kind).toBe("ok");
    expect(adapter.retrieveCheckout).toHaveBeenCalledExactlyOnceWith(session.id);
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });
  it("withholds the Checkout URL when persistence fails or loses its operation fence", async () => {
    const { store, adapter } = setup();
    store.settle.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("private database detail"));
    for (let i = 0; i < 2; i++) {
      const result = await runOrganizerCheckout(store, adapter);
      expect(result.kind).toBe("uncertain");
      expect(JSON.stringify(result)).not.toContain("checkout.stripe.com");
      expect(JSON.stringify(result)).not.toContain("private");
    }
  });
  it("persists uncertain provider outcomes without retrying the create", async () => {
    const { store, adapter } = setup();
    adapter.createCheckout.mockResolvedValueOnce({ kind: "uncertain", message: "Synthetic lost response" });
    expect((await runOrganizerCheckout(store, adapter)).kind).toBe("uncertain");
    expect(store.settle).toHaveBeenCalledExactlyOnceWith("claim", { kind: "uncertain", message: "Synthetic lost response" });
    expect(adapter.createCheckout).toHaveBeenCalledTimes(1);
  });
  it("settles unexpected transport exceptions as uncertain and sanitizes errors", async () => {
    const { store, adapter } = setup();
    adapter.createCheckout.mockRejectedValueOnce(new Error("private raw provider detail"));
    const result = await runOrganizerCheckout(store, adapter);
    expect(result.kind).toBe("uncertain");
    expect(store.settle).toHaveBeenCalledExactlyOnceWith("claim", expect.objectContaining({ kind: "uncertain" }));
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("starts one provider write when two workers compete for an atomic claim", async () => {
    const { store, adapter } = setup();
    let taken = false;
    store.claim.mockImplementation(async () => {
      if (taken) return { kind: "ok", value: null };
      taken = true;
      return { kind: "ok", value: { claimId: "claim", input } };
    });
    const results = await Promise.all([runOrganizerCheckout(store, adapter), runOrganizerCheckout(store, adapter)]);
    expect(results.map(r => r.kind).sort()).toEqual(["ok", "uncertain"]);
    expect(adapter.createCheckout).toHaveBeenCalledTimes(1);
    expect(store.settle).toHaveBeenCalledTimes(1);
  });
  it("refuses foreign bindings and prevents completed/expired references from creating a replacement", async () => {
    for (const changed of [
      { ...session, binding: { ...session.binding, revisionId: "other" } },
      { ...session, amountMinor: 2501 }, { ...session, id: "cs_test_other" },
      { ...session, status: "expired", checkoutUrl: undefined }, { ...session, status: "complete", paymentStatus: "paid" },
    ]) {
      const { store, adapter } = setup({ claimId: "claim", input, checkoutSessionId: session.id });
      adapter.retrieveCheckout.mockResolvedValueOnce({ kind: "ok", value: changed });
      expect((await runOrganizerCheckout(store, adapter)).kind).not.toBe("ok");
      expect(adapter.createCheckout).not.toHaveBeenCalled();
    }
  });
  it("does not run contributor authorization through the organizer collection worker", async () => {
    const { store, adapter } = setup({ claimId: "claim", input: { ...input, mode: "authorize" } });
    expect((await runOrganizerCheckout(store, adapter)).kind).toBe("failed");
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });
});
