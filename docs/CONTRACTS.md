# Contracts

Shared interfaces for parallel work. These TypeScript shapes are documentation, not compiled code. When implementation starts, copy them into `lib/contracts/` and keep this file authoritative for names and semantics.

Owners change this document in the same PR as the code. Consumers mock; they do not invent sibling types.

Related: [ARCHITECTURE.md](ARCHITECTURE.md), [AI_AGENTS.md](AI_AGENTS.md), [COMMERCE_AND_PAYMENTS.md](COMMERCE_AND_PAYMENTS.md), [TEAM_TASKS.md](TEAM_TASKS.md).

## Conventions

### Member 3 implementation additions (2026-10-24)

Owner: Dev 3; consumers: Dev 1 (agent controls/activity), Dev 2 (chat hook), Dev 4 (research jobs).
Existing names remain compatible; additions below are optional unless creating a new agent operation.

- `agents/buyer.requestTurn({ roomId, mode?: "quiet" | "auto" }) -> Result<{ jobId }>` checks membership, snapshots the latest human message and knowledge revision, deduplicates, then schedules evaluation. Quiet is the default; only `@unwrap` triggers a response. `messages.sendMessage` calls `enqueueBuyerTurn(ctx, roomId, participantId, mode)` after inserting a human message in the same mutation. No polling or recursive agent chat.
- `agents/buyer.answerQuestion({ roomId, slot, body, clientIdempotencyKey }) -> Result<{ messageId, jobId }>` records a human answer and closes the open slot atomically. `abandonQuestion({ roomId, slot })` closes an obsolete question. Slots are restricted to budget, exclusions, occasion, already_owns, size, timing, direction.
- `agents/buyer.listActivity({ roomId })` returns bounded, room-safe `AgentEvent[]` and open questions. Private extraction events are visible only to their contributor. Events contain fixed summaries, never model rationale, private source text, grants, or preference IDs.
- `agents/buyer.retryJob({ jobId }) -> Result<{ jobId }>` allows the acting member to retry failed/uncertain work once. Status claims, attempt fencing, input revision checks, and a watchdog prevent duplicate/late effects.
- `AgentJob` gains optional `actingParticipantId`, `sourceId`, `sourceRevision`, `latestMessageId`, `knowledgeRevision`, `mode`, `startedAt`, `finishedAt`, `inputVersion`. Buyer jobs index a short `inputHash` and compare the full immutable-ID version token as well; a lookup collision cannot accept stale effects. `AgentDecision` gains optional `searchBrief`, `recipientQuery`, and `citations: { listingIds, publishedClueIds }`. Model payloads omit server-owned IDs/timestamps.
- `AgentEvent = { id, roomId, jobId, actor: "buyer" | "extractor" | "research_planner" | "recipient", kind: "started" | "question" | "handoff" | "completed" | "failed" | "stale", summary, createdAt }`. Storage adds optional `participantId` for private events. Job details remain server-only.
- `AskedSlot` storage adds optional `answeredByMessageId`. Answering or abandoning a slot also invalidates an in-flight turn via its input fingerprint.
- Extraction retains `extractClues({ sourceId }) -> Result<{ jobId }>`; only an owning member can enqueue. Proposed-clue writes and job completion are atomic and recheck ownership, source revision, message references, and active contradiction IDs.
- `agents/recipient.createProfile({ roomId }) -> Result<{ recipientProfileId }>` creates a room-linked profile owned by the authenticated identity. For the hackathon only, gated by server `RECIPIENT_AGENT_DEMO_ENABLED=true`, an organizer can act as a synthetic recipient operator. This is not recipient consent for real data.
- `updateRecipientPreferences({ recipientProfileId, preferences, grants })` replaces that owner's authorized records. Owner-only reads via `getMyProfile({ roomId })`; room membership never grants access to other profiles. Empty records/grants revoke access. `RecipientGrant` stores question-type allowlists. Only authorized **and disclosable** rows reach the model; non-disclosable rows produce no disclosure. No model-written free text crosses this boundary.
- `queryRecipientAgent` is internal-only and bound to the current buyer job, room-linked profile, query ID, and permission grants. A validated verdict produces fixed guidance. The buyer records a room-safe result chip, never publishes a clue automatically. One recipient query per turn; no unbounded conversation. Profile revision is checked at commit, so revoked/replaced grants invalidate an in-flight reply.
- Buyer search produces a `ResearchJob` with the existing `SearchBrief` and schedules `internal.research.research.runResearch({ jobId })`. Dev 4 owns execution/completion. Neither private imports nor contribution caps enter this brief.

