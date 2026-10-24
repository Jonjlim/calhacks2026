# Team Tasks

Four workstreams. One repo. Contracts in [CONTRACTS.md](CONTRACTS.md). Schedule in [EXECUTION_PLAN.md](EXECUTION_PLAN.md).

Developer numbers are roles, not ranked importance.

## Workload balance

[PLAN.md](../PLAN.md) gave Person 3 both clues and product research, and Person 4 all of payments. That overloads two people and makes Stripe a single point of failure.

This plan:

- **Dev 3** owns intelligence and privacy-bound agents, not Apify.
- **Dev 4** owns product retrieval, normalization, and ranking. That is a full P0 job.
- **Payments are not Dev 4 alone.** Dev 2 owns revision/payment *state* and freeze rules. Dev 4 owns the Stripe adapter if Phase 0 says `go`. Multi-capture recovery is the first thing we drop.
- Trend APIs, custom Actors, and Factory Droid are P2 and do not sit on Dev 4’s P0 critical path.

If Dev 4 falls behind, Dev 2 keeps pledges working and Dev 1 uses fixture listings labeled as fixtures. We do not ask Dev 4 to finish shopping intelligence *and* webhook reconciliation in the same night.

---

## Developer 1 — Frontend, product experience, visualization

### Primary responsibilities

Next.js app, gift-room UI, chat, clue review, product cards, shortlist/map, shared box, voting, contribution/approval UI, responsive layout, motion that reflects real state.

### Ownership boundaries

Owns `app/`, `components/`, and visual tokens. Does not change Convex schema, allocation math, or agent prompts except by consuming contracts. Does not hide failed states behind a happy animation.

### Expected modules

`app/page.tsx`, `app/room/[roomId]/`, `components/chat/`, `components/clues/`, `components/map/`, `components/products/`, `components/proposal/`, `lib/convex-client.ts`

### Interfaces provided

Room screens that call the operation contracts. Visual states for `JobStatus` and proposal `status`.

### Interfaces depended on

Every query/mutation in [CONTRACTS.md](CONTRACTS.md) that is marked consumer Dev 1.

### Dependencies

Mock data until C1. Real Convex at C2. Listings from Dev 4. Agent messages from Dev 3.

### Definition of done

A judge can complete the [PRODUCT.md](PRODUCT.md) acceptance path on laptop and a second device without asking which button is real.

### Start immediately (after reading contracts)

PX-001, PX-002, PX-003 against mocks.

### Mocks

In-memory `roomQuery`, `chatQuery`, `myProposedCluesQuery`, `publishedCluesQuery`, `recommendationsQuery`, `proposalQuery` from CONTRACTS.md.

### Concrete tasks

| ID | Task | Priority | Depends |
| --- | --- | --- | --- |
| PX-001 | App shell, atelier tokens (ivory / plum / coral), routing stubs | P0 | — |
| PX-002 | Create-room and join-by-token forms | P0 | PX-001 |
| PX-003 | Chat transcript + composer (human + `buyer_agent`) | P0 | PX-001 |
| PX-004 | Evidence import paste + proposed-clue review/publish | P0 | PX-002 |
| PX-005 | Published-clue rail and manual preference form | P0 | PX-004 |
| PX-006 | Product cards with URL, price, `retrievedAt`, fixture label | P0 | PX-001 |
| PX-007 | Shortlist and “Why this?” highlighting published clues | P0 | PX-005, PX-006 |
| PX-008 | Lightweight map **or** list equivalent; React Flow only if PX-007 is done | P0 | PX-007 |
| PX-009 | Shared box + select/vote controls | P0 | PX-006 |
| PX-010 | Private cap input and share display (never show others’ caps) | P0 | PX-002 |
| PX-011 | Proposal revision + approve/invalidated/infeasible states | P0 | PX-010 |
| PX-012 | Job and research status toasts (running / failed / stale) | P0 | PX-003 |
| PX-013 | QR join and two-device layout pass | P0 | PX-002 |
| PX-014 | Honest pledge / sandbox copy | P0 | PX-011 |
| PX-015 | Reduced-motion and empty/error treatments | P0 | PX-011 |
| PX-016 | Recipient-agent operator form + reply chip | P1-A | PX-003 |
| PX-017 | Payment status panel (test-mode labeling) | P1-B | PX-014 |
| PX-018 | Wrap animation and recipient reveal | P2 | PX-009 |
| PX-019 | Advanced React Flow interactions | P2 | PX-008 |
| PX-020 | Product photo on every card, with a labeled “no photo from source” placeholder | P0 | PX-006 |
| PX-023 | Photo clue drop zone (1–3 photos) with tap-to-mark recipient and “read once, then deleted” copy | P0 | PX-004, BE-018 |
| PX-021 | Screenshot drop zone (1–3 images), upload progress, “deleted after reading” copy | P1-C | PX-004, BE-018 |
| PX-022 | Hold-to-record voice note (60 s max, “record yourself only”) | P2 | PX-021, AI-017 |

