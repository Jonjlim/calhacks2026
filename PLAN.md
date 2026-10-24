# Unwrap — Team Build Plan

Prepared for Cal Hacks 13.0, October 23, 2026. Working proposal; sponsor awards and requirements can change.

## 1. Pitch and overview

**Turn what your friends remember into a gift you choose and fund together.**

Unwrap is a collaborative gift studio that turns selected conversation excerpts and friends’ contributions into reviewable clues, researches relevant products and experiences, and helps a group approve and fund a specific purchase.

Friends join a shared room, confirm useful information about the recipient, explore an interactive gift map, and assemble a gift. Each contributor sets a private maximum share. When a gift, price, or contribution changes, Unwrap recalculates the proposal and requests renewed approval. The payment controller enforces the approved revision and tracks authorization, capture, cancellation, and recovery.

The emotional payoff is “you remembered something I said.” The technical payoff is evidence-backed recommendations and a group-purchase workflow that responds correctly when circumstances change.

### Thirty-second pitch

“Group gifts usually mean scattered messages, duplicate suggestions, and one friend fronting the cost. Unwrap turns selected conversations into clues you can confirm, finds real purchasing options, and lets friends build a gift together. Everyone approves their share of the same purchase. If the gift or budget changes, the proposal updates and old approvals stop being valid. The shared studio makes the thought behind the gift visible, while the payment controller keeps the purchase tied to what people agreed to.”

### Claims we can defend

- Recommendations refer to confirmed clues and source listings.
- Contribution caps and totals are enforced by application code.
- Approvals refer to a particular purchase revision.
- Sandbox payment states come from provider responses and verified events.

Do not promise guaranteed recipient satisfaction, complete duplicate detection, atomic capture across cards, instant restoration of available balances, escrow, or a real merchant order from a sandbox payment.

## 2. User journey

### Start and join

An organizer creates a room with recipient, occasion, deadline, currency, and initial budget. Friends join using a QR code and receive individual session identities. A room link alone must not authorize reading everyone’s private imports or contribution limits.

### Contribute conversation clues

Participants paste selected text or import one supported text export. Screenshot OCR is stretch scope. Do not require broad automatic message access.

The extraction workflow proposes typed clues: interest, explicit wish, exclusion, ownership, timing, or uncertain inference. Each carries source-message IDs, date when available, and confirmation state.

Example: “I want to try pottery” becomes an interest; “I bought that kit” becomes a proposed ownership fact. Participants can correct mistaken speaker attribution or outdated information. A question or quotation must not silently become the recipient’s preference.

Raw messages remain private to the contributor by default. A contributor explicitly publishes an approved clue to the room, with or without its original excerpt. Use synthetic conversations for the demonstration. Provide a way to remove imports and recompute dependent clues.

### Research current options

A product workflow searches a narrow set of supported sources using confirmed clues, budget, and deadline. Normalize actual listing information: URL, title, variant, currency, observed price, retrieval time, and available condition or availability fields.

Separate personal relevance from purchasing facts. An explanation such as “fits two friends’ confirmed clues” is different from a listing’s price or delivery estimate.

Trend discovery is optional. If included, display the actual public source and observation window. Do not call a product “trending” because a model says so or a few listings exist. Personal exclusions override popularity.

### Explore and assemble

The box unfolds into a small map of clues, gift directions, and products. Selecting “Why this?” highlights the supporting published clues. Friends drag an item into the box or use an equivalent button on mobile. They can pin priorities, react, flag a possible duplicate, or request alternatives.

Keep approximately 6–12 visible candidates rather than building an infinite marketplace. Do not force a multi-item basket: one suitable gift is a complete outcome.

### Allocate contributions

Each participant sets a private maximum. For the MVP, use one currency and one gift at a time. Let users opt into a clearly explained allocation rule, such as an equal split capped by each person’s limit, with the remainder redistributed among willing participants who still have capacity. Everyone sees and approves their final personal share.