Migration: additive optional fields on existing tables, new `agentEvents`, `recipientProfiles`, `recipientPreferences`, and `recipientGrants` tables. Existing UI mocks remain valid. Dev 1 wires the public operations; the P0 chat enqueue hook is integrated; Dev 4 consumes the existing research job runner.

- IDs are opaque strings here; they become Convex `Id<"table">` later.
- Money: `amountMinor: number` (integer cents) + `currency: "USD"`.
- Timestamps: unix milliseconds.
- Expected errors: `unauthorized` | `not_found` | `invalid_revision` | `infeasible` | `stale_job` | `provider_timeout` | `validation_failed` | `refused` | `unknown`.
- All list queries are membership-scoped to `roomId`.

## Error shape

```ts
interface AppError {
  code:
    | "unauthorized"
    | "not_found"
    | "invalid_revision"
    | "infeasible"
    | "stale_job"
    | "provider_timeout"
    | "validation_failed"
    | "refused"
    | "unknown";
  message: string; // safe for UI
}
```

---

## Data contracts

### Room

**Owner:** Dev 2. **Consumers:** Dev 1, Dev 3, Dev 4.

```ts
interface Room {
  id: string;
  title: string;
  recipientDisplayName: string;
  occasion: string;
  deadlineAt?: number;
  currency: "USD";
  budgetMinor?: number;
  knowledgeRevision: number;
  currentRevisionId?: string;
  currentSelectionId?: string;
  latestMessageId?: string; // latest human chat message; part of the evaluate_thread inputHash
  inviteToken: string; // do not leak in agent snapshots
  createdBy: string;
  createdAt: number;
}
```

Access: members read; organizer updates metadata. `inviteToken` is for join, not for private data.

### Participant

**Owner:** Dev 2. **Consumers:** Dev 1, Dev 3.

```ts
interface Participant {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  role: "organizer" | "contributor";
  joinedAt: number;
}
```

### Chat message

**Owner:** Dev 2. **Consumers:** Dev 1, Dev 3.

```ts
interface ChatMessage {
  id: string;
  roomId: string;
  authorKind: "participant" | "buyer_agent";
  participantId?: string;
  body: string;
  createdAt: number;
  clientIdempotencyKey: string;
}
```

### Evidence source

**Owner:** Dev 2 (store), Dev 3 (analyze). **Consumers:** Dev 3.

```ts
interface EvidenceSource {
  id: string;
  roomId: string;
  participantId: string;
  kind: "paste" | "text_export";
  label: string;
  sourceRevision: number;
  createdAt: number;
}

interface PrivateMessage {
  id: string;
  sourceId: string;
  participantId: string;
  body: string;
  saidAt?: number;
  speakerHint?: string;
}
```

Access: owner only, plus extractor action as that owner.

### Proposed clue

**Owner:** Dev 2 (store), Dev 3 (producer). **Consumers:** Dev 1 (review UI).

```ts
interface ProposedClue {
  id: string;
  roomId: string;
  participantId: string;
  sourceId: string;
  sourceMessageIds: string[];
  kind:
    | "interest"
    | "explicit_wish"
    | "exclusion"
    | "ownership"
    | "timing"
    | "uncertain";
  text: string;
  confidence: number;
  speakerAssumption: "recipient" | "other" | "unknown";
  contradictsClueIds: string[];
  status: "proposed" | "edited" | "rejected" | "published" | "source_withdrawn";
  createdAt: number;
}
```

### Published clue

**Owner:** Dev 2. **Consumers:** Dev 1, Dev 3, Dev 4.

```ts
interface PublishedClue {
  id: string;
  roomId: string;
  proposedClueId?: string;
  publisherId: string;
  kind: ProposedClue["kind"];
  text: string;
  sourceKind: "paste" | "import" | "chat" | "manual";
  sourceMessageIds: string[];
  excerpt?: string;
  status: "active" | "withdrawn" | "source_withdrawn";
  publishedAt: number;
}
```

### Recipient-approved preference (P1-A)

**Owner:** Dev 3. **Consumers:** recipient-agent action only.