---

## Developer 2 — Backend, data, realtime collaboration

### Primary responsibilities

Convex project, schema, auth, membership, realtime queries, authorization, proposal revisions, private caps, allocation, approval validity, job rows, payment *state machine* (not Stripe SDK).

### Ownership boundaries

Owns `convex/schema.ts`, `rooms.ts`, `messages.ts`, `clues.ts` (storage), `proposals.ts`, `allocations.ts`, auth helpers. Does not own LLM prompts or Apify calls. Pairs on `convex/payments/` status transitions with Dev 4.

### Expected modules

`convex/schema.ts`, `convex/rooms.ts`, `convex/messages.ts`, `convex/clues.ts`, `convex/proposals.ts`, `convex/allocations.ts`, `convex/votes.ts`, `convex/jobs.ts`, `lib/money.ts`

### Interfaces provided

All P0 mutations/queries in CONTRACTS.md except `extractClues`, `startResearch` internals, and agent decisions.

### Interfaces depended on

`ProposedClue` payloads from Dev 3. `ProductListing` IDs from Dev 4.

### Dependencies

Phase 0 Convex auth spike. Contract freeze.

### Definition of done

Two clients sync; imports and caps cannot be read by the other member; allocations sum exactly; stale approvals cannot pass `approveRevision`.

### Start immediately

BE-001, BE-002, BE-003.

### Mocks

Accept fixture `ProposedClue` and `ProductListing` JSON.

### Concrete tasks

| ID | Task | Priority | Depends |
| --- | --- | --- | --- |
| BE-001 | Convex schema for P0 entities + indexes | P0 | — |
| BE-002 | Auth + `createRoom` / `joinRoom` membership | P0 | BE-001 |
| BE-003 | `sendMessage` + reactive chat query + idempotency | P0 | BE-002 |
| BE-004 | `importEvidence` private tables + delete/tombstone | P0 | BE-002 |
| BE-005 | Proposed/published clue writes + `knowledgeRevision` | P0 | BE-004 |
| BE-006 | Query-time privacy filters (tests) | P0 | BE-004, BE-005 |
| BE-007 | `selectGift`, votes, one active selection | P0 | BE-001 |
| BE-008 | `setContributionLimit` owner-only | P0 | BE-002 |
| BE-009 | Allocation engine + unit tests | P0 | BE-008 |
| BE-010 | Immutable `ProposalRevision` + `createProposal` | P0 | BE-007, BE-009 |
| BE-011 | `approveRevision` + invalidation rules | P0 | BE-010 |
| BE-012 | Job documents + `inputHash` uniqueness | P0 | BE-001 |
| BE-013 | Invite token / QR payload | P0 | BE-002 |
| BE-014 | Manual published clue mutation | P0 | BE-005 |
| BE-015 | Payment status fields and freeze-on-capture | P1-B | BE-011 |
| BE-016 | Recipient preference tables + grants (no buyer reads) | P1-A | BE-001 |
| BE-017 | Cascade delete room | P2 | BE-006 |
| BE-018 | `generateEvidenceUploadUrl` + `importMediaEvidence` (photos P0, screenshots P1-C): owner-only storage, EXIF strip, type/size limits, delete file after read | P0 | BE-004 |

