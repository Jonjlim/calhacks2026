# Dev 4 payment backend handoff

October 24, 2026. Transport/recovery primitives implemented on `dev4/alex`.
This is not an enabled end-to-end payment feature. P0 still ends at pledges.

## Working code

- `convex/payments/stripe.ts`: hosted Checkout creation (manual authorization or organizer collection), session retrieval/expiry, intent retrieval/capture, refund creation/retrieval. Fixed Stripe host and API version, test keys only, USD integer cents, revision/participant/attempt metadata, per-operation idempotency keys, bounded responses, no automatic POST retry and no raw provider errors/card data in results.
- `convex/payments/webhook.ts`: raw UTF-8 body HMAC verification, five-minute past/future tolerance, rotated v1 signatures, test-event envelope validation. Returns event/object references only.
- `convex/payments/read.ts`: fresh provider reads for an existing stored attempt. A completed redirect is not success. A known intent is retrieved even if Checkout expired. Captured payments discover refunds through `listIntentRefunds`, including refunds whose create response/ID was lost. One complete page of up to 100 is required; truncation or a missing tracked refund stays uncertain. Only GET methods exist on this reader port.
- `convex/payments/reconcile.ts`: provider observations tied to the expected amount and room/revision/member/attempt. Full authorization, full capture, partial capture, customer action, cancellation and partial/pending/full refunds remain distinct. No database writes or authorization decisions.
- `convex/payments/checkout.ts`: organizer runner through the documented `OrganizerCheckoutStore` port. Claim must authorize and persist before provider creation; settle must commit under its claim fence before a Checkout URL is released. Existing sessions use GETs, and expired/completed sessions are never automatically replaced. Offline tests include competing workers, persistence failure, lost provider replies and amount/binding mismatch.
- `cancelAuthorization`: checked test-mode manual-hold cancellation, with zero captured funds and a stable operation key. This follows current Stripe docs and has offline coverage; actual Checkout hold cancellation is still unverified live.

The signatures and DTOs are in CONTRACTS.md and lib/contracts/index.ts. These
helpers consume the existing PaymentAttempt statuses rather than defining a
second payment state machine.

## Actual sandbox evidence

With the test key configured on personal dev `cool-bat-724`, ran exactly one
successful create → retrieve → expire sequence on a $1 synthetic manual-capture
Checkout. Run `29a37712-0039-47a8-9d69-1d72f2fa2720`.

The local ignored report is under
`work/research-spike/stripe-sandbox/<runId>/report.json`. It contains no API key,
card data or Checkout bearer URL. No card was entered, funds authorized/captured,
or refund performed. Initial attempts with a missing configured key stopped
before calling Stripe. The script does not retry an unresolved create.

Real card authorization/capture, browser Checkout acceptance, webhook delivery
and full application-state integration have not been verified.

## Jonathon / BE-015 integration dependency

The current schema has no payment-attempt or provider-event tables. Dev 4 has
not modified the Dev 2 schema, approval or proposal-state authority.

The state layer needs to:

1. Authorize a human caller, find their own approved share (or an explicitly permitted organizer total), validate the current revision/currency/conditions, and persist the attempt plus operation-specific idempotency key before any Stripe call.
2. Claim one pending operation transactionally so duplicate client requests cannot start another write; retain Checkout/intent IDs and reconcile uncertainty before allowing a new operation.
3. Verify signatures at the HTTP boundary, durably deduplicate provider event IDs, map event references to stored attempts, and call readStripePayment. Do not apply status embedded in an old webhook.
4. Apply the observation only under the stored attempt/operation version fence. Capture requires current approvals and the group/revision lock before the external call. The existing proposal engine treats P1 statuses as frozen; review that behavior while wiring BE-015.
5. Keep partial capture and incomplete refunds in recovery. Per-person provider observations do not by themselves establish a funded group or a merchant order.
6. Return owner-scoped payment views; never expose another member's private caps, raw payer data or provider secrets.

For organizer Checkout, Dev 2 can implement `OrganizerCheckoutStore.claim()` and
`settle(claimId, result)` and call `runOrganizerCheckout`. The runner does not
replace any of the authorization, freeze, persistence or reconciliation work
above. Port interfaces are additive in lib/contracts/index.ts and CONTRACTS.md;
the payment schema and public endpoints remain untouched.

Do not configure a Stripe webhook endpoint until there is a durable receipt path;
acknowledging a verified event without persisting it would lose recovery events.
The future endpoint signing secret should be configured separately from the API
key. No public payment action or webhook route has been enabled by this work.

## Remaining acceptance

- Wire organizer Checkout first, then a verified persisted webhook and reconciliation.
- Run test-card authorization with a human at hosted Checkout, then verify exact amount/binding and duplicate delivery handling.
- Exercise explicit capture, expired sessions, provider timeouts, partial capture, failed/pending refunds and old revisions against real sandbox objects.
- Verify post-authorization cancellation behavior for the chosen Checkout flow before offering multi-person holds. Open-session expiry alone is not cancellation of a completed authorization.
- Multi-contributor orchestration and group recovery remain joint Dev 2/Dev 4 work, not completed by the adapter tests.
