# convex/payments (P1-B only)

Empty on purpose. Payments start only if the Phase 0 spike (RC-009) says `go` or `organizer-only` and checkpoint C3 passed. Current proposal: `no-pay` (see `docs/DEV4_PAYMENT_DECISION.md`).

- Dev 2 owns the revision/payment state machine and freeze-on-capture (BE-015).
- Dev 4 owns the Stripe test-mode adapter (RC-010+).
- No LLM path may create, authorize, or capture a payment.

See `docs/COMMERCE_AND_PAYMENTS.md`.