Implement money as integer minor units. A proposal is infeasible if the approved contribution capacity cannot fund the known total. Show estimates and unresolved shipping or tax separately; do not call an incomplete estimate a final payable amount.

For a single item, a straightforward deterministic algorithm is enough. OR-Tools/PuLP becomes worthwhile only for a real multi-item selection problem with pinned items, category coverage, and explicit objectives. Taste scores are ranking signals, not payment authorization.

### Approve and fund

Freeze a proposal revision containing product/variant, quantity, payable total, source, contributor shares, conditions, and expiration. Each participant approves that revision and completes their own provider-hosted sandbox authorization.

The controller proceeds only when the revision remains current, required approvals and authorizations are valid, and the supported conditions pass. It freezes edits once capture begins. New proposed edits wait until the attempt resolves.

Changing the item, total, or shares invalidates old approvals. Cancel obsolete uncaptured authorizations, then request approval and authorization for the revised proposal. Track cancellations and refunds independently from the new revision.

### Wrap and reveal

Only the appropriate verified payment state triggers the wrap animation. The recipient gets a separate reveal containing approved messages and the selected gift story. Exclude private caps, raw conversations, and rejected options.

For the hackathon, show a test receipt and clearly label external merchant ordering as unimplemented unless it genuinely works. Share a reveal link; sending email/SMS is optional.

## 3. Planned features and scope

### Required MVP

- QR room joining and live shared state for at least two participants.
- Text input/import and source-linked proposed clues.
- Confirmation and selective publication of clues.
- One working public product-data source through Apify.
- Structured recommendations with evidence links.
- Shared gift box and a simple evidence map.
- One gift, one currency, deterministic contribution allocation.
- Versioned approvals and private contribution limits.
- Two sandbox contributors demonstrating authorization and capture.
- A change-before-capture cancellation path.
- An authorization failure path with no attempt to capture the remaining group.
- Idempotent payment-event handling and a visible recovery state.
- Payment-confirmed animation and recipient reveal.

### Payment recovery requirement

If multi-card capture is offered, implement and test a partial-capture failure path: stop remaining captures, cancel uncaptured authorizations, initiate refunds where required, and display pending recovery until confirmed. Never claim group capture is an atomic database transaction. If this cannot be completed, narrow the MVP to contribution pledges plus one organizer’s sandbox payment and explicitly withdraw the “nobody fronts the cost” claim.

### Stretch

- Screenshot OCR, a second product source, corroborated trend discovery.
- Multi-item optimization and pinned priorities.
- A substantive Factory runtime research workflow.
- Recipient taste swipes.
- Supported merchant-order integration.
- Voice participation, notifications, or richer 3D.

### Exclude initially

Always-on message scraping, all messaging platforms, multiple currencies, real funds, an open marketplace, indefinite payment holds, elaborate avatars, and unsupported automatic merchant checkout.

## 4. Visual direction

A warm shared atelier: ivory surfaces, plum text, restrained coral/lavender accents, clear product photography, and a central illustrated box. Build the interaction primarily in 2D with modest depth effects.

Signature sequence: clue arrives → box unfolds → evidence connections illuminate → item enters the box → proposal revision appears → approval/payment states resolve → box wraps.

Animations express state; they never fabricate it. Failed research, declined authorization, and pending recovery need deliberate visual treatments too. Support reduced motion. Keep mobile input simple and make the laptop the shared overview.

## 5. Potential stack and infrastructure

### Recommended baseline

- Next.js, React, TypeScript: application and server-side entrypoints.
- React Flow: custom clue/product nodes and evidence connections.
- Motion for React plus SVG/CSS: transitions, unfolding, and wrapping.
- Convex: authoritative room state, database, reactive subscriptions, and membership-controlled reads/writes.
- One structured-output LLM: clue extraction and explanations. Select a provider with working access; verify specific model IDs before committing.
- Apify: one supported retrieval/extraction workflow with normalized results.
- Stripe test mode with manual capture, or the sponsor-provided payment sandbox after confirming its capabilities and challenge requirements.
- A small Node worker only when external research runtimes require it. Add a separate Python service only if a genuine optimization problem justifies it.

