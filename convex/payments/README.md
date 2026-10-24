# convex/payments (P1-B only)

Off unless the deployment sets `PAYMENTS_SANDBOX_ENABLED=true`. P0 pledges never depend on this directory.

RC-009 currently records `no-pay` (see `docs/DEV4_PAYMENT_DECISION.md`), so no Stripe adapter is planned. The state machine stays dormant behind the flag and ready if that decision changes.

- `stateMachine.ts` (Dev 2, BE-015): pure attempt transitions, group status derivation, unwind intents.
- `sync.ts` (Dev 2): applies the state machine to stored attempts; also used when the proposal engine supersedes a revision.
- `state.ts` (Dev 2): public status query and intent mutations (`beginAuthorization`, `beginCapture`, `cancelPayments`, `cancelMyAuthorization`), plus internal hooks for the adapter (`attachProviderObject`, `applyAttemptStatus`, `recordProviderEvent`).
- Stripe test-mode adapter and webhook route (Dev 4, RC-010+): not built yet. It must record intent through `state.ts` before every provider call and report results only through `applyAttemptStatus`.
- No LLM path may create, authorize, or capture a payment.

See `docs/COMMERCE_AND_PAYMENTS.md` and the payment sections of `docs/CONTRACTS.md`.