```ts
interface RecipientPreference {
  id: string;
  recipientProfileId: string;
  roomId?: string; // optional link
  category: "interest" | "dislike" | "ownership" | "size" | "constraint";
  text: string;
  disclosable: boolean;
  authorized: boolean;
  createdAt: number;
}

interface RecipientGrant {
  recipientProfileId: string;
  category: RecipientPreference["category"];
  allowedQuestionTypes: Array<"suitability" | "ownership" | "constraint">;
}
```

Buyer-room clients do not query these tables.

### Agent decision

**Owner:** Dev 3. **Consumers:** Dev 1 (optional debug), Dev 2 (job status).

```ts
type AgentIntent =
  | "listen"
  | "clarify"
  | "extract"
  | "search"
  | "recommend"
  | "query_recipient"
  | "wait";

interface AgentDecision {
  jobId: string;
  roomId: string;
  intent: AgentIntent;
  rationale: string;
  chatMessage?: string;
  clarifySlot?: string;
  extractSourceId?: string;
  needsFollowup: boolean;
  createdAt: number;
}
```

### Agent-to-agent request and response (P1-A)

**Owner:** Dev 3. **Consumers:** Dev 4 (ranking may read sanitized replies).

```ts
interface AgentQuery {
  id: string;
  roomId: string;
  type: "suitability" | "ownership" | "constraint";
  subject: {
    kind: "category" | "product";
    label: string;
    listingId?: string;
  };
  askedByJobId: string;
}

interface AgentReply {
  queryId: string;
  status: "answered" | "unknown" | "refused";
  suitability?: "yes" | "no" | "mixed";
  guidance?: string;
  usedPreferenceIds: string[];
  policy: { allowed: boolean; reason?: string };
}
```

Errors: `refused` for policy, `validation_failed` for bad bodies. Never throw raw preference text.

### Product listing

**Owner:** Dev 4. **Consumers:** Dev 1, Dev 2 (selection snapshot), Dev 3 (explain).

```ts
interface ProductListing {
  id: string;
  roomId: string;
  jobId: string;
  source: "apify" | "shopping_api" | "manual_fixture";
  sourceUrl: string;
  title: string;
  variant?: string;
  currency: "USD";
  priceMinor?: number;
  priceStatus: "observed" | "unknown";
  availability: "in_stock" | "limited" | "unavailable" | "unknown";
  shippingMinor?: number;
  shippingStatus: "observed" | "unresolved" | "unknown";
  imageUrl?: string;
  sellerName?: string;
  retrievedAt: number;
  status: "active" | "invalid" | "stale";
}
```

### Product normalization helpers (RC-001 / RC-003)

**Owner:** Dev 4. **Consumers:** Dev 4 research action; Dev 1/2/3 receive the unchanged ProductListing shape.

- `normalizeListing(raw, retrievedAt, context?)` returns ProductListing fields without IDs/status, or null. Context is trusted server-side US query localization (`{ country: "us" }`), never model-provided currency.
- `normalizeDataset(raw, retrievedAt)` reads the verified Actor's page envelopes, accepts only `search_parameters.gl === "us"`, skips malformed rows, and deduplicates identical product/seller/title observations within one dataset.
- No schema migration or client endpoint changes. USD must be established by explicit currency, explicit USD price label, or validated US query context. Explicit foreign currency is rejected.
- Exact nonnegative prices become safe integer cents. Ambiguous, conflicting or invalid prices remain unknown with no amount. Stock and shipping stay unknown for this provider.
- Preserve bundle/size text. Source links remain the observed Google Shopping URLs; they are not merchant checkout links.
- Provider-only fields, opaque page tokens, and helper URLs never enter normalized listings.

### Recommendation

**Owner:** Dev 4. **Consumers:** Dev 1, Dev 3.

```ts
interface Recommendation {
  id: string;
  roomId: string;
  listingId: string;
  publishedClueIds: string[];
  score: number;
  personalRelevance: number;
  budgetFit: number;
  trendSignal: number; // 0 unless sourced
  explanation: string;
  createdAt: number;
}
```

### Gift selection

**Owner:** Dev 2. **Consumers:** Dev 1, Dev 4 (invalidation).