Bitdeer is a possible model provider, but verify supported embedding/generation models first. Do not assume bge-m3 or a particular GLM version is available. Text embedding similarity also does not establish image understanding or ownership.

### Runtime flow

Browser → authenticated backend mutation → versioned research job → external model/data tools → validated results → Convex records → subscribed clients.

Payment path: approved revision → individual sandbox authorizations → controller validation → capture attempt → verified provider responses/events → completed or recovery state.

Convex remains the source of application state; the payment provider remains authoritative for payment status. Record intent before provider calls, use idempotency keys, and reconcile after ambiguous timeouts. An external payment and database write cannot be assumed atomic.

### Key records

Room, Participant, PrivateImport, PrivateMessage, PublishedClue, ResearchJob, Listing, Recommendation, ProposalRevision, PrivateContribution, Approval, PaymentAttempt, ProviderEvent, RecoveryAction, Reveal.

Every recommendation references clue and listing IDs. Every approval/payment references a proposal revision. Research results carry the input revision and must not overwrite newer choices.

### Payment states

Per contributor: not started, authorization pending, authorized, authorization failed, capture pending, captured, cancellation pending, canceled, refund pending, refunded, action required.

Group: draft, awaiting approval, authorizing, ready to capture, capturing, test funded, blocked, recovery pending, canceled. Track merchant order state separately.

Enforce caps, totals, permissions, and revision checks server-side. Deduplicate provider events and reconcile out-of-order updates. Do not infer payment success from a browser redirect. Keep secrets and raw card details out of application clients and logs; use the provider’s supported payment collection components.

## 6. Four-person ownership

### Person 1 — Product, map, and motion

Owns the atelier, responsive canvas, evidence links, shared gift box, approval presentation, wrap sequence, and recipient view. Deliver a rough complete flow before detailed animation.

### Person 2 — Realtime backend and coordination

Owns Convex schema, membership, private/public boundaries, shared state, proposal revisions, deterministic contribution allocation, and approval invalidation. Pairs with Person 4 on state transitions.

### Person 3 — Clues and product intelligence

Owns text imports, structured extraction, source attribution, clue review, Apify integration, listing normalization, ranking, and explanations. Add a Factory worker or trends only after this pipeline works.

### Person 4 — Payments and integration

Owns provider setup, hosted authorization, capture/cancellation/refund flows, webhooks, reconciliation, deployment, and payment-failure rehearsals. Works with Person 1 on truthful status display.

All four agree on the records and event contracts in the first hour. Each owns a demonstrated result rather than an isolated component.

## 7. Thirty-six-hour execution plan

### Hours 0–3: prove dependencies

Read Visa’s current challenge/starter materials and confirm acceptable payment integration. Obtain credentials. Run one Apify lookup. Extract clues from a synthetic conversation. Have two sandbox contributors authorize payments; test capture and cancellation. Establish shared room state and record schema.

### Hours 3–9: working skeleton

Connect import → confirmed clue → real listing → selected gift → proposal → approval → sandbox payment status. Use plain UI. Get a second phone into the room. Prove privacy boundaries.

### Hours 9–17: meaningful collaboration

Add evidence links, duplicate flags, budget changes, share allocation, versioned approvals, obsolete-result handling, and payment-revision checks.

### Hours 17–25: payment resilience and visual identity

Complete recovery paths and live job states while the frontend develops the signature unfold/assemble/wrap sequence. Keep research results source-backed.

### Hours 25–30: integration and optional track work

Test with four people and realistic latency. Add one optional integration only if core flow is stable. Prepare Figma stage-log material as work happens.