---

## Developer 3 — AI agents and privacy-aware intelligence

### Primary responsibilities

LLM client, buyer agent, clue extraction, asked-slot memory, structured outputs, orchestration, P1-A recipient agent and policy.

### Ownership boundaries

Owns `convex/agents/`, Zod decision schemas, prompts, disclosure policy. Does not publish clues, allocate money, or call Stripe. Does not scrape mailboxes.

### Expected modules

`convex/agents/buyer.ts`, `extract.ts`, `policy.ts`, `recipient.ts`, `lib/validation.ts` (agent schemas)

### Interfaces provided

`extractClues`, `AgentDecision`, `AgentQuery` / `AgentReply`, `AskedSlot` writes.

### Interfaces depended on

Room snapshot queries (public + own evidence). `startResearch`. Dev 2 job rows.

### Dependencies

Phase 0 model spike. Manual clue fallback if the model fails.

### Definition of done

Extraction produces valid `ProposedClue[]` from a synthetic paste. Buyer agent can `listen`. It does not re-ask an open slot. It cannot read another member’s import.

### Start immediately

AI-001, AI-002, AI-003.

### Mocks

Fixture snapshots; later live `getRoomSnapshot`.

### Concrete tasks

| ID | Task | Priority | Depends |
| --- | --- | --- | --- |
| AI-001 | Zod schemas for `AgentDecision` and `ExtractionResult` | P0 | — |
| AI-002 | Extractor action on one synthetic conversation | P0 | AI-001 |
| AI-003 | Buyer-agent policy: listen / wait / clarify budgets | P0 | AI-001 |
| AI-004 | Wire extract to `importEvidence` owner scope | P0 | AI-002, BE-004 |
| AI-005 | `AskedSlot` anti-repeat | P0 | AI-003 |
| AI-006 | Contradiction flags + one clarify | P0 | AI-002 |
| AI-007 | `evaluate_thread` job + stale hash | P0 | BE-012 |
| AI-008 | Emit `SearchBrief` for Dev 4 | P0 | AI-003 |
| AI-009 | Recommendation explanation from IDs only | P0 | RC-005 |
| AI-010 | Prompt-injection / tool allowlist tests | P0 | AI-004 |
| AI-011 | Sensitive-line drop in validator | P0 | AI-002 |
| AI-012 | Disclosure policy + recipient agent | P1-A | BE-016 |
| AI-013 | Buyer `queryRecipientAgent` integration | P1-A | AI-012 |
| AI-014 | Quiet-mode (`@unwrap` only) for demo control | P0 | AI-003 |
| AI-015 | Embeddings / second model | P2 | — |
| AI-018 | Photo reading → `PhotoObservation` → uncertain proposed clues; agreement merge across photos; no face recognition; image spike in Phase 0 | P0 | AI-002, BE-018 |
| AI-016 | Screenshot transcription → `PrivateMessage` rows, then normal extraction; reuses the photo upload path | P1-C | AI-002, BE-018 |
| AI-017 | Voice-note speech-to-text → one `PrivateMessage`; provider spike first | P2 | AI-016 |

---

## Developer 4 — Product research, recommendations, commerce integrations

### Primary responsibilities

One product API, normalization, provenance, scoring, research jobs. Stripe adapter **only** if prioritized and shared with Dev 2.

### Ownership boundaries

Owns `convex/research/`, listing normalization, scoring. Does not own allocation or approval validity. Does not invent trends or prices. Payment UI copy is Dev 1; payment states are Dev 2.

**Shared with Dev 2:** `PaymentAttempt` documents, freeze, reconcile mutations.

**Defer if needed:** multi-contributor capture, refunds, Visa-specific stack, trend sources, custom Apify Actor, Factory.

### Expected modules

`convex/research/provider.ts`, `normalize.ts`, `score.ts`, `convex/payments/stripe.ts` (P1-B)

### Interfaces provided

