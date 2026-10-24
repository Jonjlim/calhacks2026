# Contracts

Shared interfaces for parallel work. These TypeScript shapes are documentation, not compiled code. When implementation starts, copy them into `lib/contracts/` and keep this file authoritative for names and semantics.

Owners change this document in the same PR as the code. Consumers mock; they do not invent sibling types.

Related: [ARCHITECTURE.md](ARCHITECTURE.md), [AI_AGENTS.md](AI_AGENTS.md), [COMMERCE_AND_PAYMENTS.md](COMMERCE_AND_PAYMENTS.md), [TEAM_TASKS.md](TEAM_TASKS.md).

## Conventions

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

### `listRecommendations`

| | |
| --- | --- |
| Owner | Dev 4 |
| Consumers | Dev 1 |
| Input | `{ roomId }` |
| Output | `{ recommendations: Recommendation[], listings: ProductListing[] }` |
| Access | Room member |
| Errors | `unauthorized` |

### `selectGift`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ roomId, listingId }` |
| Output | `{ selection, revision? }` |
| Access | Organizer confirms; any member may propose. P0 default: organizer `selectGift` |
| Errors | `unauthorized`, `not_found`, `invalid_revision` |

Selecting supersedes the prior revision.

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

### `createProposal` / `getProposal`

| | |
| --- | --- |
| Owner | Dev 2 |
| Consumers | Dev 1 |
| Input | `{ roomId }` |
| Output | `{ revision, shares, approvals, feasible: boolean }` |
| Access | Members see frozen shares and own pending approval, not others’ caps |
| Errors | `infeasible`, `not_found` |

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
