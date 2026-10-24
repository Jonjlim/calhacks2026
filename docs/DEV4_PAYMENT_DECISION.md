# Dev 4 payment decision (RC-009)

Status: **P0 remains pledges. P1-B adapter implementation started at Alex’s request; sandbox acceptance and Dev 2 state wiring pending.**

Date: 2026-10-24. Owner: Dev 4. Consumers: Dev 2 (BE-015), Dev 1 (pledge copy), everyone (pitch).

## Decision

| Option | Meaning | Verdict |
| --- | --- | --- |
| `go` | Per-contributor sandbox authorization and capture (RC-010 to RC-013) | Not now |
| `organizer-only` | One Stripe test-mode Checkout session for the organizer (RC-010 only) | Upgrade path if time remains |
| `no-pay` | P0 ends at approved pledges; nobody is charged | **Chosen for the demo** |

## Why

- P0 is defined to end at a versioned, approved proposal of pledges ([PRODUCT.md](PRODUCT.md), [COMMERCE_AND_PAYMENTS.md](COMMERCE_AND_PAYMENTS.md)). The core room must not depend on P1-B.
- As of this note, the live backend works but the website is not wired to it yet (PX-002). Payment work would compete with the demo-critical path.
- No Stripe spike has run. Sponsor rules for Visa and Stripe are **unverified**; Stripe test mode alone may not qualify for a Visa track.
- Multi-contributor authorize/capture needs webhooks, idempotent reconcile, and freeze-on-capture (BE-015). That is the largest and riskiest remaining surface.

## What this means

- UI copy says "pledge" and "approve your share", never "pay" or "charged".
- Drop the "nobody fronts the cost" line from the pitch while `no-pay` holds.
- `convex/payments/` now contains isolated adapter work, but no payment-enabled public endpoints or UI.

## When to upgrade to `organizer-only`

All of these, by hour 22:

1. Checkpoint C3 (full P0 list) passes in the browser with two clients.
2. A 90-minute Stripe test-mode spike creates one hosted Checkout session from a Convex action and receives its webhook.
3. Dev 2 confirms BE-015 freeze-on-capture can land without touching allocation logic.
4. Someone reads the current sponsor rules and records whether Stripe test mode counts.

If any is missing, stay `no-pay`.

## Updated execution, October 24

The earlier website-not-wired rationale is historical. The integrated frontend and
personal development deployment now exist. Alex requested progressing through the
remaining priorities rather than blocking all P1 work on final P0 checks. Start the
Dev 4 transport/signature work independently with mocks; do not call it a finished
Checkout or multi-contributor feature. Real sandbox checks require a test key,
webhook configuration and the Dev 2 durable state/freeze integration. No money or
membership authority moves into the adapter.
