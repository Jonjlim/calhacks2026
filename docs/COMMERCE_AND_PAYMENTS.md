# Commerce and Payments

Commerce in Unwrap has two layers that must not be collapsed:

- **P0 — Decide the purchase:** sourced listings, one selected gift, private caps, deterministic allocation, versioned approvals (pledges).
- **P1-B — Practice collecting money:** Stripe test mode (or a verified sponsor sandbox) attached to a specific revision.

P0 must demo without Stripe. P1-B must never tell a judge that a test authorization bought a real gift or placed a merchant order.

Safety thinking from [PLAN.md](../PLAN.md) is kept for P1-B: revision-bound approvals, non-atomic multi-contributor capture, recovery, and provider-authoritative payment status. The override is **when** that work happens, not whether those invariants are true.

## Product listing schema

Normalized by Dev 4 before anything hits the UI. See [CONTRACTS.md](CONTRACTS.md) for the full type.

Required fields:

- `source` — `"apify"` | `"shopping_api"` | `"manual_fixture"`
- `sourceUrl`
- `title`
- `currency` — P0: `"USD"` only; drop others
- `priceMinor` — integer cents, or omit and set `priceStatus: "unknown"`
- `retrievedAt` — unix ms
- `availability` — `"in_stock"` | `"limited"` | `"unavailable"` | `"unknown"`

Optional: `variant`, `imageUrl`, `sellerName`, `shippingMinor`, `shippingStatus`.

A listing without `sourceUrl` or `retrievedAt` is discarded. A model-written product is not a listing.

`manual_fixture` is allowed for unit tests and offline rehearsal. The UI must label fixtures and cached rows. Bright Data (if ever used) forbids mocked demo data; do not enter that track with fixtures.

## Source and retrieval timestamps

Every card shows observed price + retrieval time + outbound link.

`ProductListing` is an observation, not a live lock. Refreshing creates a new observation (or updates `retrievedAt` on the same source URL) and may invalidate a proposal if the payable total changed.

## Price freshness

| Age | UI |
| --- | --- |
| < 30 min | Show price normally |
| 30 min–<6 h | “Price observed at …” |
| ≥6 h, explicitly stale, or source failed | Do not call it current; offer refresh |

Dev 4's pure `getPriceFreshness` helper supplies the category, label, age, and next category-change timestamp. Dev 1 supplies the client clock and updates the label on a timer/visibility change. Missing prices, invalid timestamps, and invalid listings have separate states. This helper never fetches a new price or changes proposals.

Do not blend two observations into a fake “average price.”

## Gift selection

One active `GiftSelection` per room: a `listingId`, quantity `1` for P0, and a snapshot of the payable parts we actually know.

Changing listing or quantity sets `GiftSelection` to the new value and marks the previous `ProposalRevision` `superseded`.

Votes / reactions / map pins do not select the gift by themselves. They are inputs for humans.

## Contribution allocation

Deterministic, integer cents, owned by Dev 2 (`convex/allocations.ts`).

P0 rule: **equal split, capped by each private limit, remainder redistributed to participants who still have unused capacity**, repeating until remainder is 0 or nobody has capacity.

- Inputs: `payableTotalMinor`, each `ContributionLimit.amountMinor`, participant IDs.
- Outputs: `AllocationShare[]` that **sum exactly** to `payableTotalMinor`, or `{ feasible: false }`.
- Remainders of 1¢ go to the organizer, then by join order — pick one and unit-test it.
- Taste scores and votes never enter this function.

Infeasible if the sum of caps `<` known payable total. Shipping/tax that are `unresolved` are **not** stuffed into `payableTotalMinor`. Show them beside the proposal as unresolved.

## Private contribution limits

- Default: unset (treated as 0 until the user sets a number, so we cannot silently over-allocate).
- Owner-only read.
- Updating a cap after a revision is frozen mints a new revision if a proposal is in `awaiting_approval` or `approved_pledged`. It does not rewrite history.

## Feasibility checks

A revision may be created only if:

- There is an active selection
- Listing currency is `USD`
- `payableTotalMinor` is known and > 0
- Allocation returns feasible shares
- Room is not `capturing` (P1)

Otherwise the mutation returns `infeasible` with a public reason that does not leak caps.

## Proposal revisions

A revision is an immutable snapshot:

- Product / variant / quantity
- Listing observation IDs and `sourceUrl`
- `payableTotalMinor`
- Frozen `shares[]`
- `conditions[]` (e.g. “shipping unknown”)
- `createdAt`, optional `expiresAt`
- `status`

```text
draft → awaiting_approval → approved_pledged → superseded
                              ↘ infeasible
P1 only: approved_pledged → authorizing → ready_to_capture → capturing → test_funded
                                                              ↘ blocked → recovery_pending
any pre-capture → canceled
```

Edits never patch a revision. They create `n+1` and point `room.currentRevisionId` at it.

## Approval invalidation

An `Approval` is `{ participantId, revisionId, status }`.

Valid statuses: `pending` | `approved` | `invalidated` | `withdrawn`.

Invalidate all approvals on a revision when any of these change for the *next* revision:

- Selected listing or quantity
- `payableTotalMinor`
- Any participant’s frozen share
- Currency (out of scope, but if it happened)

Two clients cannot attach `approved` to two different revisions as “the” purchase: the mutation checks `room.currentRevisionId`.

P0 “everyone approved” means the group has pledged that revision. It does not mean funds were captured.

