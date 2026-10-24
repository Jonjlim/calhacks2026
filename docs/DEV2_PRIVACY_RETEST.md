# Dev 2 privacy and allocation retest

- Date: 2026-10-24
- Owner: Dev 2 (backend, authorization and query filters)
- Branch: `dev2/feat-privacy-retest`
- Result: no confirmed leak of private text, caps, recipient data, or provider IDs through public queries. Four Dev 2 issues are fixed (F-0 `votes.clearVote`, F-1 room return shape, F-2 media deletion, F-3 capture work list). The remaining open items are low or informational, or belong to other workstreams; none of them blocks the P0 demo.

## Scope

Every `query`, `mutation`, and `httpAction` exported under `convex/` (68 public endpoints in 17 modules), checked against `AGENTS.md`, `docs/DATA_AND_PRIVACY.md` (permissions table, component read matrix, threat scenarios), and `docs/CONTRACTS.md`. Internal functions were checked only to confirm that they are registered as `internal*` and cannot be called from a client.

## Method

1. Read every public handler. For each one, checked the auth and membership gate, the row-owner check, which fields come back, input validation, whether caller-supplied participant IDs are trusted, and whether table scans are bounded by an index.
2. `convex/privacyRetest.test.ts` seeds a room through public mutations. Alice is the organizer and Bob is a contributor. The seed contains a private paste and proposed clues for each of them, one published clue, an uploaded photo for Alice, caps of 5678 and 1234 cents, a fixture listing, a selection, both approvals, a recipient profile with preferences, and an authorized sandbox payment attempt for each payer with its provider object ID. The test then:
   - calls all 24 public read endpoints as Bob, Alice, Eve (an outsider), and an anonymous client. It asserts that the serialized output contains none of the other member's private text, proposed clue text, source, message, job, attempt, or storage IDs, cap amount (as a JSON number or as `$12.34`), recipient preference text, profile ID, or `pi_…` provider IDs;
   - asserts that Eve and the anonymous client get `unauthorized` or `not_found` from all 21 room-scoped reads;
   - calls 36 room mutations as Eve and as the anonymous client, and 18 owner-only or organizer-only mutations as Bob against Alice's rows. Each call must fail, and a snapshot of 23 tables must be byte-identical before and after;
   - checks that the infeasible-proposal text in conditions, `createProposal`, `approveRevision`, `getProposal`, and `listRevisions` contains no participant names and no cap amounts.
3. `convex/allocations.property.test.ts` adds seeded property checks for `allocate()` and runs the proposal engine end to end (see the allocation section below).
4. Ran `npm run typecheck` and `npx vitest run` on the full suite.

## Endpoint results

The auth column uses these abbreviations: **M** means `requireMember` or `getMembership` (non-members get `unauthorized`, a missing room gets `not_found`). **O** means a row-owner check. **Org** means organizer only. **U** means a signed-in user. **S** means the bearer secret is compared in constant time. **Env** means the endpoint is gated by an environment flag. A PASS result means the test above covers the endpoint and no leak was found.