`ProductListing`, `Recommendation`, `ResearchJob` completion, optional payment adapter.

### Interfaces depended on

`PublishedClue`, `SearchBrief`, `ProposalRevision` for P1-B.

### Dependencies

Phase 0 source spike. Scoring can use fixture clues.

### Definition of done

`startResearch` yields ≥1 `active` listing with `sourceUrl`, `priceStatus`, `retrievedAt`. Recommendations cite clue IDs. Fixtures are not labeled as Apify.

### Start immediately

RC-001, RC-002, RC-003.

### Mocks

`manual_fixture` catalog of 4 products + published-clue fixtures.

### Concrete tasks

| ID | Task | Priority | Depends |
| --- | --- | --- | --- |
| RC-001 | Listing Zod schema + fixture catalog | P0 | — |
| RC-002 | Verify Apify actor or substitute API | P0 | — |
| RC-003 | Normalize one live search to `ProductListing` | P0 | RC-001, RC-002 |
| RC-004 | `startResearch` action + job status | P0 | BE-012, RC-003 |
| RC-005 | Score listings vs published clues (trend = 0) | P0 | RC-004, BE-005 |
| RC-006 | Stale-job / outdated `knowledgeRevision` handling | P0 | RC-004 |
| RC-007 | Invalidate listing → clear selection hook | P0 | BE-007 |
| RC-008 | Price-age labeling data for UI | P0 | RC-003 |
| RC-009 | Stripe feasibility note (`go` / `organizer-only` / `no-pay`) | P0 | — |
| RC-010 | Hosted Checkout for one organizer | P1-B | RC-009, BE-015 |
| RC-011 | Per-contributor auth + capture | P1-B | RC-010 |
| RC-012 | Webhook idempotency + reconcile | P1-B | RC-011 |
| RC-013 | Cancel / refund / partial-capture recovery | P1-B | RC-012 |
| RC-014 | TrendObservation + sourced badge | P2 | RC-005 |
| RC-015 | Second product source or custom Actor | P2 | RC-003 |
| RC-016 | Keep source photos: validate `imageUrl`, prefer listings with photos in the visible set, test it — done in p0 (see “Derived product presentation (RC-008 / RC-016)” in [CONTRACTS.md](CONTRACTS.md)) | P0 | RC-003, RC-005 |
| RC-017 | Photo-derived style clues through the merged confirmed-clue path (no separate `SearchBrief` field; see “Confirmed visual preferences in research” in [CONTRACTS.md](CONTRACTS.md)); fixture tests | P0 | RC-005, AI-018 |

---

## Master task table

Effort: S ≈ 1–2 h, M ≈ 2–4 h, L ≈ 4–8 h. Use as issue sizes.