### Hours 30–36: freeze, verify, rehearse

Run the full flow repeatedly. Verify payment failures, stale approvals, import deletion, and access boundaries. Record a successful demo, prepare backup material, and complete submission assets.

## 8. Demonstration plan

### Three-minute main flow

0:00–0:20: “Friends remember different things. Group gifts make one person turn those memories into research, decisions, and payment chasing.” Open a room.

0:20–0:50: Two people join. Import synthetic messages. Confirm a pottery interest and a fact that the recipient already owns a starter kit.

0:50–1:20: The map unfolds. A relevant live listing appears; “Why this?” illuminates the approved clues. Show which recommendation is an experience versus an item, without claiming unverified availability.

1:20–1:45: Choose one gift. Lower a contribution cap. The allocation updates or the system proposes a sourced alternative. Everyone approves the new revision.

1:45–2:35: Two sandbox contributors authorize. Show a clear ready-to-capture state, then capture and verified completion. Use prejoined teammate devices to keep the presentation moving; judges need not enter payment details.

2:35–3:00: The box wraps and the recipient view explains the personal thought behind it. State clearly that this is a sandbox funding demonstration and whether merchant ordering is implemented.

### Separate sponsor/failure demonstration

After authorizations, flag a confirmed duplicate. Show purchase blocking, old-approval invalidation, and cancellation status. Demonstrate authorization failure and partial-capture recovery separately if time permits. A terminal/provider view can corroborate the UI.

Keep a captioned recording of a real run. Label cached results and their timestamps; do not portray cached or fixture data as a live retrieval. Bright Data’s challenge specifically requires real live data and excludes mocked demo data.

## 9. Technical challenge and feasibility

This is challenging for four people in 36 hours, principally because payments and concurrent edits require correct behavior across systems.

- Realtime room and standard forms: manageable.
- Clue extraction with attribution: manageable, but speaker ambiguity and privacy need care.
- Product retrieval: medium/high uncertainty because sources can be slow, incomplete, or blocked.
- Evidence-linked interactive canvas: medium/high design and frontend effort.
- Single-item allocation: modest; multi-item constrained selection is harder.
- Multi-contributor payment orchestration: highest engineering risk.
- Native messaging integrations and actual third-party merchant ordering: high scope; excluded initially.

Feasible as a narrow sandbox vertical slice after the early dependency tests pass. Do not judge technical depth by API count: the most substantial work is source integrity, versioned consent, deterministic constraints, and recoverable payment execution.

### Required verification

- Duplicate or out-of-order payment events do not double capture.
- Two clients cannot approve different revisions as one purchase.
- Edits cannot race with an in-progress capture attempt.
- Allocations remain within caps and sum exactly to the payable total.
- Authorization failure blocks capture; partial capture enters recovery.
- Imports and caps cannot be read by unauthorized participants.
- Unsupported listing facts stay unknown.
- Research failures and stale results do not corrupt the selected proposal.

## 10. Cal Hacks sponsor strategy

Awards below come from the linked hacker guide and detailed Figma challenge previously read on October 23. Confirm current starter-pack requirements, deadlines, and award-stacking rules. These are target fits, not predicted win probabilities.

### Primary: Visa — Reimagining Shopping — $5,000 listed

Lead with coordinated purchase approval and contribution limits, supported by personalized discovery. Demonstrate a complete user flow and failure recovery. The published scoring is innovation 25%, UX 25%, technical execution 20%, commerce impact 15%, trust/responsibility 15%. Verify required Visa technology: Stripe test mode alone does not establish eligibility. Do not assume Visa offers the exact multi-contributor flow needed.

### Primary: Convex — Best Use — $5,000 cash listed

Use Convex centrally for the room, confirmed clues, proposals, approvals, and live payment status. Demonstrate a contribution change on one phone updating other screens and invalidating stale approval. Server-side privacy rules are part of this implementation.