| Endpoint | Owner | Auth | Leak check | Result |
| --- | --- | --- | --- | --- |
| rooms.createRoom | Dev 2 | U | Room doc without `recipientProfileId` | **FIXED F-1** |
| rooms.joinRoom | Dev 2 | U + token | Room doc without `recipientProfileId` | **FIXED F-1** |
| rooms.getRoom | Dev 2 | M | `toRoom` and `toParticipant` (contract fields only) | PASS |
| rooms.listMyRooms | Dev 2 | U | Caller's own memberships only | PASS |
| rooms.getInvite | Dev 2 | M | Token and path | PASS |
| rooms.previewInvite | Dev 2 | Token | 6 fields: title, recipient, occasion, count, roomId, alreadyMember | PASS |
| messages.sendMessage | Dev 2 | M | Length and idempotency validated; author bound to the caller | PASS |
| messages.listMessages | Dev 2 | M | Raw chat docs (room-visible) | PASS, info F-7 |
| clues.importEvidence / deleteEvidence | Dev 2 | M / M+O | Owner only; non-owners get `not_found` | PASS |
| clues.listMyEvidence / getMyEvidenceMessages | Dev 2 | M / M+O | Indexed by room and caller | PASS |
| clues.listMyProposedClues | Dev 2 | M | `by_room_participant` with the caller | PASS |
| clues.edit/reject/publishProposedClue | Dev 2 | M+O | Non-owners get `not_found` | PASS |
| clues.listPublishedClues | Dev 2 | M | Returns `sourceMessageIds` and `proposedClueId` | PASS, low F-5 |
| clues.withdrawClue | Dev 2 | M + publisher | Organizer cannot withdraw another member's clue | PASS |
| clues.upsertManualPreference | Dev 2 | M | Text validated | PASS |
| jobs.listRoomJobs | Dev 2 | M | Other members' extract jobs hidden; projected fields only | PASS |
| votes.castVote / listVotes | Dev 2 | M | Tallies plus the caller's own vote | PASS |
| votes.clearVote | Dev 2 | M | Returned another room's tally | **FIXED F-0** |
| proposals.selectGift / clearSelection | Dev 2 | M+Org | Listing must be in this room; frozen revisions refused | PASS |
| proposals.getSelection | Dev 2 | M | Room-visible snapshot | PASS |
| proposals.setContributionLimit | Dev 2 | M | `isMoney` (non-negative safe integer, at most 1e8); bound to the caller | PASS |
| proposals.getMyContributionLimit | Dev 2 | M | Caller's own cap only | PASS |
| proposals.createProposal / getProposal | Dev 2 | M | Shares, approvals, and the caller's own limit only | PASS |
| proposals.listRevisions | Dev 2 | M | Frozen shares; infeasible text is generic | PASS, info F-8 |
| proposals.approveRevision / withdrawApproval | Dev 2 | M | Current revision only; bound to the caller's approval row | PASS |
| payments.state.getPaymentStatus | Dev 2 | M | Group counts plus the caller's attempt; no provider IDs | PASS |
| payments.state.beginAuthorization | Dev 2 | Env+M | Caller's own share and attempt | PASS |
| payments.state.beginCapture | Dev 2 | Env+M+Org | Work list carries attempt IDs, amounts, and idempotency keys; no provider IDs | **FIXED F-3** |
| payments.state.cancelPayments | Dev 2 | Env+M+Org | Revision IDs only | PASS |
| payments.state.cancelMyAuthorization | Dev 2 | Env+M+O | Caller's own attempt only | PASS |
| media.generateEvidenceUploadUrl | Dev 2 (BE-018) | M | Upload URL | PASS |
| media.importMediaEvidence | Dev 2 (BE-018) | M | Rejections delete only unclaimed files bound to the caller's own upload grants; non-members delete nothing | **FIXED F-2** |
| agents.extract.extractClues | Dev 3 | M+O | Non-owners refused | PASS |
| agents.buyer.requestTurn / answerQuestion / abandonQuestion | Dev 3 | M | Validated slot and body | PASS |
| agents.buyer.setChatMode | Dev 3 | M+Org | — | PASS |
| agents.buyer.listActivity | Dev 3 | M | Other members' extract jobs and model usage hidden; env exposed only as booleans | PASS |
| agents.buyer.retryJob | Dev 3 | M + job owner | — | PASS |
| agents.recipient.createProfile | Dev 3 | Env+M+Org | Profile ID returned to the owner | PASS |
| agents.recipient.updateRecipientPreferences / getMyProfile | Dev 3 | Profile owner | Zod-validated; owner only | PASS |
| agents.stats.getRoomStats | Dev 3 | M | Counts; the caller's own model usage and clue counts | PASS |
| research.research.startResearch | Dev 4 | M | Published clues from this room only | PASS |
| research.research.listRecommendations | Dev 4 | M | Listings and recommendations (room-visible) | PASS |
| research.research.invalidateListing | Dev 4 | M+Org | — | PASS |
| worlds.shareWorld / unshareWorld | Dev 3 | M+Org | Anonymized; no room or user IDs | PASS |
| worlds.getMyWorldShare | Dev 3 | M | `publicView` | PASS |
| worlds.listWorlds | Dev 3 | U | `publicView`; no room, user, or invite data | PASS |
| worlds.seedSampleWorlds | Dev 3 | Env+U | Samples only | PASS |
| demo.seedFixturePool | Dev 3 | Env+M+Org | Fixture listings | PASS |
| councilRoom.start / resume / state | Dev 1+3 | M | Active published clues only; events validated with Zod | PASS |
| council.demoState | Dev 1+3 | None (demo key) | Display summaries and charms keyed by an unguessable demo key | PASS, info |
| council.runsHttp / eventsHttp / researchHttp | Dev 1+3 | S | Zod strict bodies; 16 KB cap | PASS |
| councilRoom.resultsHttp / researchHttp | Dev 1+3 | S | Zod strict bodies; `researchHttp` has no explicit size cap | low F-4 |