## P0 vs P1-B

| Concern | P0 | P1-B |
| --- | --- | --- |
| User promise | “We’ll chip in these amounts for this gift.” | “Sandbox authorizations for this revision.” |
| UI copy | Pledge / approve share | Test payment / sandbox |
| Provider | None | Stripe test mode or verified sponsor sandbox |
| Organizer fallback | Organizer pays outside the app, or we add one organizer checkout later | If multi-capture is too risky, one organizer Checkout session |
| Merchant order | Unimplemented | Still unimplemented unless a real integration exists |

If payment feasibility tests fail, **stay on P0** and withdraw any “nobody fronts the cost” line from the pitch.

## Sandbox authorization and capture (P1-B)

Only after Phase 0 says the provider can do what we think it can.

Confirmed design constraints:

- No raw card details in our code. Use Stripe Checkout, Payment Element, or the sponsor’s hosted equivalent.
- Each `PaymentAttempt` references exactly one `revisionId` and one `participantId`.
- Authorize (manual capture) per contributor, then capture only when the revision is still current and required approvals/authorizations are valid.
- Freeze room edits when group status becomes `capturing`.
- Cancel obsolete uncaptured authorizations when a revision is superseded.
- Track refunds and cancellations independently from the new revision.

LLM output cannot create attempts or capture.

Sponsor warning from [PLAN.md](../PLAN.md): Stripe test mode alone may not satisfy Visa’s challenge. Verify current rules before spending time on eligibility.

## Payment state machines (P1-B)

Per contributor:

```text
not_started → authorization_pending → authorized → capture_pending → captured
                    ↘ authorization_failed
              authorized → cancellation_pending → canceled
              captured → refund_pending → refunded
              * → action_required
```

Group:

```text
draft → awaiting_approval → authorizing → ready_to_capture → capturing → test_funded
                                              ↘ blocked
                                              ↘ recovery_pending
         * → canceled
```

Merchant order state is a **separate** field: `not_implemented` for the hackathon unless we truly place an order. Never copy `test_funded` onto a merchant-order badge.

## Idempotency

- `PaymentAttempt.idempotencyKey` is sent to Stripe.
- Webhook handler (`ProviderEvent.providerEventId`) is unique. Duplicates acknowledge and stop.
- Out-of-order events: store then reconcile from the PaymentIntent, do not blindly apply.
- Browser redirects are not success signals.

Record intent in Convex (`authorization_pending` / `capture_pending`) **before** the provider call. Timeouts leave `uncertain` until retrieve-and-reconcile.

## Event reconciliation

Convex HTTP route receives Stripe events, verifies the signature, inserts `ProviderEvent`, and runs a pure reconcile into `PaymentAttempt` + group status.

If our document and Stripe disagree, Stripe wins and we update. If retrieve fails, stay in `recovery_pending` / `uncertain` and say so in the UI.

## Failure recovery

Taken from [PLAN.md](../PLAN.md) and required if we offer multi-card capture:

1. Authorization failure → do not capture anyone; group `blocked` or stay `authorizing` with a visible failure.
2. Partial capture failure → stop remaining captures, cancel uncaptured authorizations, refund captured ones if the gift will not be funded, show `recovery_pending` until each provider object is terminal.
3. Never describe group capture as an atomic database transaction.
4. New revision after failure is a new world: new approvals, new attempts. Old refunds keep their IDs.

If we cannot finish this path, **do not ship multi-contributor capture**. Fall back to pledges, or one organizer sandbox Checkout.

## Cancellation and refunds

- Uncaptured authorization: cancel at the provider, status `canceled`.
- Captured then abandoned: refund, status `refunded`.
- Do not reuse a canceled attempt row for a new revision.

## Merchant-order status

`merchantOrder.status = "not_implemented"` unless a real order API is called.

Sandbox funding ≠ warehouse fulfillment. Reveal copy (P2) may tell a story about the gift; it may not show a fake tracking number.

## Trend-aware ranking (P2, commerce-adjacent)

Personal relevance outranks popularity. Dev 4 may attach a `TrendObservation` if a source is real.

| Candidate | Status | Notes |
| --- | --- | --- |
| Google Trends | Unverified | Useful for category interest, not price or SKU availability. Rate limits and terms must be checked. |
| TikTok trend APIs | Unverified / likely unavailable officially | Do not scrape logged-in TikTok. Use only a legitimate API if one exists for us. |
| Apify store actors | Unverified | Confirm ToS, freshness, and whether results are live listings vs SEO pages. |
| Shopping search APIs | Unverified | Prefer if they return stable URLs + prices with less HTML fragility. |

Normalization: `{ topic, source, windowStart, windowEnd, retrievedAt, scoreNormalized 0..1 }`.

Fallback: `trendSignal = 0`. Do not have the LLM invent a trend. Attribute the source in the UI or omit the badge.

## Scope limitations

- One gift, one currency (`USD`).
- No multi-item OR-Tools optimizer.
- No real funds, escrow, or marketplace checkout.
- No indefinite authorization holds.
- No “Unwrap ordered this from the merchant” unless it is true.

## Fallback copy

If we stay on pledges:

> Everyone approved the same revision and promised these amounts. Unwrap has not charged cards and has not placed a merchant order.

If we run Stripe test mode:

> This is sandbox payment infrastructure. Test cards only. No real gift was purchased.

Dev 1 owns making those sentences visible. Dev 2 owns making the states true.