```ts
interface GiftSelection {
  id: string;
  roomId: string;
  listingId: string;
  quantity: 1;
  listingSnapshot: Pick<
    ProductListing,
    "title" | "sourceUrl" | "priceMinor" | "priceStatus" | "retrievedAt"
  >;
  status: "active" | "cleared";
  selectedBy: string;
  selectedAt: number;
}
```

### Contribution

**Owner:** Dev 2. **Consumers:** Dev 1 (own cap + frozen shares).

```ts
interface ContributionLimit {
  participantId: string;
  roomId: string;
  amountMinor: number;
  updatedAt: number;
}

interface AllocationShare {
  participantId: string;
  amountMinor: number;
}
```

Peers do not read `ContributionLimit`. They read `AllocationShare` on a frozen revision.

### Proposal revision

**Owner:** Dev 2. **Consumers:** Dev 1, Dev 4 (P1-B).

```ts
interface ProposalRevision {
  id: string;
  roomId: string;
  selectionId: string;
  listingId: string;
  quantity: 1;
  payableTotalMinor: number;
  currency: "USD";
  shares: AllocationShare[];
  conditions: string[];
  status:
    | "draft"
    | "awaiting_approval"
    | "approved_pledged"
    | "infeasible"
    | "superseded"
    | "authorizing"
    | "ready_to_capture"
    | "capturing"
    | "test_funded"
    | "blocked"
    | "recovery_pending"
    | "canceled";
  createdAt: number;
  expiresAt?: number;
}
```

P1 statuses appear only if payments are enabled.

### Approval

**Owner:** Dev 2. **Consumers:** Dev 1.

```ts
interface Approval {
  id: string;
  roomId: string;
  revisionId: string;
  participantId: string;
  status: "pending" | "approved" | "invalidated" | "withdrawn";
  updatedAt: number;
}
```

### Payment attempt (P1-B)

**Owner:** Dev 2 (document), Dev 4 (adapter). **Consumers:** Dev 1 (truthful status).

```ts
interface PaymentAttempt {
  id: string;
  roomId: string;
  revisionId: string;
  participantId: string;
  provider: "stripe_test";
  providerObjectId?: string;
  idempotencyKey: string;
  status:
    | "not_started"
    | "authorization_pending"
    | "authorized"
    | "authorization_failed"
    | "capture_pending"
    | "captured"
    | "cancellation_pending"
    | "canceled"
    | "refund_pending"
    | "refunded"
    | "action_required"
    | "uncertain";
  createdAt: number;
}
```

### Agent / research job status

**Owner:** Dev 2 (table), Dev 3 / Dev 4 (writers). **Consumers:** Dev 1.

```ts
type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "stale"
  | "canceled"
  | "uncertain";

interface AgentJob {
  id: string;
  roomId: string;
  kind: "evaluate_thread" | "extract" | "recipient_query";
  status: JobStatus;
  inputHash: string;
  idempotencyKey: string;
  attempt: number;
  lastError?: string;
  createdAt: number;
}

interface ResearchJob {
  id: string;
  roomId: string;
  knowledgeRevision: number;
  brief: SearchBrief;
  status: JobStatus;
  inputHash: string;
  idempotencyKey: string;
  attempt: number;
  lastError?: string;
  createdAt: number;
}

interface SearchBrief {
  roomId: string;
  knowledgeRevision: number;
  queryTerms: string[];
  mustExclude: string[];
  budgetMinor?: number;
  occasion?: string;
  listingLimit: number;
}

interface AskedSlot {
  id: string;
  roomId: string;
  slot: string;
  messageId?: string;
  status: "open" | "answered" | "abandoned";
  askedAt: number;
}
```

---

## Operation contracts

Each operation lists owner, consumers, input, output, access, and errors so another developer can mock it.

Every Convex query and mutation returns `Result<T>` (`{ ok: true, value }` or `{ ok: false, error: AppError }`) from `lib/contracts`. Expected failures never throw.

### `createRoom`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ title, recipientDisplayName, occasion, deadlineAt?, budgetMinor?, displayName? }` (`displayName` is the organizer's participant name) |
| Output | `{ room, participant, inviteToken }` |
| Access | Authenticated user |
| Errors | `validation_failed` |

### `joinRoom`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ inviteToken, displayName }` |
| Output | `{ room, participant }` |
| Access | Authenticated user with token |
| Errors | `not_found`, `unauthorized` |

Token does not reveal private rows.