Internal surface: every agent, research, payment-adapter, clue-writer, job-status, council, and cleanup writer is registered as `internalMutation`, `internalQuery`, or `internalAction`. Public endpoints that work without an identity (`previewInvite`, `council.demoState`) return no agent-capable handle. Unauthenticated calls to agent endpoints fail `getMembership`.

Indexes: no public or internal query scans a whole table. Every `.collect()` in a public handler is bounded by a `roomId`, `revisionId`, `sourceId`, `profileId`, or caller index. Post-index `.filter()` calls (`listActivity`, `getRoomStats`) are capped with `take`.

## Findings

| ID | Severity | Location | Owner | Issue | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F-0 | Medium | `convex/votes.ts:53-66` | Dev 2 | `clearVote` did not check that the listing belongs to `roomId`. A member of any room could read another room's vote tally by passing its listing ID. | Require `listing.roomId === roomId` and return `not_found` otherwise. | **Fixed** (regression test in `privacyRetest.test.ts`) |
| F-1 | Medium | `convex/rooms.ts:89`, `:115`, `:131` | Dev 2 (rooms worker) | `createRoom` and `joinRoom` return the raw `Doc<"rooms">`. After a recipient profile exists, any joiner, or an existing member who re-joins, receives `recipientProfileId` (a `recipient_authorized` handle) and `agentChatMode`. | Return `toRoom(room)` and `toParticipant(...)` (contract `Room` and `Participant`), as `getRoom` already does. | **Fixed**: both mutations strip `recipientProfileId` from the returned room doc (`clientRoomDoc` in `rooms.ts`) and keep the rest of the doc shape for existing callers. Test `joinRoom does not return the recipient profile id` is now active. |
| F-2 | Medium | `convex/media.ts:64-75`, `:93` | Dev 2 (BE-018; first implementation by Dev 3) | `discardUploads` deletes every `storageId` passed in, including on the "already in use" rejection path and on the non-member path. A caller who knows another member's claimed storage ID can delete that file before the extractor reads it. This is an integrity and denial-of-service issue, not a disclosure. It was confirmed in a scratch test, and exploiting it requires an unguessable storage ID. | Delete only storage IDs that no `evidenceMedia` row claims (check `by_storage`), and do not delete files on the membership-failure path. | **Fixed** by BE-018: the membership failure returns before any delete, and rejections delete only unclaimed files bound to the caller's own unused upload grants (`media.test.ts`). |
| F-3 | Low | `convex/payments/state.ts:232-253` | Dev 2 + Dev 4 | The `beginCapture` work list returns every payer's `providerObjectId` to the organizer's client. The data and privacy doc says peers see group status, not instruments. A PaymentIntent ID is not a credential, but it identifies another payer's payment object. | When the Dev 4 adapter lands, return only `attemptId`s and let the server-side adapter resolve provider IDs through `internal.payments.state.getAttempt`. This is a contract change, so it needs a team check. | **Fixed**: `CaptureIntent` no longer carries `providerObjectId` (CONTRACTS.md updated). No consumer exists yet because the payment adapter is not built (Dev 4 chose no-pay), so nothing breaks. |
| F-4 | Low | `convex/councilRoom.ts:18`, `:213` | Dev 1 + Dev 3 | `authorized()` uses `replace(/^Bearer /, "")`, so it also accepts the raw secret without the `Bearer ` prefix. `researchHttp` calls `request.json()` with no size cap. | Require the `Bearer ` prefix as `council.ts` does, and read the body with a length cap. | Open |
| F-5 | Low | `convex/clues.ts:347-357`, `:399` | Dev 2 | Published clues expose `sourceMessageIds` (IDs of the publisher's private messages) and `proposedClueId`. Only IDs leak, not text, and no public endpoint resolves them for non-owners. | Consider projecting these out of `listPublishedClues` if the UI does not need them. That would change the contract (`PublishedClue.sourceMessageIds`), so it needs a team check. | Open (accepted for P0) |
| F-6 | Low (perf) | `convex/cleanup.ts:18-31` | Dev 3 | The sweep takes the oldest 100 files and skips claimed ones. If 100 or more old files are claimed, every run returns the same batch, and newer stale uploads are never deleted. | Paginate with a cursor, or advance the lower bound past the last claimed `_creationTime`. | Open |
| F-7 | Info | `convex/messages.ts:84` | Dev 2 | `listMessages` returns raw chat docs, including `clientIdempotencyKey` (answer keys embed the participant ID, which is already room-visible) and `responseAgentJobId`. No private data is exposed. | Optionally project the contract fields. | Open (accepted) |
| F-8 | Info | `convex/lib/proposalEngine.ts` (design) | Dev 2 | Peers see frozen shares, as documented. When a participant's cap binds, that participant's share equals the cap, so peers can infer the cap. This follows from the documented rule that peers see frozen shares. | Product decision. If it matters, show peers only "your share" plus feasibility. | Open (documented behavior) |

Checklist items with no findings:
- The organizer cannot read contributor imports, proposed clues, caps, or payment attempts (tested).
- Infeasible text is always `INFEASIBLE_CAPS_MESSAGE` or a listing reason, with no names or amounts (tested).
- No mutation trusts a client-supplied participant ID. Every write binds to `member.me._id` (tested).
- Money inputs reject negative, fractional, and over-limit values.
- HTTP secrets are compared in constant time, and secrets shorter than 16 characters are refused.

## Allocation retest

`convex/allocations.property.test.ts` uses a seeded mulberry32 PRNG and adds no new dependencies.

- **Exhaustive checks:** every cap vector for 1 to 3 people with caps 0 to 6 and totals 1 to 20 (7,980 cases), plus 4 people with caps 0 to 4 and totals 1 to 17 (10,625 cases). Each result is compared with an independent water-filling reference: the highest level L, then one leftover cent each to participants in order whose cap is above L.
- **Random checks:** 5,000 rooms with 1 to 8 people, mixed small and large caps, and totals at, below, and above capacity. Each must satisfy:
  - shares sum exactly to the total;
  - no share is negative or above its cap;
  - the result is infeasible if and only if the caps sum to less than the total;
  - fairness: a participant with spare capacity is never more than 1 cent behind anyone;
  - leftover-cent priority goes to the organizer first, then join order;
  - the same input gives the same output, and the input is not mutated.
- **Feasibility boundary:** at total equal to capacity the result is feasible; at capacity + 1 it is infeasible (2,000 cases).
- **Invalid input:** negative, fractional, NaN, Infinity, and unsafe-integer totals or caps; zero total; an empty participant list; and duplicate participant IDs all return `invalid_input`.
- **Proposal engine end to end:** 6 seeds × 40 steps of random `setContributionLimit` calls (including repeats of the same cap) and approvals, run against the real schema with 3 members. After every step:
  - shares equal `allocate()` over the tracked caps;
  - feasibility matches;
  - an unchanged deal keeps the same revision ID and the same approvals;
  - changed shares mint revision n+1, mark n `superseded`, and leave no `pending` or `approved` approvals on n;
  - revision numbers are contiguous;
  - every non-current revision is superseded;
  - a feasible revision has exactly one approval per participant, and its status is `approved_pledged` exactly when all of them have approved.

  Each seed must exercise the minted, unchanged, and approval paths.

No allocation or engine bug was found.

## Validation

- `npm run typecheck`: pass.
- `npx vitest run`: 44 files passed and 1 skipped; 434 tests passed and 3 skipped (the live-smoke tests). The F-1 test is now active.
