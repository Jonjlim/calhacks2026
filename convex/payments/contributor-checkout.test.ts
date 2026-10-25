import { describe, expect, it, vi } from "vitest";
import type { ContributorCheckoutClaim, ContributorCheckoutStore, StripeTestSession } from "../../lib/contracts";
import { runContributorCheckout } from "./checkout";

const claim: ContributorCheckoutClaim = { claimId: "share-claim", input: {
  roomId: "room", revisionId: "revision", participantId: "contributor", attemptId: "share-attempt",
  amountMinor: 1700, currency: "USD", mode: "authorize", idempotencyKey: "share-attempt:checkout",
} };
const session: StripeTestSession = { id: "cs_test_share", binding: {
  roomId: "room", revisionId: "revision", participantId: "contributor", attemptId: "share-attempt",
}, amountMinor: 1700, currency: "USD", status: "open", paymentStatus: "unpaid", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_share" };
function setup(value: ContributorCheckoutClaim | null = claim) {
  const store = { claim: vi.fn<ContributorCheckoutStore["claim"]>().mockResolvedValue({ kind: "ok", value }),
    settle: vi.fn<ContributorCheckoutStore["settle"]>().mockResolvedValue(true) };
  const adapter = { createCheckout: vi.fn().mockResolvedValue({ kind: "ok", value: session }),
    retrieveCheckout: vi.fn().mockResolvedValue({ kind: "ok", value: session }) };
  return { store, adapter };
}

describe("contributor hosted Checkout worker", () => {
  it("claims the frozen share before Stripe and settles before releasing a URL", async () => {
    const { store, adapter } = setup();
    expect(await runContributorCheckout(store, adapter)).toEqual({ kind: "ok", value: session });
    expect(adapter.createCheckout).toHaveBeenCalledExactlyOnceWith(claim.input);
    expect(store.claim.mock.invocationCallOrder[0]).toBeLessThan(adapter.createCheckout.mock.invocationCallOrder[0]!);
    expect(adapter.createCheckout.mock.invocationCallOrder[0]).toBeLessThan(store.settle.mock.invocationCallOrder[0]!);
    expect(store.settle).toHaveBeenCalledExactlyOnceWith(claim.claimId, { kind: "ok", value: session });
  });
  it("does not call Stripe after policy rejection or an already claimed operation", async () => {
    const { store, adapter } = setup(null);
    expect((await runContributorCheckout(store, adapter)).kind).toBe("uncertain");
    store.claim.mockResolvedValueOnce({ kind: "failed", message: "This revision changed." });
    expect((await runContributorCheckout(store, adapter)).kind).toBe("failed");
    expect(adapter.createCheckout).not.toHaveBeenCalled();
    expect(adapter.retrieveCheckout).not.toHaveBeenCalled();
    expect(store.settle).not.toHaveBeenCalled();
  });
  it("cannot collect an organizer total even if a malformed store supplies that mode", async () => {
    const { store, adapter } = setup();
    // Deliberately violate the typed port to exercise its runtime boundary.
    store.claim.mockResolvedValueOnce({ kind: "ok", value: { ...claim, input: { ...claim.input, mode: "collect" as "authorize" } } });
    expect((await runContributorCheckout(store, adapter)).kind).toBe("failed");
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });
  it("retrieves a known session without repeating its create", async () => {
    const { store, adapter } = setup({ ...claim, checkoutSessionId: session.id });
    expect((await runContributorCheckout(store, adapter)).kind).toBe("ok");
    expect(adapter.retrieveCheckout).toHaveBeenCalledExactlyOnceWith(session.id);
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });
  it("withholds all bearer URLs when current-revision persistence loses its fence", async () => {
    const { store, adapter } = setup();
    store.settle.mockResolvedValueOnce(false);
    const result = await runContributorCheckout(store, adapter);
    expect(result.kind).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("checkout.stripe.com");
  });
  it("settles a lost provider reply as uncertain with no automatic retry", async () => {
    const { store, adapter } = setup();
    adapter.createCheckout.mockRejectedValueOnce(new Error("private provider response"));
    expect((await runContributorCheckout(store, adapter)).kind).toBe("uncertain");
    expect(adapter.createCheckout).toHaveBeenCalledTimes(1);
    expect(store.settle).toHaveBeenCalledExactlyOnceWith(claim.claimId, expect.objectContaining({ kind: "uncertain" }));
  });
  it.each([
    { ...session, amountMinor: 1800 },
    { ...session, binding: { ...session.binding, participantId: "someone-else" } },
    { ...session, binding: { ...session.binding, revisionId: "old-revision" } },
    { ...session, status: "complete" as const, checkoutUrl: undefined },
    { ...session, status: "expired" as const, checkoutUrl: undefined },
  ])("never releases mismatched or finished sessions: %j", async changed => {
    const { store, adapter } = setup({ ...claim, checkoutSessionId: session.id });
    adapter.retrieveCheckout.mockResolvedValueOnce({ kind: "ok", value: changed });
    expect((await runContributorCheckout(store, adapter)).kind).not.toBe("ok");
    expect(adapter.createCheckout).not.toHaveBeenCalled();
  });
});