### `sendMessage`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1, Dev 3 (triggers evaluate) |
| Input | `{ roomId, body, clientIdempotencyKey }` |
| Output | `ChatMessage` |
| Access | Room member |
| Errors | `unauthorized`, `validation_failed` |

May enqueue `AgentJob` `evaluate_thread`.

### `importEvidence`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1, Dev 3 |
| Input | `{ roomId, kind, label, rawText }` |
| Output | `{ source: EvidenceSource, messages: PrivateMessage[] }` |
| Access | Caller becomes owner |
| Errors | `unauthorized`, `validation_failed` |

### `extractClues`

| | |
| --- | --- |
| Owner | Dev 3 |
| Consumers | Dev 1 |
| Input | `{ sourceId }` |
| Output | `{ jobId }` then `ProposedClue[]` on the owner query |
| Access | Source owner |
| Errors | `unauthorized`, `validation_failed`, `provider_timeout` |

### `publishClue` / `withdrawClue`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1, Dev 3, Dev 4 (revision bump) |
| Input | `{ proposedClueId, excerpt? }` / `{ publishedClueId }` |
| Output | `PublishedClue` |
| Access | Owner of the proposed clue |
| Errors | `unauthorized`, `not_found` |

Increments `room.knowledgeRevision`.

### `upsertManualPreference`

P0 manual room clue for preferences/exclusions without an import.

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ roomId, kind, text }` |
| Output | `PublishedClue` with `sourceKind: "manual"` |
| Access | Room member |
| Errors | `unauthorized`, `validation_failed` |

### `updateRecipientPreferences` (P1-A)

| | |
| --- | --- |
| Owner | Dev 3 |
| Consumers | Demo operator UI (Dev 1 if built) |
| Input | `{ recipientProfileId, preferences, grants }` |
| Output | `{ preferences, grants }` |
| Access | Recipient identity or demo operator |
| Errors | `unauthorized`, `validation_failed` |

### `startResearch`

| | |
| --- | --- |
| Owner | Dev 4 (action), Dev 2 (job row) |
| Consumers | Dev 1, Dev 3 |
| Input | `{ roomId, publishedClueIds, budgetMinor?, idempotencyKey }` |
| Output | `{ jobId }` |
| Access | Room member |
| Errors | `unauthorized`, `stale_job`, `provider_timeout` |

### Research execution semantics (RC-004 / RC-006)

**Owner:** Dev 4. Uses Dev 2's requireMember and insertResearchJob helpers. Client endpoint signatures are unchanged.

- startResearch validates active same-room published clues and integer-cent budgets, then uses buildSearchBrief. Reusing a request key with changed inputs is validation_failed. Matching open input fingerprints reuse the existing job.
- Storage adapter for the existing searchBrief validator: omit roomId from researchJobs.brief because it already lives on researchJobs; restore it when calling the provider. Shared SearchBrief still includes roomId. This is explicit compatibility handling, not a schema migration.
- Pending job insertion and worker scheduling occur in one mutation. The provider uses verified Actor build 0.0.142, one US search page, 120-second provider timeout and a $0.20 maximum run charge.
- Only pending jobs can claim a provider start. Network ambiguity becomes uncertain; no automatic paid POST retry. Run IDs are retained in durable scheduled poll arguments. If a start response is lost before returning the run ID, operators must check Apify Console; automatic run discovery/reconciliation is not implemented.
- Completion inserts normalized listings and succeeds atomically, at most once. It rejects changed knowledgeRevision or any newer research request. Ordering uses the room index's creation-order suffix, not completion time.
- listRecommendations uses the latest successful request among the 50 most recent room jobs. While a refresh is pending/failed, the previous successful candidate pool remains available. It re-ranks against all current active clues on each read, includes only visible ranked listings, and does not trust stored recommendation rows. Changing clues after a successful search can update the ranking without another provider run.
- Query recommendations have stable derived IDs (job ID + listing ID) and request timestamps. Product retrievedAt is the observed retrieval time; clients compute price-age labels from it.
- Research-specific claim/completion/poll mutations live in research.ts. Dev 2's generic jobs.ts and schema are unchanged. Research timeouts cannot restart the paid provider automatically.

### `listRecommendations`

| | |
| --- | --- |
| Owner | Dev 4 |
| Consumers | Dev 1 |
| Input | `{ roomId }` |
| Output | `{ recommendations: Recommendation[], listings: ProductListing[] }` |
| Access | Room member |
| Errors | `unauthorized` |

### `research.invalidateListing` (RC-007)

**Owner:** Dev 4. **Consumers:** Dev 1 (organizer control); verified server-side source checks use the internal equivalent.

- Public mutation input: `{ roomId, listingId }`; output: `Result<{ listingId, cleared: number }>`.
- Only that room's organizer may invalidate its listing. Outsiders and ordinary members get unauthorized; foreign-room/missing listing IDs get not_found.
- Uses `internal.proposals.clearSelectionsForListing` and marks the listing invalid in one transaction. A matching active selection is cleared, its proposal superseded, and live approvals invalidated. Existing deal snapshots remain for history.
- Returns invalid_revision without changing anything if the selected proposal is locked for payment. It does not cancel authorizations, capture, refund, or perform recovery.
- Repeating the operation returns cleared: 0 and cannot clear a different replacement gift. An unselected listing does not disturb the current proposal.
- `internal.research.research.invalidateListingInternal({ listingId })` provides the same behavior for trusted server code. It is not exposed as a model tool.
- Invalid listings disappear from recommendations and cannot be selected again. A clue mismatch or old price does not itself establish that a listing is invalid.
- This task adds the transition, not automatic stock verification, merchant URL probing, price refresh, or a frontend button. No schema migration or existing endpoint changes.

### `selectGift`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ roomId, listingId }` |
| Output | `{ selection, revision? }` |
| Access | Organizer confirms; any member may propose. P0 default: organizer `selectGift` |
| Errors | `unauthorized`, `not_found`, `invalid_revision` |