### Primary: Apify — main awards $2,000 / $1,000 / $800 / $400 / $400; Best Actor $400

Run actual supported product research and display normalized results with provenance. For Best Actor, build a meaningful custom Actor for this event and confirm publishing/submission requirements. Merely using someone else’s Actor does not demonstrate that you built the best new Actor.

### Primary thematic fit: Meta — Bringing People Closer Together with AI

Listed award: conditional invitation to Meta’s subsequent hackathon, travel/accommodations subject to its rules, and swag. Show different friends’ knowledge combining into a shared choice and personal recipient reveal. Test the group experience rather than relying on multiplayer as a label.

### Worthwhile process track: Figma

Detailed challenge lists Best Design $500, Most Creative $500, Best Figma Workflow $2,000, and Best Stage Log $2,000, plus a recruiter session for winners. Build and iterate the studio in Figma where useful. Submission includes an at-most-three-minute demo, stage log with at most 200 words per stage, required Figma Slides, accessible design artifacts, code links, and Edu verification. Confirm stacking and final requirements. Preserve an honest process log as you work.

### Conditional: Bitdeer AI Model Studio

Listed first prize: $500 credits and four gaming mice; second: $200 credits and a LEGO set. Use an available model for structured clue extraction or ranking in the real workflow. Verify model capabilities and latency first. Do not add a second provider only for a logo.

### Conditional: Factory — $2,000 cash, credits, swag

Droid must do meaningful work in the running product. A bounded research/replanning worker could take a confirmed brief, execute permitted tools, and return sourced candidates for approval. Display actions/results and explain the role in the README. Coding assistance alone does not satisfy the stated challenge.

### Conditional: Bright Data

Previously read live Hive listing: first $1,500 credits + $500 Amazon card; second $1,000 credits + $350 card; third $500 credits + $250 card. The guide itself says pending, so reconfirm. Use only if essential public live-data discovery has a distinct role from Apify. Its retrieved challenge excludes mocked/hardcoded demo data, scraping behind login/paywalls, and non-public personal-data collection. Private conversation imports must remain separate from public-web research.

### Additional process entries

Notability: one year Pro plus merchandise, if actually used for evolving sketches, notes, and testing. Mana: guide lists $5,000; meaningful real build use and accessible supporting artifacts are required. Either can support the existing build but should not displace product completion.

### General categories and exclusions

Submit for Overall, Most Creative, and Hacker’s Choice where eligible; technical complexity depends on the completed implementation. No evidence establishes that this necessarily loses technical recognition to a GPT-2-based project. Do not force CRS, Hyphenate, or unrelated agent-payment integrations into the gift flow.

## 11. Differentiation and decision criteria

Existing projects already combine gifting, taste profiles, conversation evidence, and group coordination. Do not pitch “first-ever AI gifting” or “nobody has built conditional payments.”

The proposed distinction is a complete, evidence-backed, collaborative purchasing experience with real sandbox payment execution, explicit revision approval, and demonstrable failure recovery. That difference must be visible in the working product; it is not established by the feature list.

Proceed with this version if the team wants to build both the warm studio and the difficult payment controller. If payment support or recovery proves unavailable, narrow the product honestly rather than preserving an unsupported promise.

## Sources

- Hacker guide and sponsor criteria: https://docs.google.com/document/d/1RQrueC9wm5u8uxtWSC2gadIchp05hVayhGUrIjxT9dE/edit?tab=t.0
- Live prizes: https://hive.hackberkeley.org/prizes#prizes
- Detailed Figma challenge: https://docs.google.com/document/d/1HjzThDGveSLiilIdEPEHq12ZVLZ5eS0T8CQC5_m_-rg/edit
- Stripe authorization/capture: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- Convex realtime: https://docs.convex.dev/realtime
- Apify Actor runs: https://docs.apify.com/actors/running/runs-and-builds