| ID | Name | Owner | Priority | Dependencies | Deliverable | Acceptance | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PX-001 | App shell and tokens | Dev 1 | P0 | — | Routed Next app | Pages render with tokens | S |
| PX-002 | Create / join UI | Dev 1 | P0 | PX-001 | Forms | Token join works vs mock | S |
| PX-003 | Chat UI | Dev 1 | P0 | PX-001 | Transcript + composer | Agent vs human distinct | S |
| PX-004 | Clue review | Dev 1 | P0 | PX-002 | Review list | Publish one, reject one | M |
| PX-005 | Published clue rail | Dev 1 | P0 | PX-004 | Room knowledge | Other user can see in mock | S |
| PX-006 | Product cards | Dev 1 | P0 | PX-001 | Cards | URL + price + time visible | S |
| PX-007 | Why this? | Dev 1 | P0 | PX-005, PX-006 | Highlight | Clue IDs match rec | M |
| PX-008 | Shortlist / map | Dev 1 | P0 | PX-007 | Map or list | 6–12 candidates | M |
| PX-009 | Box + votes | Dev 1 | P0 | PX-006 | Selection UX | Item enters box | S |
| PX-010 | Caps UI | Dev 1 | P0 | PX-002 | Cap field | Peer cannot see cap | S |
| PX-011 | Proposal UI | Dev 1 | P0 | PX-010 | Revision panel | Invalidated state visible | M |
| PX-012 | Job status UI | Dev 1 | P0 | PX-003 | Status | Failed research shown | S |
| PX-013 | QR / two-device | Dev 1 | P0 | PX-002 | Join path | Second device enters | S |
| PX-014 | Honest money copy | Dev 1 | P0 | PX-011 | Labels | No “purchased” on pledges | S |
| PX-015 | Empty / motion | Dev 1 | P0 | PX-011 | States | Reduced motion works | S |
| PX-016 | Recipient chip | Dev 1 | P1-A | PX-003 | Operator UI | Reply not raw profile | S |
| PX-017 | Payment panel | Dev 1 | P1-B | PX-014 | Status | Sandbox labeled | M |
| PX-018 | Wrap / reveal | Dev 1 | P2 | PX-009 | Animation | Only after real success state | M |
| PX-019 | Advanced map | Dev 1 | P2 | PX-008 | React Flow | Does not break mobile | L |
| PX-020 | Product photos | Dev 1 | P0 | PX-006 | Card image | Placeholder when missing; no stock images | S |
| PX-023 | Photo clue upload | Dev 1 | P0 | PX-004, BE-018 | Marker tap UI | Unmarked photo = scene-only; deletion copy visible | M |
| PX-021 | Screenshot upload | Dev 1 | P1-C | PX-004, BE-018 | Drop zone | 3-file limit; deletion copy visible | S |
| PX-022 | Voice note UI | Dev 1 | P2 | PX-021, AI-017 | Recorder | 60 s cap | S |
| BE-001 | Schema | Dev 2 | P0 | — | `schema.ts` | Tables match contracts | M |
| BE-002 | Auth + rooms | Dev 2 | P0 | BE-001 | create/join | Token ≠ private access | M |
| BE-003 | Chat | Dev 2 | P0 | BE-002 | Messages | Two-client sync | S |
| BE-004 | Imports | Dev 2 | P0 | BE-002 | Private rows | Peer query empty | M |
| BE-005 | Clue storage | Dev 2 | P0 | BE-004 | Publish | `knowledgeRevision++` | M |
| BE-006 | Privacy tests | Dev 2 | P0 | BE-004, BE-005 | Tests | Caps/imports hidden | M |
| BE-007 | Selection | Dev 2 | P0 | BE-001 | GiftSelection | One active | S |
| BE-008 | Caps | Dev 2 | P0 | BE-002 | ContributionLimit | Owner only | S |
| BE-009 | Allocation | Dev 2 | P0 | BE-008 | `allocations.ts` | Exact sum / infeasible | M |
| BE-010 | Revisions | Dev 2 | P0 | BE-007, BE-009 | ProposalRevision | Immutable | M |
| BE-011 | Approvals | Dev 2 | P0 | BE-010 | Approval | Stale ID rejected | M |
| BE-012 | Jobs | Dev 2 | P0 | BE-001 | Job tables | Hash dedupe | S |
| BE-013 | Invite QR data | Dev 2 | P0 | BE-002 | Token API | Join works | S |
| BE-014 | Manual clues | Dev 2 | P0 | BE-005 | Mutation | No import required | S |
| BE-015 | Pay states | Dev 2 | P1-B | BE-011 | Status enums | Freeze on capture | M |
| BE-016 | Recipient tables | Dev 2 | P1-A | BE-001 | Isolated tables | Buyer query denied | M |
| BE-017 | Room delete | Dev 2 | P2 | BE-006 | Cascade | Private rows gone | S |
| BE-018 | Media evidence | Dev 2 | P0 | BE-004 | Upload + source rows | Peer cannot read; file gone after read | M |
| AI-001 | Zod contracts | Dev 3 | P0 | — | Schemas | Invalid model output fails | S |
| AI-002 | Extractor | Dev 3 | P0 | AI-001 | ProposedClues | Pottery + ownership demo | M |
| AI-003 | Intent policy | Dev 3 | P0 | AI-001 | Decisions | Default listen | M |
| AI-004 | Owner-scoped extract | Dev 3 | P0 | AI-002, BE-004 | Action | Other import unreadable | M |
| AI-005 | Asked slots | Dev 3 | P0 | AI-003 | Table | No repeat question | S |
| AI-006 | Contradictions | Dev 3 | P0 | AI-002 | Flags | One clarify | S |
| AI-007 | Evaluate job | Dev 3 | P0 | BE-012 | AgentJob | Stale hash no write | M |
| AI-008 | Search brief | Dev 3 | P0 | AI-003 | SearchBrief | Terms from published clues | S |
| AI-009 | Explanations | Dev 3 | P0 | RC-005 | Text | Cites IDs only | S |
| AI-010 | Allowlist tests | Dev 3 | P0 | AI-004 | Tests | Extra tools ignored | S |
| AI-011 | Sensitive drop | Dev 3 | P0 | AI-002 | Validator | Health/ID skipped | S |
| AI-012 | Recipient policy | Dev 3 | P1-A | BE-016 | Policy | Illegal type no LLM | M |
| AI-013 | A2A query | Dev 3 | P1-A | AI-012 | AgentReply | Sanitized guidance | M |
| AI-014 | Quiet mode | Dev 3 | P0 | AI-003 | Flag | Demo-safe | S |
| AI-015 | Embeddings | Dev 3 | P2 | — | — | Not needed for P0 | L |
| AI-018 | Photo clues | Dev 3 | P0 | AI-002, BE-018 | Read + propose | Marked photo yields uncertain activity clue; no face recognition | L |
| AI-016 | Screenshot clues | Dev 3 | P1-C | AI-002, BE-018 | Transcribe + extract | Synthetic chat screenshot yields the pottery clue | M |
| AI-017 | Voice clues | Dev 3 | P2 | AI-016 | Transcribe + extract | Transcript is contributor-attributed | M |
| RC-001 | Fixture listings | Dev 4 | P0 | — | JSON + schema | Labeled fixtures | S |
| RC-002 | Source spike | Dev 4 | P0 | — | Note | Pass/fail recorded | S |
| RC-003 | Live normalize | Dev 4 | P0 | RC-001, RC-002 | Listings | URL + price + time | M |
| RC-004 | Research job | Dev 4 | P0 | BE-012, RC-003 | Action | Status updates | M |
| RC-005 | Scoring | Dev 4 | P0 | RC-004, BE-005 | Recommendations | Exclusion wins | M |
| RC-006 | Stale research | Dev 4 | P0 | RC-004 | Status | No clobber | S |
| RC-007 | Invalid listing | Dev 4 | P0 | BE-007 | Hook | Selection clears | S |
| RC-008 | Freshness fields | Dev 4 | P0 | RC-003 | Data | UI can age price | S |
| RC-009 | Pay spike | Dev 4 | P0 | — | `go`/`no-pay` | Written decision | S |
| RC-010 | Organizer Checkout | Dev 4 | P1-B | RC-009, BE-015 | Session | Test mode only | M |
| RC-011 | Multi auth/capture | Dev 4 | P1-B | RC-010 | Attempts | Revision-bound | L |
| RC-012 | Webhooks | Dev 4 | P1-B | RC-011 | Reconcile | Dedupe events | M |
| RC-013 | Recovery | Dev 4 | P1-B | RC-012 | Paths | Partial capture honest | L |
| RC-014 | Trends | Dev 4 | P2 | RC-005 | Observation | Real source or omit | M |
| RC-015 | Extra source | Dev 4 | P2 | RC-003 | Actor/API | Not a logo-only add | L |
| RC-016 | Listing photos (done in p0) | Dev 4 | P0 | RC-003, RC-005 | `imageUrl` kept | Photo-first visible set | S |
| RC-017 | Style clues via confirmed path | Dev 4 | P0 | RC-005, AI-018 | Confirmed-clue matching | Never an exclusion; no new SearchBrief field | S |