Selecting supersedes the prior revision. P0 implementation: organizer only; non-organizers get `unauthorized`. Selecting always recomputes the proposal and returns the resulting revision (possibly `infeasible`).

### `castVote` (optional P0)

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ roomId, listingId, value: "up" | "down" | "flag_duplicate" }` |
| Output | `{ listingId, tally }` |
| Access | Room member |
| Errors | `unauthorized` |

Advisory only.

### `setContributionLimit`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ roomId, amountMinor }` |
| Output | `{ limit: ContributionLimit, revision? }` |
| Access | Owning participant |
| Errors | `unauthorized`, `validation_failed`, `infeasible` |

Unset caps count as 0. When a gift is selected, saving a cap recomputes the proposal; `revision` is the current revision afterwards (new if shares changed, possibly `infeasible`). The write itself succeeds even when the proposal is infeasible.

### `createProposal` / `getProposal`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ roomId }` |
| Output | `{ revision, shares, approvals, feasible: boolean }` |
| Access | Members see frozen shares and own pending approval, not others’ caps |
| Errors | `infeasible`, `not_found` |

`createProposal` is idempotent: it returns the current revision when nothing material changed. When caps fall short it records an `infeasible` revision (no shares, public reason in `conditions[0]`) and returns `infeasible`. `not_found` means no gift is selected. Revisions are also recomputed automatically on `selectGift`, `setContributionLimit`, `joinRoom`, and listing invalidation. Every participant listed in `shares` must approve before the revision becomes `approved_pledged`.

### `approveRevision`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ revisionId }` |
| Output | `Approval` |
| Access | Participant approving their own share |
| Errors | `invalid_revision`, `unauthorized`, `infeasible` |

If `room.currentRevisionId !== revisionId`, `invalid_revision`.

### Additional Dev 2 operations (additive)

All are membership-checked and return `Result<T>`.

