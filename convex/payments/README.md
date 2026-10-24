# Convex payments — P1-B implementation in progress

Dev 4's server-only `stripe.ts` adapter and `webhook.ts` raw-body signature verifier
are implemented and tested against synthetic provider responses. A real sandbox
create/retrieve/expire Checkout spike passed without card entry or funds movement.
Card authorization/capture and real webhook delivery remain unverified. No public payment action, schema table, webhook route or
payment UI has been enabled. P0 still ends at approved pledges.

- Dev 2 owns payment-attempt/event persistence, revision locking, approvals and recovery transitions (BE-015).
- Dev 4 owns the Stripe test-mode transport, response validation and signature verification (RC-010+).
- Every provider write needs a durable, operation-specific idempotency key and a state-layer claim before the call.
- No LLM path can authorize payment operations. Test keys only; no raw card data.
- Verified events are references to reconcile, not payment-success assertions. Event deduplication belongs in the database.
- `read.ts` retrieves current Checkout/intent/refund state; `reconcile.ts` derives bounded observations. Captured payments use a complete bounded refund list, including refunds whose create response was lost. Incomplete lists or missing tracked refunds remain uncertain. Repeated events lead to fresh reads, never replayed embedded payment status.
- Expiring an open Checkout does not cancel a completed authorization. Post-authorization cancellation and durable refund recovery still need the provider/state integration.

Next: pair the existing contract with Dev 2, wire organizer Checkout plus one
verified webhook route, then
run the actual sandbox acceptance before enabling any payment controls. Multi-card
capture and partial recovery remain unfinished.

See `docs/CONTRACTS.md`, `docs/COMMERCE_AND_PAYMENTS.md` and `docs/DEV4_PAYMENT_DECISION.md`.