---

## Parallel timeline

| Hours | Dev 1 | Dev 2 | Dev 3 | Dev 4 |
| --- | --- | --- | --- | --- |
| 0–3 | PX-001–002 | BE-001–002 | AI-001–002 | RC-001–002, RC-009 |
| 3–10 | PX-003–006 | BE-003–009 | AI-003–004, AI-014 | RC-003–005 |
| 10–20 | PX-007–015 | BE-010–014, BE-006 | AI-005–011 | RC-006–008 |
| 14–20 | PX-023 after checkpoint A | BE-018 after checkpoint A | AI-018 after checkpoint A | RC-017 after checkpoint A |
| 20–26 | Polish; PX-021 or PX-016 if go | BE-016 if go | AI-016 first, then AI-012–013 if go | Help C3; no new source |
| 22–28 | PX-017 if go | BE-015 if go | Stay off payments | RC-010+ only if go |
| 28–36 | Demo drive | Retest privacy | Quiet-mode | Fresh listings |

All four have P0 work that does not wait on P1.

## Critical path

```text
BE-001 → BE-002 → BE-005 → RC-004 → PX-007
                → BE-009 → BE-010 → BE-011 → PX-011 → C3 demo
AI-002 → PX-004 ─┘
```

If any node slips, use manual clues (BE-014 + PX-005) or fixture listings (RC-001, labeled).

