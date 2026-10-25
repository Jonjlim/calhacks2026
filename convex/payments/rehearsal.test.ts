/** Offline rehearsal only: real adapter/reader/state functions, injected fake provider and store. */
import { describe, expect, it } from "vitest";
import type { ContributorCheckoutStore, PaymentAttemptStatus, ProposalStatus, StripeAdapterResult, StripeCheckoutInput, StripePaymentBinding, StripeTestSession } from "../../lib/contracts";
import { runContributorCheckout } from "./checkout";
import { readStripePayment } from "./read";
import { canTransitionAttempt, deriveGroupStatus } from "./stateMachine";
import { createStripeTestAdapter } from "./stripe";

type Person = "alex" | "sam";
type RawSession = { id: string; object: "checkout.session"; livemode: false; metadata: StripePaymentBinding;
  url: string | null; status: "open" | "complete"; payment_status: "unpaid"; payment_intent: string | null; amount_total: number; currency: "usd" };
type RawIntent = { id: string; object: "payment_intent"; livemode: false; metadata: StripePaymentBinding;
  status: "requires_capture" | "succeeded"; amount: number; amount_capturable: number; amount_received: number; currency: "usd"; capture_method: "manual" };

function rehearsal() {
  const sessions = new Map<string, RawSession>();
  const intents = new Map<string, RawIntent>();
  const requests: { method: string; path: string; key: string | null; captureMethod?: string | null }[] = [];
  const shares = [{ participantId: "alex", amountMinor: 2500 }, { participantId: "sam", amountMinor: 1500 }];
  const attempts: { participantId: string; status: PaymentAttemptStatus }[] = shares.map(s => ({ participantId: s.participantId, status: "authorization_pending" }));
  const local = new Map<Person, { claimed: boolean; unresolved: boolean; sessionId?: string }>([
    ["alex", { claimed: false, unresolved: false }], ["sam", { claimed: false, unresolved: false }],
  ]);
  let currentRevision = true;
  let loseCreateResponse = false;
  let group: ProposalStatus = "authorizing";
  const trace: string[] = ["SIMULATED ONLY — no network, keys, card entry or Convex writes", "Approved revision: $40 total; Alex $25, Sam $15"];
  const fetcher: typeof fetch = async (resource, options) => {
    const url = new URL(String(resource));
    if (url.origin !== "https://api.stripe.com") throw new Error("Unexpected fixture host");
    const path = url.pathname.replace("/v1/", "");
    const method = options?.method ?? "GET";
    const body = new URLSearchParams(typeof options?.body === "string" ? options.body : "");
    requests.push({ method, path, key: new Headers(options?.headers).get("Idempotency-Key"),
      ...(method === "POST" && path === "checkout/sessions" ? { captureMethod: body.get("payment_intent_data[capture_method]") } : {}) });
    if (method === "POST" && path === "checkout/sessions") {
      const who = body.get("metadata[participantId]");
      if (who !== "alex" && who !== "sam") throw new Error("Unknown rehearsal payer");
      const binding = Object.fromEntries((["roomId", "revisionId", "participantId", "attemptId"] as const)
        .map(field => [field, body.get(`metadata[${field}]`)])) as unknown as StripePaymentBinding;
      const s: RawSession = { id: `cs_test_${who}`, object: "checkout.session", livemode: false, metadata: binding,
        url: `https://checkout.stripe.com/c/pay/cs_test_${who}`, status: "open", payment_status: "unpaid", payment_intent: null,
        amount_total: Number(body.get("line_items[0][price_data][unit_amount]")), currency: "usd" };
      sessions.set(s.id, s);
      if (loseCreateResponse) { loseCreateResponse = false; throw new Error("Synthetic response lost after provider commit"); }
      return Response.json(s);
    }
    if (method === "GET" && path.startsWith("checkout/sessions/")) return Response.json(sessions.get(path.split("/")[2]!));
    if (method === "GET" && path.startsWith("payment_intents/")) return Response.json(intents.get(path.split("/")[1]!));
    if (method === "GET" && path === "refunds") return Response.json({ object: "list", has_more: false, data: [] });
    if (method === "POST" && /^payment_intents\/pi_(alex|sam)\/capture$/.test(path)) {
      const p = intents.get(path.split("/")[1]!)!;
      p.status = "succeeded"; p.amount_capturable = 0; p.amount_received = p.amount;
      return Response.json(p);
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  };
  // Both values are fixed test literals. The fetch argument always intercepts transport.
  const adapter = createStripeTestAdapter({ secretKey: "sk_test_rehearsal", frontendOrigin: "http://localhost:3000" }, fetcher);
  function input(who: Person): StripeCheckoutInput & { mode: "authorize" } {
    return { roomId: "sample-room", revisionId: "sample-revision", participantId: who, attemptId: `attempt-${who}`,
      amountMinor: shares.find(s => s.participantId === who)!.amountMinor, currency: "USD", mode: "authorize", idempotencyKey: `${who}:checkout:1` };
  }
  function store(who: Person): ContributorCheckoutStore {
    const saved = local.get(who)!;
    return {
      async claim() {
        if (!currentRevision) return { kind: "failed", message: "The revision changed. Approve the new revision." };
        if (saved.claimed || saved.unresolved) return { kind: "ok", value: null };
        saved.claimed = true;
        return { kind: "ok", value: { claimId: `claim-${who}`, input: input(who), checkoutSessionId: saved.sessionId } };
      },
      async settle(_claimId: string, result: StripeAdapterResult<StripeTestSession>) {
        // Test double only. Production must implement a durable, transactionally fenced store.
        saved.claimed = false;
        if (result.kind === "ok") saved.sessionId = result.value.id;
        saved.unresolved = result.kind === "uncertain";
        return currentRevision;
      },
    };
  }
  async function open(who: Person) { return runContributorCheckout(store(who), adapter); }
  function completeHostedCheckout(who: Person) {
    const s = sessions.get(`cs_test_${who}`)!;
    s.status = "complete"; s.url = null; s.payment_intent = `pi_${who}`;
    intents.set(`pi_${who}`, { id: `pi_${who}`, object: "payment_intent", livemode: false, metadata: s.metadata,
      status: "requires_capture", amount: s.amount_total, amount_capturable: s.amount_total, amount_received: 0, currency: "usd", capture_method: "manual" });
  }
  async function observe(who: Person) {
    const i = input(who);
    const result = await readStripePayment({ expected: { binding: i, amountMinor: i.amountMinor, mode: "authorize" }, checkoutSessionId: local.get(who)!.sessionId }, adapter);
    if (result.kind !== "ok") throw new Error("Rehearsal observation did not validate");
    const attempt = attempts.find(a => a.participantId === who)!;
    if (attempt.status !== result.value.status && !canTransitionAttempt(attempt.status, result.value.status)) throw new Error("Invalid rehearsal state transition");
    attempt.status = result.value.status;
    group = deriveGroupStatus(group, shares, attempts);
    trace.push(`${who}: ${result.value.status}; group: ${group}`);
    return result.value;
  }
  function beginCapture() {
    if (group !== "ready_to_capture") { trace.push("Capture refused: every payer must be authorized"); return false; }
    group = "capturing";
    attempts.forEach(a => { a.status = "capture_pending"; });
    trace.push("Revision frozen before simulated captures");
    return true;
  }
  return { adapter, requests, trace, open, observe, completeHostedCheckout, beginCapture,
    group: () => group, loseNextCreateResponse: () => { loseCreateResponse = true; },
    changeRevision: () => { currentRevision = false; trace.push("Revision changed; old Checkout claims refused"); } };
}
function show(name: string, trace: string[]) {
  if (process.env.UNWRAP_PAYMENT_REHEARSAL === "1") console.log(`\n${name}\n${trace.map(s => `  ${s}`).join("\n")}\n  Merchant order: NOT CREATED. Actual funds moved: $0.\n`);
}

describe("offline payment rehearsal (not a live Stripe or Convex acceptance test)", () => {
  it("rehearses two hosted shares, authorization, frozen capture and duplicate read-only reconciliation", async () => {
    const r = rehearsal();
    expect((await r.open("alex")).kind).toBe("ok");
    expect((await r.open("sam")).kind).toBe("ok");
    expect(r.requests.filter(q => q.method === "POST").map(q => q.captureMethod)).toEqual(["manual", "manual"]);
    // Merely opening/returning from the page cannot establish payment success.
    expect((await r.observe("alex")).status).toBe("authorization_pending");
    expect(r.group()).toBe("authorizing");
    expect(r.beginCapture()).toBe(false);
    r.completeHostedCheckout("alex"); await r.observe("alex");
    expect(r.group()).toBe("authorizing");
    r.completeHostedCheckout("sam"); await r.observe("sam");
    expect(r.group()).toBe("ready_to_capture");
    expect(r.beginCapture()).toBe(true);
    expect((await r.adapter.captureIntent("pi_alex", "alex:capture:1")).kind).toBe("ok");
    await r.observe("alex"); expect(r.group()).toBe("capturing");
    expect((await r.adapter.captureIntent("pi_sam", "sam:capture:1")).kind).toBe("ok");
    await r.observe("sam"); expect(r.group()).toBe("test_funded");
    const writes = r.requests.filter(q => q.method === "POST").length;
    await r.observe("sam");
    expect(r.requests.filter(q => q.method === "POST")).toHaveLength(writes);
    expect(r.requests.filter(q => q.method === "POST").map(q => q.key)).toEqual(["alex:checkout:1", "sam:checkout:1", "alex:capture:1", "sam:capture:1"]);
    show("SUCCESS / exact shares and full simulated capture", r.trace);
  });
  it("keeps the group unfunded while one friend has not completed Checkout", async () => {
    const r = rehearsal();
    await r.open("alex"); await r.open("sam");
    r.completeHostedCheckout("alex"); await r.observe("alex"); await r.observe("sam");
    expect(r.beginCapture()).toBe(false);
    expect(r.group()).toBe("authorizing");
    expect(r.requests.filter(q => q.path.endsWith("/capture"))).toHaveLength(0);
    show("WAITING / one friend still needs to authorize", r.trace);
  });
  it("refuses old revision claims without contacting the provider", async () => {
    const r = rehearsal(); r.changeRevision();
    expect((await r.open("alex")).kind).toBe("failed");
    expect(r.requests).toHaveLength(0);
    show("CHANGED PROPOSAL / old approvals cannot open Checkout", r.trace);
  });
  it("leaves a lost create unresolved and blocks a second paid start", async () => {
    const r = rehearsal(); r.loseNextCreateResponse();
    expect((await r.open("alex")).kind).toBe("uncertain");
    expect((await r.open("alex")).kind).toBe("uncertain");
    expect(r.requests.filter(q => q.method === "POST")).toHaveLength(1);
    r.trace.push("Create response lost; stored uncertainty blocks another create");
    show("INTERRUPTED CHECKOUT / reconcile, do not charge again", r.trace);
  });
});