| Name | Kind | Input | Output | Access |
| --- | --- | --- | --- | --- |
| `rooms.listMyRooms` | query | `{}` | `{ roomId, title, role }[]` | Signed-in user |
| `rooms.getInvite` | query | `{ roomId }` | `{ inviteToken, joinPath }` (QR payload) | Member |
| `rooms.previewInvite` | query | `{ inviteToken }` | `{ roomId, title, recipientDisplayName, occasion, participantCount, alreadyMember }` | Token holder |
| `clues.getMyEvidenceMessages` | query | `{ sourceId }` | `PrivateMessage[]` | Source owner |
| `clues.listMyEvidence` | query | `{ roomId }` | `EvidenceSource[]` | Caller's own |
| `clues.deleteEvidence` | mutation | `{ sourceId }` | `null` | Source owner; tombstones dependents |
| `clues.editProposedClue` | mutation | `{ proposedClueId, text?, kind?, speakerAssumption? }` | `ProposedClue` (`edited`) | Clue owner |
| `clues.rejectProposedClue` | mutation | `{ proposedClueId }` | `ProposedClue` (`rejected`) | Clue owner |
| `proposals.getSelection` | query | `{ roomId }` | `GiftSelection \| null` | Member |
| `proposals.clearSelection` | mutation | `{ roomId }` | `null` | Organizer |
| `proposals.listRevisions` | query | `{ roomId }` | `ProposalRevision[]` (newest first) | Member |
| `proposals.withdrawApproval` | mutation | `{ revisionId }` | `Approval` (`withdrawn`) | Own approval, current revision |
| `votes.listVotes` | query | `{ roomId }` | `{ listingId, tally, myVote? }[]` | Member |
| `votes.clearVote` | mutation | `{ roomId, listingId }` | `{ listingId, tally }` | Member |
| `jobs.listRoomJobs` | query | `{ roomId }` | recent agent + research job statuses | Member; `extract` jobs only to their owner |

Server-only hooks for other workstreams (internal functions or helpers, not client-callable):

| Name | For | Purpose |
| --- | --- | --- |
| `internal.clues.getOwnEvidenceForJob({ jobId, sourceId })` | Dev 3 `getOwnEvidence` | Source, messages, and proposed clues, only for an open `extract` job acting as the source owner |
| `internal.clues.insertProposedClues({ jobId, sourceId, clues })` | Dev 3 `proposeClues` | Returns `{ insertedIds, dropped }`; drops clues citing messages outside the source |
| `internal.messages.postAgentMessage({ jobId, body })` | Dev 3 | One `buyer_agent` message per `evaluate_thread` job |
| `internal.jobs.setAgentJobStatus` / `setResearchJobStatus` | Dev 3 / Dev 4 | Enforced transitions; terminal states return `stale_job` |
| `enqueueAgentJob`, `insertResearchJob`, `agentInputHash`, `isResearchJobCurrent` (exported from `convex/jobs.ts`) | Dev 3 / Dev 4 | Create job rows inside your own mutation with `inputHash` / `idempotencyKey` dedupe |
| `internal.proposals.clearSelectionsForListing({ listingId })` | Dev 4 RC-007 | Clears a selection of an invalidated listing and supersedes its revision |

### `queryRecipientAgent` (P1-A)

| | |
| --- | --- |
| Owner | Dev 3 |
| Consumers | Buyer-agent action; Dev 4 ranking |
| Input | `AgentQuery` |
| Output | `AgentReply` |
| Access | Server action only |
| Errors | `refused`, `validation_failed` |

### Payment operations (P1-B)

| Name | Owner | Input | Output | Access | Errors |
| --- | --- | --- | --- | --- | --- |
| `createAuthorization` | Dev 4 + Dev 2 | `{ revisionId }` | hosted checkout payload | owning participant, revision current | `invalid_revision`, `unauthorized` |
| `captureRevision` | Dev 4 + Dev 2 | `{ revisionId, idempotencyKey }` | group status | organizer or controller | `invalid_revision`, `infeasible` |
| `cancelAuthorization` | Dev 4 | `{ attemptId }` | `PaymentAttempt` | server / owner | `not_found` |
| `reconcileEvent` | Dev 4 | signed provider event | void | HTTP webhook | ignore duplicates |

LLM-initiated payment operations are forbidden.

---

## Mock guidance

Until Convex exists, Dev 1 may use in-memory fixtures that satisfy the query shapes:

- `roomQuery(roomId) → Room + Participant[]`
- `chatQuery(roomId) → ChatMessage[]`
- `myProposedCluesQuery() → ProposedClue[]`
- `publishedCluesQuery(roomId) → PublishedClue[]`
- `recommendationsQuery(roomId) → { recommendations, listings }`
- `proposalQuery(roomId) → { revision, shares, approvals, myLimit? }`

Dev 3 may write extraction results as JSON fixtures matching `ProposedClue`.
Dev 4 may ship 3–6 `manual_fixture` listings labeled as fixtures, plus one live-normalized listing after the spike.

Do not silently promote fixtures to `source: "apify"`.