Photo clues (AI-018 + BE-018 + PX-023 + RC-017) hang off this path after checkpoint A and never block it; if they slip past hour 20, they demote to the 20–24 slot or the recording.

## Git and PR strategy

- `main` is always demoable after C1.
- Branches: `dev1/px-004-clue-review`, `dev2/be-009-allocation`, `dev3/ai-002-extract`, `dev4/rc-003-normalize`, `shared/schema`.
- PRs small, one task ID in the title.
- Shared files (`convex/schema.ts`, `docs/CONTRACTS.md`, `lib/contracts/*`): ping consumers, merge first.

### Shared-file ownership

| File | Primary editor | Must review |
| --- | --- | --- |
| `convex/schema.ts` | Dev 2 | Dev 3, Dev 4 |
| `docs/CONTRACTS.md` | change author | other consumers |
| `convex/allocations.ts` | Dev 2 | — |
| `convex/agents/*` | Dev 3 | Dev 2 (auth) |
| `convex/research/*` | Dev 4 | Dev 2 (jobs) |
| `convex/payments/*` | Dev 2 + Dev 4 pair | Dev 1 (status) |
| `app/*`, `components/*` | Dev 1 | — |

Do not reformat files you do not own.

## Pair-programming needs

- Hour 0–1: all four on contracts (no laptops-closed monologue; 45 minutes).
- BE-006 + AI-004: privacy pair.
- BE-009: Dev 2 solo tests, Dev 1 watches one infeasible UI case.
- BE-015 + RC-010: pair if P1-B starts.
- Demo rehearsal: Dev 1 drives, Dev 2 on second phone.

## Testing responsibilities

| Area | Owner |
| --- | --- |
| Allocation / approvals / authz | Dev 2 |
| Zod / policy / tool allowlist | Dev 3 |
| Normalize / job idempotency / webhooks | Dev 4 |
| Browser happy path + failures | Dev 1 |
| Two-device privacy check | Dev 2 + Dev 1 at C2 |

## Demo ownership

- Script and driver: Dev 1
- Second device: Dev 2
- Agent quiet-mode and synthetic paste: Dev 3
- Live listing warmup: Dev 4
- Backup recording: Dev 1 + whoever is free at hour 30

## Fallback if someone falls behind

| If behind | Absorb |
| --- | --- |
| Dev 1 | Dev 3 builds a minimal HTML review table; skip map |
| Dev 2 | Dev 4 does not invent a second backend; pair on schema. Dev 1 stays on mocks one extra hour |
| Dev 3 | BE-014 manual clues; agent silent |
| Dev 4 | RC-001 fixtures labeled; skip P1-B entirely. Dev 2 still ships pledges |

Nobody silently takes over another workstream’s directory. Reassign at a checkpoint out loud.
