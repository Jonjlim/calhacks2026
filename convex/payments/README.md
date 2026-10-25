# Convex payments — P1-B integration in progress

Dev 2's persisted payment state and Dev 4's Stripe sandbox transport are both
implemented. They are not yet connected by production-facing payment actions or
an HTTP webhook route. P0 still ends at approved pledges. State mutations remain
off unless the deployment sets `PAYMENTS_SANDBOX_ENABLED=true`.

- `stateMachine.ts`, `sync.ts`, `state.ts` (Dev 2, BE-015): attempt transitions,
  group status, freeze-on-capture, stored intents, owner-safe status views, unwind
  intents and provider-event ledger hooks. They never call Stripe.
- `stripe.ts` (Dev 4): test-key-only hosted Checkout, checked provider reads,
  explicit keyed capture, manual-hold cancellation, expiry and refunds. One live
  create/retrieve/expire spike passed without card entry or funds movement;
  actual card authorization/capture/refund/cancellation remain unverified live.
- `webhook.ts`: raw-body signature verification. A verified event supplies
  references to reconcile, not payment-success authority. The HTTP route and
  transactionally fenced application of events still need integration.
- `read.ts` / `reconcile.ts`: fresh test-mode observations with frozen amount and
  binding checks, bounded refund discovery and explicit partial/uncertain states.
- `checkout.ts`: organizer collection and contributor manual authorization through the documented durable claim/settle
  port. No URL is returned before settlement; saved references use GETs and
  completed/expired sessions are never replaced automatically. Dev 2's current
  state surface records per-contributor authorization intents; it is not an
  implementation of the organizer-total claim/settle port.

Every provider write needs a durable operation-specific key and authorized claim.
No LLM path may create, authorize or capture a payment. Do not enable payment
controls until the state/adapter bridge, durable webhook reconciliation and real
sandbox acceptance pass. Multi-card capture and group recovery remain unfinished.

See `docs/CONTRACTS.md`, `docs/COMMERCE_AND_PAYMENTS.md` and
`docs/DEV4_PAYMENTS_HANDOFF.md` for the current integration boundary.


## Offline payment rehearsal

Run `node scripts/payment-rehearsal.mts`. It uses the real adapter, checked reader
and group-status functions with an injected fake Stripe transport and an
in-memory claim-store test double. It exercises exact individual shares,
no-success-on-redirect, waiting for another payer, freeze before simulated
capture, repeated read-only reconciliation, changed revisions and lost creates.
No keys are loaded, no network calls or Convex writes occur, no card is entered,
and no merchant order or actual funds movement occurs. This is repeatable backend
rehearsal, not a browser payment flow or live sandbox acceptance.

`runContributorCheckout` is the RC-011 transport counterpart to the existing
organizer runner. Both require Dev 2's durable claim/settle implementation before
an application action can call them. RC-012 signature helpers exist; the durable
webhook receipt route and reconciliation fence remain joint integration work.
