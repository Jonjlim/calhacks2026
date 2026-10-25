# Contracts

Shared interfaces for parallel work. These TypeScript shapes are documentation, not compiled code. When implementation starts, copy them into `lib/contracts/` and keep this file authoritative for names and semantics.

Owners change this document in the same PR as the code. Consumers mock; they do not invent sibling types.

Related: [ARCHITECTURE.md](ARCHITECTURE.md), [AI_AGENTS.md](AI_AGENTS.md), [COMMERCE_AND_PAYMENTS.md](COMMERCE_AND_PAYMENTS.md), [TEAM_TASKS.md](TEAM_TASKS.md).

## Conventions

### Map-first room (proposed, D19, 2026-10-24)

**Status: proposed, not implemented.** Agree on these shapes at the next integration checkpoint before building MAP-007 onward ([TEAM_TASKS.md](TEAM_TASKS.md)).

Owners: Dev 2 (tables, projection, signals), Dev 3 (theme suggestion, sharpen), Dev 4 (theme links on recommendations). Consumers: Dev 1 and Ally (map and lobby UI).

```ts
type MapThemeStatus = "suggested" | "accepted" | "dismissed";

interface MapTheme {
  id: string;
  roomId: string;
  label: string;                    // 1–60 chars
  clueIds: string[];               // at least one; only active published clues
  status: MapThemeStatus;
  source: "agent" | "member";
  createdBy?: string;        // set when a member renamed, merged, or created it
  knowledgeRevision: number;        // room knowledge revision the theme was built from
  updatedAt: number;
}

type DirectionTarget =
  | { kind: "clue"; clueId: string }
  | { kind: "theme"; themeId: string };

interface DirectionSignal {          // one row per member per target
  roomId: string;
  participantId: string;
  target: DirectionTarget;
  value: 1 | -1;                    // 1 = pulled toward the box, -1 = pushed away
  updatedAt: number;
}

interface SharpenResult {
  questionSlot?: string;   // at most one question, through the existing AskedSlot flow
  directions: { label: string; themeIds: string[]; rationale: string }[];  // at most 3; ideas, not listings
}
```

| Operation | Kind | Owner | Input | Output | Access |
| --- | --- | --- | --- | --- | --- |
| `map.getMapState` (extended) | query | Dev 2 | `{ roomId }` | Adds `themes`, aggregated `signals` plus the caller’s own, `themeIds` per recommendation, and the caller’s own private items | Member; never caps, others’ imports, or recipient records |
| `map.suggestThemes` | action | Dev 3 | `{ roomId }` | `Result<{ themes: MapTheme[] }>` | Member; `stale_job` if knowledge changed during the call |
| `map.updateTheme` | mutation | Dev 2 | `{ themeId, label?, status?, mergeInto? }` | `Result<MapTheme>` | Member; attributed; dismiss never deletes clues |
| `map.setDirection` | mutation | Dev 2 | `{ roomId, target, value: 1 \| -1 \| 0 }` | `Result<{ target, total }>` | Member; `0` clears the caller’s signal |
| `map.sharpen` | action | Dev 3 | `{ roomId }` | `Result<SharpenResult>` | Member; one round per knowledge revision |

Rules:

- Listings keep using `castVote`: dragging toward the box is `"up"`, away is `"down"`. No second vote store for listings.
- Ring positions are computed on the client. No signal or theme changes caps, the budget, the selection, or confirmed knowledge.
- A theme is an interpretation, not room knowledge. Recommendations may cite theme IDs only through the clue IDs they already cite: `themeIds` is derived server-side from cited clue IDs and theme `clueIds` (Dev 4).
- Sharpen directions behave like sprouts: labelled agent ideas until research returns sourced listings for them.
- Errors: `unauthorized`, `not_found`, `validation_failed`, `stale_job`, `refused`.

Interim (built in the live map, 2026-10-24): a friend's typed **gift idea** is stored as a manual published clue of kind `interest` whose text starts with `Gift idea: ` (`GIFT_IDEA_PREFIX` in `lib/map/rings.ts`). The map shows these on the inner ring and research can use them immediately. MAP-021 replaces the prefix with a proper `gift_idea` clue kind; until then, do not rely on the prefix outside the map.

Migration: additive tables for themes and signals. Existing `map.*`, `castVote`, `setFeedback`, cursor, and proposal functions keep their endpoints. `moveNode` and the arrange view leave the main path and can be removed after MAP-018.

### Shared memory tree integration (Dev 3 / Dev 1, October 24)

Superseded on the main path by the map-first room above. The endpoints described here stay in use; the sky-tree and arrangement views are being replaced by the ring map.

The room map offers a sky-tree exploration view and an arrangement view over the same published clues, suggestions, listings, selection and approvals. Scene positions and vibe attraction are presentation only; changing a vibe never publishes a preference. A separate human confirmation is required to publish it.

- Existing membership-scoped `map.getMapState`, `moveNode`, `moveCursor`, `listCursors`, `growSeed`, and `plantSprout` retain their endpoints. Suggestions stay labelled agent/preset ideas until a human confirms they are true. Growth commits and planting recheck the active seed and room membership; stale seeds cannot grow/publish branches.
- `map.setFeedback({roomId, listingId, kind: "owned" | "price"})` creates an attributed, idempotent reaction for that member and listing. Owned explicitly publishes a room-visible manual ownership clue tied to the observed listing title, bumps knowledge, and reranks cached candidates. Price records a personal reaction only; it does not assert recipient knowledge, change a budget/private cap, or trigger paid research. `map.undoFeedback({feedbackId})` is author-only and withdraws only its own backing ownership clue when applicable. Feedback is shared with attribution; personal price reactions dim only that viewer's candidate. Additive `mapFeedback` table; no migration of existing rows.
- `getMapState` adds `feedback`, including the attributed reaction, its ID and the observed listing needed to keep a rejected island inspectable. Other members' private contribution limits, imports and recipient records never enter this projection.
- `map.editMemory({clueId, expectedText, text})` permits only the publisher to edit an active manual memory, rejects stale text, and bumps knowledge. Imported clues keep their source/review workflow; other members can contribute a new memory instead of rewriting someone else's evidence.
- Gift island actions call the existing `selectGift` (organizer) or `castVote` (contributor). Real proposal revisions and approval states are subscribed to; no simulated approval enters the live map. Existing proposal permissions and private-cap projection remain authoritative.

Owners/consumers: Dev 3 owns map actions and lifecycle checks; Dev 1 owns the shared room surfaces; Dev 2 owns unchanged selection/proposal operations; Dev 4 supplies unchanged sourced listings. The 3D scene is lazy loaded, bounded to a focused subset, with a button/list fallback and the arrangement view retained. Private evidence remains in the existing room tools.

### Member 3 research continuation (2026-10-24)

Owner: Dev 3; shared consumers: Dev 1 (message evidence/activity), Dev 2 (human messages/knowledge hooks), Dev 4 (catalog/research completion).

- Shared `readCatalog(ctx, room)` in `convex/research/catalog.ts` supplies the same latest-successful candidate pool and dynamic ranking to both `listRecommendations` and buyer snapshots. Legacy stored recommendation rows are not an agent source. The helper also supplies latest-request status, excluded-listing reasons, and current active clues. Public query output stays unchanged.
- `ResearchJob` storage adds optional `actingParticipantId`, `originatingAgentJobId`, `latestMessageId`, and `continuationAgentJobId`. Public and agent-started research capture the acting member and latest human message. Every terminal current research request may enqueue **one** continuation atomically; a duplicate callback, newer request, changed knowledge, removed member, or newer human message cannot start another or post an obsolete response. Old jobs without an actor have no automatic continuation.
- `AgentJob` gains optional `trigger: "human" | "research_completed" | "knowledge_changed"` and `researchJobId`. Continuations use the existing evaluate-thread worker, independent of quiet-mode mentions. Non-human turns may recommend, clarify, listen, or wait; they may not search or query the recipient agent. No recursive/paid-provider loop is introduced. Failed/uncertain research yields a fixed, truthful status message without another model call. Research retry remains an explicit new research request.
- Publication/withdrawal/source deletion bumps knowledge and schedules a debounced, cached-candidate re-evaluation when a prior candidate pool exists. No automatic paid retrieval occurs. The server rechecks current catalog/version/membership at commit. Selection and proposals still change only through their existing deterministic operations.
- Recommendation chat is rendered from validated listing/clue IDs, observed price/status, and source observations; the model chooses the shortlist but cannot author purchase facts. Chat storage/`ChatMessage` gains optional `agentJobId`, `citations: { listingIds, publishedClueIds, researchJobId? }`, and `responseAgentJobId`. Activity events may carry the same room-visible citations. No private source IDs or recipient preference IDs are included.
- `sendMessage` adds optional `replyToSlot`; it closes that exact open question atomically with the submitted human message. `answerQuestion` retries return the original message/job pair, even after later chat, rather than scheduling another turn. Untargeted ordinary chat does not silently resolve a question or publish a preference.
- Activity projection adds bounded owner-safe job status/retry eligibility and model-configuration presence flags (booleans only). No secret values, provider payloads, or private job details are returned.
- Model calls include a configurable output-token cap (default 2,400, allowed 256–8,192) and optional configured reasoning effort. `AgentJob.modelUsage` optionally records `{ calls, reportedCalls, inputTokens, outputTokens, cachedInputTokens, reasoningTokens }`, including retries and returned recipient-role usage. Counts are attempt-local and exposed only to the acting member. Missing provider usage is explicitly distinguished by `reportedCalls`; counts are diagnostics, not a settled bill. No model price is hardcoded.

Migration: additive optional fields; existing fixtures and old records remain readable. Research completion and knowledge-revision hooks are narrow cross-workstream changes. Frontend remains a separate integration task.

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

Access: members read; organizer updates metadata (`rooms.updateRoom`). `inviteToken` is for join, not for private data.

Server-only `deletedAt?: number` is set by `rooms.deleteRoom`. From that moment every membership check, invite lookup, and `listMyRooms` treats the room as missing (`not_found`) while `internal.rooms.purgeRoomBatch` removes its rows. Deleted rooms are never returned, so `Room` does not carry the field.

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
  deletedAt?: number; // author deleted it: body is "" and the row stays as a tombstone
}
```

`messages.deleteMessage` overwrites the stored body rather than filtering it, so readers that use `chatMessages` directly (the buyer-agent snapshot) never see deleted text. `room.latestMessageId` and job fences may keep pointing at a tombstone.

### Evidence source

**Owner:** Dev 2 (store), Dev 3 (analyze). **Consumers:** Dev 3.

```ts
interface EvidenceSource {
  id: string;
  roomId: string;
  participantId: string;
  kind: "paste" | "text_export" | "photo" | "screenshot" | "voice_note"; // photo: P0, screenshot: P1-C, voice_note: P2
  label: string;
  sourceRevision: number;
  /** photo / screenshot / voice_note only. The uploaded file is deleted once read. */
  media?: {
    count: number; // photos and screenshots: 1–3; voice notes: 1
    /** photo sources: per-photo normalized tap point (0–1) marking the recipient. The uploader's own mark, not face recognition. Photos without a marker yield scene-only observations. */
    recipientMarkers?: { x: number; y: number }[];
    status: "uploaded" | "read" | "failed" | "deleted";
  };
  createdAt: number;
}

interface PrivateMessage {
  id: string;
  sourceId: string;
  participantId: string;
  body: string; // pasted text, text read from a screenshot / voice note, or one photo observation
  saidAt?: number;
  speakerHint?: string;
  /** Which file (0-based) the row came from; screenshot and photo sources only. */
  mediaIndex?: number;
}
```

Access: owner only, plus extractor action as that owner.

Screenshots and voice notes become ordinary `PrivateMessage` rows before clue extraction. A photo becomes one observation row per photo. Proposed clues always cite rows on their own source, so `ProposedClue.sourceMessageIds` and every downstream rule stay the same. The raw file lives in Convex file storage only until it is read, then it is deleted and `media.status` becomes `deleted` (or `failed`).

### Photo observation (P0)

**Owner:** Dev 3 (producer). **Consumers:** Dev 1 (review UI); Dev 4 consumes the published style clues through the same confirmed-clue path as typed clues (see “Confirmed visual preferences in research”; there is no separate `SearchBrief` style field).

```ts
interface PhotoObservation {
  mediaIndex: number;
  recipientActivity?: string; // 1–6 words, e.g. "wheel-throwing"
  placeType?:
    | "home" | "kitchen" | "office" | "cafe" | "restaurant"
    | "trail" | "beach" | "water" | "gym" | "studio" | "garden"
    | "city" | "vehicle" | "stage" | "other";
  styleTerms?: string[]; // e.g. ["minimalist", "bright colors"]
  visibleItems?: { label: string; owned: "likely" | "possible" | "unknown" }[];
  notes?: string; // one short basis sentence shown to the reviewer
}
```

Rules:

- The uploader marks the recipient by tapping the photo; the marker is the uploader's statement, never face recognition.
- `placeType` comes from the closed enum only. No landmarks, addresses, city names, or GPS.
- Describe only the marked person's activity, the coarse setting, style, and visible objects. Never identify people from faces, guess names, or infer age, gender, appearance, health, ethnicity, or religion. Other people in the photo are ignored.
- Validate model output with Zod. Photo content is untrusted data; instructions inside a photo are not commands.
- A single photo's observation becomes an `uncertain` clue. The same term observed in two or more photos of the source merges into one clue citing every photo, with its normal kind (`interest` for activities, `ownership` for likely-owned items) and raised confidence. Every photo clue sets `speakerAssumption: "unknown"` and stays behind the human publish gate.
- Published style observations become ordinary `interest` clues. They reach research through the confirmed-clue path (see “Confirmed visual preferences in research”), not a separate `SearchBrief` field.

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
  sourceKind: "paste" | "import" | "chat" | "manual" | "photo" | "screenshot" | "voice_note";
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
  | "wait"
  | "reply"; // answers a follow-up in chat; cannot change state

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

`imageUrl` stays optional because some sources omit it, but it is expected for P0 product cards. Dev 4 keeps the provider's public thumbnail URL, validated as a public HTTPS URL, and prefers listings with photos when filling the visible 6–12 candidates. Dev 1 shows a labeled placeholder when it is missing and never substitutes a stock or AI-generated image.

### Product normalization helpers (RC-001 / RC-003)

**Owner:** Dev 4. **Consumers:** Dev 4 research action; Dev 1/2/3 receive the unchanged ProductListing shape.

- `normalizeListing(raw, retrievedAt, context?)` returns ProductListing fields without IDs/status, or null. Context is trusted server-side US query localization (`{ country: "us" }`), never model-provided currency.
- `normalizeDataset(raw, retrievedAt)` reads the verified Actor's page envelopes, accepts only `search_parameters.gl === "us"`, skips malformed rows, and deduplicates identical product/seller/title observations within one dataset.
- No schema migration or client endpoint changes. USD must be established by explicit currency, explicit USD price label, or validated US query context. Explicit foreign currency is rejected.
- Exact nonnegative prices become safe integer cents. Ambiguous, conflicting or invalid prices remain unknown with no amount. Stock and shipping stay unknown for this provider.
- Preserve bundle/size text. Source links remain the observed Google Shopping URLs; they are not merchant checkout links.
- Provider-only fields, opaque page tokens, and helper URLs never enter normalized listings.

### Derived product presentation (RC-008 / RC-016)

**Owner:** Dev 4. **Consumer:** Dev 1. These are pure helpers; no database migration or endpoint changes.

```ts
interface PriceFreshness {
  kind: "recent" | "aging" | "stale" | "unknown" | "unavailable";
  label: string;
  needsRefresh: boolean;
  observedAt?: number;
  ageMs?: number;
  nextChangeAt?: number;
}
```

- `getPriceFreshness(listing, now, { sourceFailed? })` lives in `lib/research/freshness.ts`. The caller supplies a Unix millisecond clock: under 30 minutes is recent, 30 minutes through just under 6 hours is aging, and 6 hours onward is stale. A source failure or explicitly stale listing also needs refresh. Unknown prices remain unknown; invalid listings are unavailable. Invalid/future timestamps never count as recent.
- `nextChangeAt` tells the UI when the age category changes. Recompute with the client's clock on a timer or visibility change; a Convex query does not rerun merely because wall-clock time passes. No automatic refresh request or price/proposal mutation is performed.
- `hasProductImageUrl(listing)` validates an HTTPS thumbnail URL; it does not fetch the image or guarantee that the remote image loads. Dev 1 should show a placeholder on missing/failed images.
- Ranking ties compare total score, personal relevance, then budget fit, then whether the item is hands-on (title has a kit, tool, class, starter, supply, or course word), then presence of a valid HTTPS image URL, and finally listing ID. Images and the hands-on flag do not alter numeric scores, evidence citations, exclusions, or affordability. Listings without images remain eligible. This is an explicit tie-order change for the next integration checkpoint.
- Positive clue matching ignores a small explicit list of retail brand names that contain hobby words (`Pottery Barn`, `Bass Pro`), so brand text alone never cites a clue. Studio names such as "Farmhouse Pottery" stay matchable. Ownership and exclusion matching still read the literal title.

### Reviewed catalog matching (Dev 4)

Owner: Dev 4. Consumers: Dev 1 explanations, Dev 3 catalog reads, Dev 2 integration review. No endpoint, ProductListing field, database or validator changes. Migration: none; review the additive matching/exclusion behavior at the next integration checkpoint.

`catalogEvidenceFor(listing)` derives reviewed manufacturer/category facts from an exact normalized catalog title, including its model number and full descriptor. The initial catalog contains only MKM BHR-051 (Zig Zag Spiral roller) and DD-10 (10-inch decorating disk), with manufacturer URLs, checked date and a short paraphrased basis. It is a small reviewed catalog, not a general classifier. Normalization tolerates case, whitespace, dash/punctuation differences and spacing within these model codes. Unknown variants, truncated titles, appended accessories, model codes alone and seller/query matches yield no evidence.

- Positive matching can use the reviewed `pottery`, `tool` and `MKM` terms alongside actual title tokens. The normal clue weights and thresholds remain unchanged. A matched preference counts once, regardless of how many supporting sources exist.
- If reviewed terms contribute to a match, the explanation explicitly cites the manufacturer basis, source URL and checked date. A model match does not authenticate a seller or establish a price, stock, size, shipping, trend or purchase fact.
- **Ownership stays literal.** A known pottery tool is not a starter kit and owning pottery does not mean owning every pottery tool. Exact named-item ownership still filters its actual title.
- **Explicit exclusions additionally use reviewed category/manufacturer terms** so “no more pottery” or “no MKM” cannot be bypassed by a known model whose title omits those words. Other exclusion thresholds and uncertainty/withdrawal guards are unchanged; this is the documented extension to the literal-only rule above.
- Reviewed hands-on tools participate in the existing hands-on tie-break. No extra numeric bonus, trend score or image bonus is added. Unknown prices and budget arithmetic remain unchanged.
- No runtime merchant fetch, AI classification, new provider, schema or codegen is introduced. Adding catalog entries requires identity verification and a source-backed regression; unsupported products retain literal matching until their evidence is reviewed.

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

**Owner:** Dev 2 (document + state machine, `convex/payments/`), Dev 4 (adapter). **Consumers:** Dev 1 (truthful status).

```ts
interface PaymentAttempt {
  id: string;
  roomId: string;
  revisionId: string;
  participantId: string;
  provider: "stripe_test";
  providerObjectId?: string; // server-only
  idempotencyKey: string; // server-derived, sent to Stripe; server-only
  amountMinor: number; // frozen share from the revision
  currency: "USD";
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
  lastError?: string; // UI-safe adapter message, max 200 chars
  createdAt: number;
  updatedAt: number;
}

/** Client view of the caller's own attempt; no provider IDs or idempotency keys. */
type MyPaymentAttemptView = Pick<
  PaymentAttempt,
  "id" | "revisionId" | "status" | "amountMinor" | "currency" | "lastError" | "createdAt" | "updatedAt"
>;

interface PaymentStatusView {
  enabled: boolean; // PAYMENTS_SANDBOX_ENABLED=true on the deployment
  mode: "stripe_test";
  revisionId: string | null;
  groupStatus: ProposalRevision["status"] | null;
  frozen: boolean; // capturing | test_funded | recovery_pending
  payerCount: number;
  authorizedCount: number;
  capturedCount: number;
  attentionCount: number; // failed, action_required, or uncertain
  myAttempt: MyPaymentAttemptView | null;
  merchantOrder: { status: "not_implemented" };
}
```

`amountMinor`, `currency`, `lastError`, and `updatedAt` are additive (BE-015). Group payment status is the current `ProposalRevision.status`. Peers see counts, never another participant's attempt or instrument. Storage also keeps `clientIdempotencyKey` and a server-only `ProviderEvent { provider, providerEventId (unique), type, providerObjectId?, receivedAt }` ledger.
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
  listingLimit: number; // integer 1..12; default 12
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

The pure Dev 4 brief builder bounds an explicit listing limit to 1..12, rounding
fractional limits down. Omitted or non-finite limits use 12. An empty query list
means no searchable published preference exists; the caller must not request
research until it has a nonempty query. Model-produced briefs still pass the
shared boundary validator rather than relying on this builder.

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

### `generateEvidenceUploadUrl` / `importMediaEvidence` (P0 photos, P1-C screenshots, P2 voice notes)

| | |
| --- | --- |
| Owner | Dev 2 (storage, source rows), Dev 3 (vision / transcription action) |
| Consumers | Dev 1 |
| Input | `generateEvidenceUploadUrl`: `{ roomId }` → `{ uploadUrl }`, one call per file. `importMediaEvidence` (implemented: `photo` and `screenshot`; `voice_note` is P2, not built): `{ roomId, kind: "photo" \| "screenshot", label, files: { storageId, marker?: { x: number, y: number } }[] }`. The marker is per file (photos only) and normalized 0–1. |
| Output | `{ source: EvidenceSource }`. The caller then runs `extractClues({ sourceId })` as for pasted text. |
| Access | Members only. Caller becomes owner. Each issued URL records a server-only `mediaUploadGrants` row; a file can be claimed only against one of the caller's own unused grants issued before the file was created and within the last hour, and each grant covers one file. A storage id already attached to any source is rejected. Files live in a private `evidenceMedia` table that clients never read; no public query returns storage ids, file URLs, or `evidenceMedia` rows, and `recipientMarkers` appear only on the owner's `listMyEvidence`. |
| Rate limit | `generateEvidenceUploadUrl`: at most 12 URLs per member per room per 10 minutes, then `refused`. |
| Rejections | Non-member and unauthenticated calls delete nothing. A validation failure deletes only the unclaimed files matched to the caller's own grants (and consumes those grants); files that are claimed, missing, or not the caller's are left alone. Unclaimed files older than one hour, and claimed files still unread after 24 hours, are removed by `cleanup.sweepStaleUploads`. |
| Errors | `unauthorized`, `refused` (upload URL rate limit), `validation_failed` (wrong type, too large, too many files, duplicate, bad marker, file not uploaded by the caller or upload expired), `provider_timeout` |
| Migration | BE-018 hardening (Dev 2; consumers Dev 1, Dev 3): additive `mediaUploadGrants` table; clients must call `generateEvidenceUploadUrl` once per file before uploading (the shipped `MediaDrop` already does). Server-side `contentType` is the upload request's `Content-Type` header (size is measured by Convex); mutations cannot read bytes, so the extraction action is the first code that sees them. |

Limits: photos and screenshots PNG/JPEG/WebP, at most 3 files, 2.2 MB each (the model adapter's per-image cap), EXIF/GPS stripped in the browser before upload by re-encoding. The server validates type and size and never trusts that. Voice notes: one file, at most 60 seconds. `recipientMarkers` carries the uploader's per-photo tap point marking the recipient (photo sources; a photo without a marker yields scene-only observations). The same `extractClues` job handles every media kind: the action reads the files, deletes them in the same transaction that stores the text rows (and on failure, timeout, or source withdrawal), and writes `PrivateMessage` rows (screenshots, voice notes) or observation rows plus proposed clues (photos) on that source.

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
- Provider responses are streamed with a 750,000-byte ceiling before JSON parsing or Convex mutation arguments. Empty, truncated, oversized or malformed replies stay uncertain; no POST retry is issued. Redirects are refused. Poll replies must match the requested alphanumeric run ID before their dataset is read; invalid run/dataset IDs are rejected before contacting the provider. These checks add no client fields, provider or schema changes (Dev 4 owner).
- Completion inserts normalized listings and succeeds atomically, at most once. It rejects changed knowledgeRevision or any newer research request. Ordering uses the room index's creation-order suffix, not completion time.
- listRecommendations independently selects the latest successful request using the room index, even after more than 50 failed requests. While a refresh is pending/failed, the previous successful candidate pool remains available. It re-ranks against all current active clues on each read, includes only visible ranked listings, and does not trust stored recommendation rows. Changing clues after a successful search can update the ranking without another provider run.
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

### Confirmed visual preferences in research

**Owner:** Dev 4. Existing PublishedClue, SearchBrief, ranking and provider signatures are unchanged. Dev 3 remains responsible for extracting/reviewing visual evidence.

- Photo analysis must supply reviewed, active interest/explicit_wish clues for positive recommendations; uncertain clues do not drive search/ranking. Plain observation/tentative wording (e.g. holding a camera, wearing a jacket, might own a camera) is additionally ignored even if misclassified as an interest or ownership clue. This lexical guard is not an image classifier or a complete uncertainty detector.
- Confirmed short preferences require all normalized shopping terms to match. Bounded positive-only vocabulary covers minimal/minimalist, retro/vintage, jeans/denim, rock climbing, wheel throwing/pottery wheel, jewelry items, and a small earth-tone palette when a visible goods category is present. These are catalog-text heuristics, not image similarity or semantic embeddings.
- Ownership and exclusions retain their literal matching rules; positive shopping vocabulary does not broaden them. Exact duplicate normalized preferences can cite multiple clues but do not multiply the relevance score.
- SearchBrief queryTerms are ordered complete query phrases. The one-page provider uses the first nonempty phrase, rather than concatenating unrelated interests. Planners should place a useful complete phrase first (e.g. vintage denim jacket, not separate vintage/denim/jacket elements). Remaining phrases are alternate directions, not additional paid searches in this task.
- Photo-derived and typed clues use the same research path. A clue's source type never creates an interest or ownership fact by itself. No media upload, model transport or shared database schema changes are included.

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
| `rooms.updateRoom` | mutation | `{ roomId, title?, recipientDisplayName?, occasion?, deadlineAt?: number \| null, budgetMinor?: number \| null }` | `Room` | Organizer. Omitted = unchanged, `null` clears the optional field. Same validation as `createRoom`. Budget is a hint; caps, allocation, and the revision are untouched |
| `messages.deleteMessage` | mutation | `{ messageId }` | `ChatMessage` tombstone (`body: ""`, `deletedAt`) | Author of a `participant` message (`unauthorized` otherwise). `buyer_agent` messages return `refused` for everyone, organizer included. Idempotent; does not enqueue an agent turn |
| `rooms.leaveRoom` | mutation | `{ roomId, deletePrivateData?: boolean }` | `null` | Contributor. Deletes their participant row, cap, and votes; cancels open agent jobs acting as them; recomputes the proposal (new revision without their share, prior approvals invalidated). Published clues and chat stay. With `deletePrivateData`, also hard-deletes their evidence, private messages, stored files, proposed clues, and their `agentEvents`; published clues derived from that evidence become `source_withdrawn` (excerpt dropped, `proposedClueId` unlinked). Organizer gets `refused`; a frozen revision (`capturing`/`test_funded`/`recovery_pending`) gets `invalid_revision` |
| `rooms.deleteRoom` | mutation | `{ roomId, confirmTitle }` | `null` | Organizer; `confirmTitle` must equal the title after trimming (`validation_failed`). Sets `room.deletedAt` (access ends immediately), cancels open agent/research jobs, and schedules `purgeRoomBatch`. `invalid_revision` while the revision is frozen or any payment attempt is non-terminal (other than `not_started`) |

Server-only hooks for other workstreams (internal functions or helpers, not client-callable):

| Name | For | Purpose |
| --- | --- | --- |
| `internal.clues.getOwnEvidenceForJob({ jobId, sourceId })` | Dev 3 `getOwnEvidence` | Source, messages, and proposed clues, only for an open `extract` job acting as the source owner |
| `internal.clues.insertProposedClues({ jobId, sourceId, clues })` | Dev 3 `proposeClues` | Returns `{ insertedIds, dropped }`; drops clues citing messages outside the source |
| `internal.messages.postAgentMessage({ jobId, body })` | Dev 3 | One `buyer_agent` message per `evaluate_thread` job |
| `internal.jobs.setAgentJobStatus` / `setResearchJobStatus` | Dev 3 / Dev 4 | Enforced transitions; terminal states return `stale_job` |
| `enqueueAgentJob`, `insertResearchJob`, `agentInputHash`, `isResearchJobCurrent` (exported from `convex/jobs.ts`) | Dev 3 / Dev 4 | Create job rows inside your own mutation with `inputHash` / `idempotencyKey` dedupe |
| `internal.proposals.clearSelectionsForListing({ listingId })` | Dev 4 RC-007 | Clears a selection of an invalidated listing and supersedes its revision |
| `internal.rooms.purgeRoomBatch({ roomId })` | Dev 2 BE-017 | Deletes up to 256 rows of a room marked `deletedAt` and reschedules itself; finally deletes the room. Order: research/agent jobs and council runs first (so in-flight commits find no job), then private data, public data, revisions with approvals and payment attempts, listings, worlds, participants. Stored evidence files are deleted with their `evidenceMedia` rows. No-op for rooms that are not marked deleted. `providerEvents` (webhook ledger, no room id) are kept |

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

Dev 2 state half (BE-015) lives in `convex/payments/state.ts`. Every public mutation returns `refused` unless `PAYMENTS_SANDBOX_ENABLED=true`, and requires a human member identity (scheduled agent actions have none). Dev 4's Stripe actions call these **before** each provider call, then report results through the internal mutations.

| Name | Kind | Input | Output | Access | Errors |
| --- | --- | --- | --- | --- | --- |
| `payments.state.getPaymentStatus` | query | `{ roomId }` | `PaymentStatusView` | Member | `unauthorized`, `not_found` |
| `payments.state.beginAuthorization` | mutation | `{ revisionId, idempotencyKey }` | `{ attemptId, revisionId, amountMinor, currency, idempotencyKey, status, created }` | Payer on the current revision once every payer approved (`approved_pledged`), or while `authorizing` / `blocked` | `refused`, `invalid_revision`, `unauthorized`, `validation_failed` |
| `payments.state.beginCapture` | mutation | `{ revisionId }` | `{ revisionId, attempts: { attemptId, amountMinor, idempotencyKey }[] }` | Organizer; revision `ready_to_capture`. Sets `capturing` (freeze) and `capture_pending` first; repeat returns the same list. Provider object IDs are not returned; the server-side adapter reads them with `internal.payments.state.getAttempt` | `refused`, `invalid_revision`, `unauthorized`, `infeasible` |
| `payments.state.cancelPayments` | mutation | `{ revisionId }` | `{ canceledRevisionId, currentRevisionId }` | Organizer, pre-capture only. Mints a fresh revision for new approvals | `refused`, `invalid_revision`, `unauthorized` |
| `payments.state.cancelMyAuthorization` | mutation | `{ attemptId }` | `MyPaymentAttemptView` | Attempt owner, pre-capture only | `refused`, `not_found`, `unauthorized`, `invalid_revision` |

Server-only hooks for the Dev 4 adapter:

| Name | Purpose |
| --- | --- |
| `internal.payments.state.attachProviderObject({ attemptId, providerObjectId })` | Bind a PaymentIntent/Session ID once; unique across attempts |
| `internal.payments.state.applyAttemptStatus({ attemptId, status, lastError? })` | Record a provider-reported status; repeat is a no-op, illegal transitions are `validation_failed`; re-derives group status and unwind intents |
| `internal.payments.state.recordProviderEvent({ providerEventId, type, providerObjectId? })` | Webhook dedupe; `{ duplicate: true }` means stop |
| `internal.payments.state.getAttempt` / `findAttemptByProviderObject` / `listPendingProviderWork({ revisionId })` | Reads for the adapter and reconcile |

Group transitions (pure, `convex/payments/stateMachine.ts`):

- `approved_pledged → authorizing` on the first attempt; `→ ready_to_capture` when every payer's latest attempt is `authorized`; `→ blocked` on any `authorization_failed` (a retry with a new key returns to `authorizing`).
- `capturing → test_funded` only when every payer is `captured`. `uncertain` stays `capturing` until reconcile. Any other outcome is `recovery_pending`.
- `recovery_pending`: authorized attempts get `cancellation_pending`, captured ones `refund_pending`; when every attempt is terminal (`canceled` / `refunded` / `authorization_failed`) the revision becomes `canceled`, its approvals are invalidated, and a fresh revision is minted.
- Pre-capture revisions (`authorizing`, `ready_to_capture`, `blocked`) remain editable: a material change supersedes them as usual and records `cancellation_pending` on live attempts. `capturing`, `test_funded`, and `recovery_pending` are frozen; selection, cap, and listing-invalidation edits return `invalid_revision`.
- Late provider events on superseded or canceled revisions are recorded, then unwound (cancel or refund).

The original `createAuthorization`, `captureRevision`, `cancelAuthorization`, and `reconcileEvent` names remain Dev 4's Stripe-facing actions and wrap the operations above.

LLM-initiated payment operations are forbidden.

### AI Council (Fetch.ai coordinator) — additive

Owner: Dev 1 (council UI) with Dev 3 (agents). Consumers: the `fetch-agent/` coordinator, `/council` page. Additive tables; no existing table changes. Code: `lib/council/contracts.ts`, `lib/council/library.json`, `convex/council.ts`.

One registered Fetch.ai agent (Chat Protocol, ASI:One) runs five specialist roles as real functions and emits an event at each execution boundary:

| Actor | Task | Does |
| --- | --- | --- |
| `archivist` | `analyze_memories` | Extracts clues (interests, wishes, owned items, dislikes, budget) from the request/memories |
| `muse` | `design_decoration` | Maps clues to a `DecorationSpec` from the approved library only |
| `scout` | `research_gifts` | Real product research via the existing Apify pipeline (`/council/research`), cached |
| `keeper` | `check_constraints` | Budget, ownership and dislike rules; hard exclusions vs. soft notes |
| `courier` | `deliver_recommendations` | Coordinates and prepares the final answer |

`CouncilEvent` — `{ eventId, runId, actor, task, status: started|completed|failed, sequence, timestamp, result? }`. `result` is display-only and small: `{ summary?, count?, decorations?, cached?, error? }`. Products, URLs and raw memories never travel in events. `roomId` is never invented: ASI:One runs have none; web demo runs carry a browser `demoKey`.

`DecorationSpec` — `{ memoryId, jar: wish|interest|moment, assetId, color, placement, label }`, every enum from `lib/council/library.json`.

Tables: `councilRuns` (`runId`, `source`, `demoKey?`, `status`, `lastSequence`, timestamps), `councilEvents` (unique `eventId`), `giftDecorations` (unique per `demoKey` + `memoryId`).

HTTP (server-to-server, `Authorization: Bearer $COUNCIL_INGEST_SECRET`): `POST /council/runs`, `POST /council/events`, `POST /council/research`. Queries: `council.demoState({ demoKey })` — latest run, its events, and persisted decorations.

Semantics: events are idempotent by `eventId`; state per actor is the highest `sequence` seen, so duplicates and out-of-order delivery cannot rewind a finished task; a decoration is upserted per memory, so reconnects never duplicate charms; a run with no event for 120 s reads as `interrupted`.

---

### Room council integration (Dev 1 + Dev 3 + Dev 4)

The authenticated room uses `councilRoom.start({roomId, publishedClueIds, idempotencyKey})`, returning `Result<{runId, jobId}>`. Membership, active room clues, room knowledge revision and the stated room budget are checked in Convex. The coordinator receives only published clues and public room context. No private imports, unpublished extractions or contribution limits cross this boundary.

Additive optional `councilRuns` fields: `roomId`, `researchJobId`, `knowledgeRevision`, `idempotencyKey`, `approved` (listing ID + Keeper notes), `excluded` (title + reason), `cached`, `deliveredAt`, `error`. Status additionally supports `partial` and `uncertain`. Indexes: room/start time, research job, room/request key. Existing demo/ASI records remain valid and never acquire room access. `giftDecorations.demoKey` becomes optional; room decorations use `roomId` and an indexed room/memory pair. Only current active published-clue IDs may produce room charms.

`councilRoom.state({roomId})` is membership checked and returns the latest run, validated display events and active-clue charms. `POST /council/room-research` accepts only a registered room run ID from the trusted coordinator; it starts/polls the existing persisted research job. Provider input is the server-built SearchBrief, never agent-generated search commands. A retry attaches to the same job. `POST /council/results` accepts `{runId, kept: [{sourceUrl, notes}], excluded: [{title, reason}], cached, error?}`. It validates every source against that run's observed productListings and stores only references/notes, not model-generated listings. Results are idempotent per run; stale room knowledge is rejected. Public catalog queries apply the Keeper-approved subset and retain existing clue-based scoring, voting, selection and proposal checks. Product payloads do not travel in progress events.

A room run is complete only after result persistence. Empty/failed research is failed or partial (if a charm exists); dispatch or provider timeouts remain uncertain and block duplicate charged work. An explicit resume uses the same run/job. Research-job providerRunId/startedAt are persisted optional fields for reconciliation; an unknown start outcome is never blindly restarted. ASI:One stays independent of private web rooms.

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

## Local trend discovery experiment (RC-014)

Owner: Dev 4. Consumers: standalone spike/report only. Additive types; no database migration, query shape, score, or `SearchBrief` change. These observations describe **search terms**, never product sales. Production integration is deferred.

```ts
interface TrendContext {
  seedTerm: string;       // public category, not raw private clue text
  geo: "US";
  timeRange: "today 3-m"; // requested relative window evaluated at retrieval
  retrievedAt: number;   // positive integer Unix milliseconds
}
type TrendObservation = TrendContext & {
  source: "google_trends";
  sourceUrl: string;     // Google Trends seed exploration with the same geo/window
  query: string;         // provider's related search phrase
} & (
  | { kind: "top_search"; popularityIndex: number } // 0..100, not share or sales
  | { kind: "rising_search"; growthPercent: number } // >0, compared with previous period
  | { kind: "breakout_search" } // provider says Breakout; no invented exact growth
);
```

Reject mismatched seed terms, malformed metrics and missing context. Deduplicate within seed/geo/window/kind/query. Discovery candidates must retain all literal seed tokens, reject obvious local-service/informational intent, and retain the observation as provenance. This lexical gate can miss useful synonyms and admit non-gifts; it is not personal relevance or purchase approval. Current production `trendSignal` stays zero.

The alternate Actor's exact label `Past 90 days` maps to requested `today 3-m`; other windows/geos are rejected. Ignore the known `Pottery Barn` brand phrase when checking a pottery category match, matching the production collision rule.

### Local TikTok fashion observations

Owner: Dev 4. Consumers: local spike/replay/tests only. Additive types, no Convex migration or production ranking change. Keep this separate from Google search-growth observations: these are individual post snapshots, not growth measurements.

```ts
interface FashionSampleContext {
  seedTerm: string;     // public style query
  windowStart: number;  // inclusive Unix ms, independently enforced
  windowEnd: number;    // inclusive Unix ms
  retrievedAt: number;
}
interface TikTokFashionPost {
  source: "tiktok";
  postId: string;
  sourceUrl: string;
  creatorKey: string;   // normalized public URL handle, for dedup/counting only
  caption: string;
  hashtags: string[];
  publishedAt: number;
  retrievedAt: number;
  views?: number;       // lifetime count at retrieval, not count within the window
  likes?: number;
  shares?: number;
  advertising: "flagged" | "not_flagged" | "unknown";
}
interface FashionDiscovery {
  kind: "sampled_style";
  garment: string;
  searchQuery: string;  // proposed shopping query; not a published recipient preference
  postUrls: string[];
  distinctCreators: number;
  label: string;        // e.g. Mentioned in 3 sampled recent posts
}
```

Reject invalid/non-public source URLs, private-account flags, missing dates and dates outside the window; deduplicate post IDs before counting. If valid copies of one post disagree on its source URL, creator, caption, hashtags, publication date or advertising status, omit that post from discovery regardless of input order. Engagement counter changes alone do not establish a conflict. Derived suggestions require explicit garment mentions in captions/hashtags and at least two distinct creators whose posts are not flagged as ads. Unknown ad status is not proof of organic content. Limit vocabulary to the reviewed category tables in `lib/research/styleCategories.ts`; a sample is matched only against the category of its own seed. A query may carry `vintage` from the user's public seed when the supporting posts explicitly mention vintage. No image recognition, platform-wide popularity, geographic reach or growth claims.

Explicit adapters support Clockworks' `webVideoUrl`/`text`/`createTimeISO` and the alternate Actor's `postPage`/`title`/`uploadedAtFormatted`. The alternate provider documents defaulting missing counters to zero; omit its ambiguous zero counts rather than asserting observed zero engagement.

The bounded caption vocabulary covers five reviewed categories. Denim: baggy, loose-fit, wide-leg, barrel-leg, straight-leg, flared and bootcut jeans, plus denim jackets, skirts, vests, shorts, dresses and overalls. Jewelry: hoop and huggie earrings, ear cuffs, pearl and layered necklaces, charm and tennis bracelets, stacking and signet rings. Sneakers: chunky, platform, retro, suede, slim, white and high-top. Knitwear: cable, chunky and fair isle knits, quarter-zips, turtlenecks, sweater vests, cardigans. Bags: tote, crossbody, shoulder, bucket, baguette, hobo, saddle and mini bags. Adding a category requires a reviewed table entry and tests. `loose jeans`, `loose fit denim` and `loose leg denim` map to the proposed query `loose fit jeans`; this is a lexical discovery heuristic, not visual verification or authentication of vintage age.
### `giftWorlds` (opt-in zoom-out summaries)

| | |
| --- | --- |
| Owner | Dev 3 (backend), Dev 1 (UI / world scene) |
| Mutations | `shareWorld({ roomId, recipientAlias?, highlightClueIds? })`, `unshareWorld({ roomId })` (organizer only) |
| Queries | `getMyWorldShare({ roomId })` (members), `listWorlds({ limit? })` (any signed-in user) |
| Output | `PublicWorld { id, isSample, mine, occasion, recipientAlias, budgetBand, friends, inputs: { kind, count }[], highlights: string[] (≤3, ≤80 chars), state: "exploring" \| "chosen", outcome?: { title, priceMinor?, priceStatus, source }, sharedAt }` plus `WorldAggregate` |
| Privacy | Never exposes room id, user ids, invite token, real names, chats, contribution limits, or private imports. Highlights are organizer-picked active clue lines with names replaced; sensitive text is rejected. |
| Errors | `unauthorized`, `validation_failed`, `refused` (sample seeding disabled) |

### Recorded fashion context → buyer agent (Dev 4 / Dev 3 integration)

Owner: Dev 4 constructs source context; Dev 3 consumes it in the existing buyer snapshot.
`BuyerSnapshot.fashionDiscovery?: FashionAgentContext` is an additive internal field,
not a database field or a recipient preference. No migration or public endpoint changes.

```ts
interface FashionAgentContext {
  mode: "recorded_sample";
  label: string;
  context: FashionSampleContext;
  supportingPublishedClueIds: string[];
  directions: FashionDiscovery[];
}
```

The first integration is an explicit offline replay under existing `DEMO_SEED_ENABLED=true`.
Only active confirmed interest/wish clues that literally contain both vintage and denim
activate the recorded vintage-denim sample. Uncertain wording, private evidence, unrelated
interests and disabled demo mode produce no context. Source dates are preserved; a sample
retrieved in the future or more than 24 hours ago is omitted. Only bounded derived directions,
source URLs and sample context reach the model; raw captions and author metadata do not.

The buyer may use a direction as the first SearchBrief query only as inspiration for the
supporting published interest. It cannot cite it as a new recipient preference, product,
price or platform-wide trend. Existing server budget, exclusions, revision checks and
one-direction shopping worker still apply. The context participates in input-version fencing.
No TikTok request, automatic paid discovery, new provider or deployment is enabled by this
bridge. Live refresh/persistence and user-visible discovery provenance are still pending.

### Stripe test adapter boundary (Dev 4, P1-B in progress)

Owner: Dev 4 transport/signature verification. Consumer: Dev 2 payment state machine.
This is a server-only helper contract, not a public action. No client, model or agent
may call it directly. RC-010..013 are not complete until durable state, endpoint
wiring, sandbox acceptance and recovery checks pass.

`createStripeTestAdapter({ secretKey, frontendOrigin }, fetcher?)` exposes
`createCheckout(input)`, `retrieveCheckout(id)`, `expireCheckout(id, key)`,
`retrieveIntent(id)`, `captureIntent(id, key)`, and `refundIntent(id, amountMinor, key)`.
Every write requires an idempotency key. Input IDs bind room, immutable revision,
participant and stored payment attempt. `mode: "authorize"` requests manual capture;
`mode: "collect"` is organizer-only test collection after the caller's policy check.
The adapter accepts only test secret/restricted keys and validates `livemode: false`
on provider objects. Only USD, integer cents and hosted Stripe Checkout are supported.
Checkout accepts 50..99,999,999 cents; smaller shares are refused, never rounded up.

The caller must persist intent before the request, enforce membership/own-share or
organizer policy, require current approved revision and known permitted total, and
freeze edits before capture. The adapter does not authorize these operations.
Provider responses are reduced to allowlisted IDs, amounts and status fields; no
client secrets, payer details or raw errors escape. Failures return `failed` or
`uncertain`, never invented success. No automatic retries; reconciliation retrieves
provider state. Checkout redirects carry no success authority. Expiring an open
Checkout is not cancellation of a completed authorization or a refund.

`verifyStripeTestEvent(rawBody, signature, signingSecret, nowMs)` checks HMAC-SHA256
against the unmodified UTF-8 body, at least one v1 signature and a 300-second
past/future tolerance, then validates a test-mode event envelope. It returns only
an event ID/type and provider object reference. Dev 2 must durably deduplicate event
IDs and retrieve the provider object before applying a transition. Verification
alone does not grant a payment, capture, cancellation or refund state.

Additive shared types are `StripeCheckoutInput`, `StripeTestSession`,
`StripeTestIntent`, `StripeTestRefund`, `StripeTestEvent`, `StripePaymentBinding` and `StripeAdapterResult<T>`. Provider sessions/intents must carry the four binding IDs in metadata; the allowlisted DTO returns them so the state layer can compare them to its stored attempt. Mismatched requested/provider object IDs are unresolved, never accepted.
No database migration or payment-enabled UI is introduced by the helper work.

```ts
export interface StripeCheckoutInput {
  roomId: string;
  revisionId: string;
  participantId: string;
  attemptId: string;
  amountMinor: number;
  currency: "USD";
  mode: "authorize" | "collect";
  idempotencyKey: string;
}
export type StripePaymentBinding = Pick<StripeCheckoutInput, "roomId" | "revisionId" | "participantId" | "attemptId">;
export interface StripeTestSession {
  id: string;
  binding: StripePaymentBinding;
  checkoutUrl?: string;
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  paymentIntentId?: string;
  amountMinor: number;
  currency: "USD";
}
export interface StripeTestIntent {
  id: string;
  binding: StripePaymentBinding;
  status: "requires_payment_method" | "requires_confirmation" | "requires_action" | "processing" | "requires_capture" | "canceled" | "succeeded";
  amountMinor: number;
  amountCapturableMinor: number;
  amountReceivedMinor: number;
  currency: "USD";
  captureMethod: "automatic" | "automatic_async" | "manual";
}
export interface StripeTestRefund {
  id: string;
  paymentIntentId: string;
  amountMinor: number;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
}
export interface StripeTestEvent {
  id: string;
  type: string;
  objectId: string;
  objectType: string;
}
export type StripeAdapterResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "failed" | "uncertain"; message: string };
```

### Stripe reconciliation helpers (Dev 4 provider observations)

`retrieveRefund(refundId)` fetches a refund and verifies its parent PaymentIntent is
in test mode. `observeStripePayment({ expected, intent, refunds? })` returns an
allowlisted provider observation, not a database transition. `expected` contains
`binding: StripePaymentBinding`, the frozen `amountMinor`, expected `mode`, and
an optional already-bound PaymentIntent id. A mismatch refuses the observation.

The observation reports `status: PaymentAttempt["status"]`, `paymentIntentId`,
`capturedMinor`, `refundedMinor` and a bounded reason. A full observed capture is
`captured`; a partial capture is `action_required`. Known succeeded refunds are
deduplicated by provider id and summed in cents. Only a sum exactly equal to the
captured amount is `refunded`; partial or pending recovery is not full refund.
A fresh intent awaiting a payment method is pending, not a fabricated failure.
Caller retrieves provider state after a verified webhook and durably applies the
observation under Dev 2's event-id/revision fences. This helper never captures,
refunds, unfreezes a room or declares the merchant order complete.

`readStripePayment(input: StripePaymentReadInput, reader)` fetches the current
Checkout and/or PaymentIntent, compares frozen amount/bindings/known object IDs,
then discovers refunds by PaymentIntent before reporting any captured funds.
`listIntentRefunds(intentId): Promise<StripeAdapterResult<StripeTestRefund[]>>`
verifies the test-mode parent and reads a single filtered page of up to 100
refunds. A truncated page, foreign intent, duplicate ID or invalid object stays
uncertain. All results use the existing allowlisted refund DTO; payer details
are discarded. This recovers refunds whose create response was lost before
their ID could be stored. Up to ten distinct `refundIds` may still be supplied
as previously tracked references; each must appear in that complete fresh list.
Missing tracked refunds stay uncertain rather than treating the list as empty.
No list call is needed when no captured funds and no tracked refunds exist.
An empty list cannot prove an unresolved refund write failed: the durable
operation fence remains the state layer's responsibility, and this read never
permits an automatic retry.
No write method is available on its reader port. An open session with no intent
is pending; an expired session with no intent is canceled. A previously known
intent is always retrieved even if its session has expired. Completed Checkout
without a retrievable intent stays unresolved. A payment observation can omit
`paymentIntentId` before the provider has created one and includes the observed
`checkoutSessionId` when supplied. The input comes from the state layer, not a
browser. Repeated/out-of-order webhook notifications lead to fresh reads, not
blind replay of their embedded status.

Owner: Dev 4; consumer: Dev 2's future payment worker. The reader port now uses
`listIntentRefunds` instead of individual `retrieveRefund` calls. Existing input
and output DTOs are unchanged; no current production caller or database migration
is affected. `retrieveRefund` remains available for individual reference checks.
Provider reference: [Stripe list refunds](https://docs.stripe.com/api/refunds/list).

```ts
interface StripePaymentExpectation {
  binding: StripePaymentBinding;
  amountMinor: number;
  mode: "authorize" | "collect";
  paymentIntentId?: string;
}
interface StripePaymentObservation {
  status: PaymentAttempt["status"];
  paymentIntentId?: string;
  checkoutSessionId?: string;
  capturedMinor: number;
  refundedMinor: number;
  reason: string;
}
interface StripePaymentReadInput {
  expected: StripePaymentExpectation;
  checkoutSessionId?: string;
  paymentIntentId?: string;
  refundIds?: string[];
}
```

Research candidate retention fix: the room-scoped catalog query selects the newest
successful research job independently from the latest request. It does not discard
that pool after fifty later failed/uncertain jobs. Both reads use the existing room
index; no global table scan or schema migration is introduced.


A research watchdog first fences the request against the room's current knowledge
and newest requested job. A superseded lost worker becomes `stale`, not `uncertain`;
only an unresolved current request becomes uncertain and queues a status follow-up.
This prevents old unresolved inputs from blocking a later explicitly requested
search while preserving the no-automatic-paid-retry rule for current uncertainty.

### Live Google Trends discovery jobs (Dev 4)

Owner: Dev 4 research. Consumers: Dev 1 discovery cards; Dev 3 optional search tools;
Dev 2 deploy review. Adds a room-indexed `trendJobs` table (`convex/research/trendSchema.ts`),
isolated from payment and agent tables; no migration of existing rows. Room deletion
cancels open trend jobs and purges them in the job-first phase, like `fashionJobs`.
Provider: the already-evaluated `agenscrape~google-trends-scraper` build `1.0.21`
on the existing Apify account; US, past 3 months, related searches only, at most
10 dataset rows, $0.20 charge cap. Both social and trend sources share the bounded run
client in `convex/research/apifyRun.ts` (one POST per start, no automatic retry).

- `research/trendJobs.startDiscovery({roomId, publishedClueId, idempotencyKey})` is a
  membership-checked mutation for one explicit human request. The seed is the shopping
  phrase of one active, confirmed published interest/wish: 1–4 lowercase words, letters
  only, at most 40 characters. Phrases containing a recipient or participant name token
  are refused (`validation_failed`), never rewritten. Uncertain wording, exclusions and
  private evidence never reach the provider. Pending is persisted before the paid start;
  same-key retries, same-seed open/uncertain jobs and fresh (24 h) succeeded samples are
  reused instead of starting another run.
- `research/trendJobs.resumeDiscovery({roomId, jobId})` polls a known uncertain run only.
- `research/trendJobs.getDiscovery({roomId})` returns `Result<TrendDiscoveryView>`:
  latest job status (`FashionDiscoveryJobView` shape) and the current usable sample.
- Completion keeps only gift-shaped related queries that contain every seed word and are
  not local/informational (`discoverShoppingQueries`), up to 5, rising/breakout first.
  Each `TrendSuggestion` keeps its Google Trends source URL and the observed signals
  (`popularityIndex`, `growthPercent`, or breakout). Label: search interest, not sales.
- `research/research.startResearch` adds optional `trendJobId`. It must be a fresh,
  current, same-room succeeded job whose `publishedClueId` is among the search's clues;
  otherwise `stale_job`. The first suggestion becomes the one shopping query; an empty
  sample keeps the ordinary brief. Supplying both `fashionJobId` and `trendJobId` is
  `validation_failed`. Budget, exclusions, ranking and job fences are unchanged; a trend
  never becomes a per-product "trending" claim.

```ts
interface TrendSignal { kind: "top_search" | "rising_search" | "breakout_search"; popularityIndex?: number; growthPercent?: number }
interface TrendSuggestion { query: string; sourceUrl: string; signals: TrendSignal[] }
interface TrendDiscoverySample {
  mode: "live_sample"; label: string; actor: string; build: string; providerRunId: string;
  context: TrendContext; publishedClueId: string; suggestions: TrendSuggestion[];
  evidenceSummary: { returnedRows: number; observations: number };
}
interface TrendDiscoveryView { latestJob: FashionDiscoveryJobView | null; sample: (TrendDiscoverySample & { jobId: string }) | null }
```
### Live fashion discovery jobs (RC-014, Dev 4)

Owner: Dev 4 research. Consumers: Dev 1 discovery cards; Dev 3 optional search tools.
This adds a room-indexed `fashionJobs` table, isolated from payment and agent tables.
The new table has no migration of existing rows. UI and buyer-agent wiring are
separate consumers; existing research requests remain compatible.
BE-017 integration: deleting a room cancels open fashion jobs and purges every
fashion row through the room index in the job-first deletion phase. Fashion
workers refuse rooms marked `deletedAt` and members who have left, so late
provider responses cannot recreate data after access revocation.

- `research/fashion.startDiscovery({roomId, idempotencyKey})` is a membership-checked
  mutation. It derives one fixed seed (`denim outfit`, `jewelry outfit`, `sneaker outfit`,
  `sweater outfit` or `handbag outfit`, optionally prefixed `vintage `) from active,
  confirmed published interest/wish clues. When several categories match, the one with the
  most confirmed clues wins (ties keep table order); one request is still one paid run.
  The provider refuses any seed outside this allowlist. Raw private evidence, names and arbitrary
  user queries never reach the social provider. It persists pending before scheduling
  one bounded Actor start. Same-key retries reuse the job; same-seed open/uncertain
  jobs block duplicate paid starts. A current succeeded sample is reused for 24 hours.
  A known superseded run is fenced stale before a human explicitly requests the
  new revision; an unknown paid-start outcome without a run ID stays blocked for
  operator review even after knowledge changes.
- `research/fashion.resumeDiscovery({roomId, jobId})` polls an existing known run
  after uncertainty. It never creates a new Actor run. Unknown-start outcomes need
  operator reconciliation. Changed room knowledge makes a job stale.
- `research/fashion.getDiscovery({roomId})` returns `Result<FashionDiscoveryView>`.
  Only room members can see the current room's latest status and usable sample.
  A sample includes provider Actor/build/run provenance, original 30-day window,
  retrieval time, supporting published clue IDs, garment queries and TikTok post
  URLs. No raw captions, creator profiles, media URLs or private imports are stored.
  Ads are excluded by the existing normalizer; unflagged/unknown is not organic.
  Labels say sampled mentions, never viral, growing or platform-wide popularity.
- The pinned GoFetch Actor uses at most 20 results, no profile/comment expansion,
  one keyword and a $0.50 cap. Provider response limits and no-POST-retry rules apply.
  A lost worker becomes uncertain. Completion rechecks room knowledge and current
  confirmed clues; future/stale samples cannot be offered for shopping.
- Existing `research/research.startResearch` adds optional `fashionJobId`. If supplied,
  it must be a succeeded, fresh, same-room job for current knowledge. The first sourced
  direction becomes the one shopping query. If a valid sample has no corroborated
  directions, keep the ordinary published-clue brief; an empty social result never
  blocks gift search or invents a trend. Budget, exclusions and ordinary job fences
  remain server-owned. Discovery does not publish a recipient preference or establish
  product popularity, sizing, stock, garment age or purchase suitability.

```ts
interface FashionDiscoverySample {
  mode: "live_sample";
  label: string;
  actor: string;
  build: string;
  providerRunId: string;
  context: FashionSampleContext;
  supportingPublishedClueIds: string[];
  directions: FashionDiscovery[];
  evidenceSummary?: { returnedRows: number; validRecentPosts: number; excludedAdvertisingPosts: number };
}
interface FashionDiscoveryJobView {
  id: string;
  status: ResearchJob["status"];
  createdAt: number;
  lastError?: string;
  canResume: boolean;
}
interface FashionDiscoveryView {
  latestJob: FashionDiscoveryJobView | null;
  sample: (FashionDiscoverySample & { jobId: string }) | null;
}
```

`evidenceSummary` counts actual returned rows, normalized/deduplicated posts inside
the requested time window, and explicitly flagged advertisements among those
posts. Unknown advertising is not organic. It supports an honest empty-result
message; it is not a popularity score. Optional for compatibility with existing
stored samples from the first personal-dev check.

### Canceling an uncaptured Stripe authorization (Dev 4, RC-013)

`cancelAuthorization(intentId, idempotencyKey)` first retrieves the test-mode
PaymentIntent. Only manual `requires_capture` intents with zero captured funds
may be canceled; already-canceled zero-balance intents are returned from the read.
Other states need reconciliation or refunds. Every write requires a persisted
operation claim and stable key from Dev 2, and is never automatically retried.
Only an observed canceled intent with zero received/capturable cents is accepted.
This does not authorize cancellation or implement group recovery. Real sandbox
hold cancellation remains unverified; current reference:
https://docs.stripe.com/api/payment_intents/cancel.

### Organizer Checkout worker port (Dev 4 → Dev 2)

`runOrganizerCheckout(store, adapter)` consumes a server-only durable claim port;
it is not a public action or authorization policy. `store.claim()` must verify the
human organizer, current approved revision/total/conditions and enabled test mode,
then atomically return a persisted claim (or existing reference/pending result).
Only a newly claimed operation may POST. Every claim supplies the immutable
`StripeCheckoutInput` with `mode: "collect"` and its stored idempotency key.
`store.settle(claimId, result)` durably records the provider outcome under the
operation fence and returns true only if committed for that claim. No Checkout
URL is released until settlement succeeds. A database interruption after provider
success remains uncertain; a second worker never blindly creates a new session.

An existing reference is retrieved and checked against the same expected amount,
USD currency and all four binding IDs. Expired/completed sessions are not replaced
with another charge attempt. Only an observed open matching session supplies a
Checkout link; returning from that link is still not payment confirmation. The
runner uses the existing session/adapter DTOs. It requires Dev 2's implementation
of the two durable store methods before a public endpoint can use it.

```ts
interface OrganizerCheckoutClaim {
  claimId: string;
  input: StripeCheckoutInput;
  checkoutSessionId?: string;
}
interface OrganizerCheckoutStore {
  claim(): Promise<StripeAdapterResult<OrganizerCheckoutClaim | null>>;
  settle(claimId: string, result: StripeAdapterResult<StripeTestSession>): Promise<boolean>;
}
```


### Contributor Checkout worker port (RC-011, Dev 4 → Dev 2)

Additive transport integration; no new public endpoint or schema. The organizer
runner remains `collect` only. `runContributorCheckout(store, adapter)` requires
`authorize` mode, reserving one contributor's frozen approved share rather than
collecting the organizer total. Stripe manual capture is specified on the hosted
session; returning from Checkout never establishes authorization or capture.

```ts
type ContributorCheckoutClaim = OrganizerCheckoutClaim & {
  input: StripeCheckoutInput & { mode: "authorize" };
};
interface ContributorCheckoutStore {
  claim(): Promise<StripeAdapterResult<ContributorCheckoutClaim | null>>;
  settle(claimId: string, result: StripeAdapterResult<StripeTestSession>): Promise<boolean>;
}
```

Owner: Dev 4 transport. Consumer/implementation owner: Dev 2 durable store. No
existing caller migrates. The store must authorize the human attempt owner,
require the current fully approved revision and exact USD share, and persist the
operation key plus exclusive claim before returning it. It must not reissue a
create claim after an unresolved start without a session ID. Repeated known
sessions use GET only. Settlement persists session/intent references and checks
membership/current revision plus its operation fence before releasing a URL.
A rejected/failed settlement withholds the URL and must retain enough references
for later recovery. An open session is not an `authorized` payment attempt.

The offline rehearsal injects a fake HTTP transport into the real Stripe adapter
and exercises existing state-machine functions. Its in-memory claim store is a
test double, not an implementation of Dev 2's durable port or webhook receipt.
It creates no Convex records, reads no keys and calls no external service.


### Choose a sourced discovery direction (Dev 4, Phase 2)

`research/research.startResearch` accepts additive optional `discoveryQuery` with
`trendJobId` or `fashionJobId`. Existing callers keep the first-direction behavior.
The value must be 1–200 characters after trimming and exactly match one query in
that current same-room discovery's suggestions/directions. Arbitrary model text,
queries without a discovery job, empty samples with an explicit selection,
withdrawn support, expired samples and foreign jobs are refused before research
is created. A different selected query needs a new request key; selecting the
first query explicitly deduplicates with the old default call.

Owner: Dev 4. Consumers: Dev 1 ring actions, Dev 3 discovery planning. No schema
migration or agent/UI changes. The existing research job stores the selected
phrase in `brief.queryTerms`; its fingerprint binds the discovery job and query.
This records a search direction, not a new recipient clue or popularity score.
Show source context as “found while researching [query]”, never as proof that
an individual returned product is trending. Dismissing an idea on the map must
use Dev 2's agreed theme/signal semantics; this endpoint does not persist passes.


### Shared contribution simulation (Dev 4, demo only)

Alex selected a visibly labelled simulation instead of expanding live payment
orchestration. Convex owns shared demo state in `paymentSimulations`, separate
from Stripe attempts and proposal status. No payment/provider API is called.

```ts
interface ContributionSimulationView {
  mode: "simulation";
  revisionId: string | null;
  status: "no_proposal" | "waiting_for_approvals" | "ready" | "collecting" | "complete" | "wrapped" | "unavailable";
  payerCount: number;
  completedCount: number;
  myShareMinor: number;
  myCompleted: boolean;
  canSimulate: boolean;
  canWrap: boolean;
}
```

`payments.simulation.getState({roomId})` is a member query. `simulateContribution`
and `wrapGift` take `{roomId, revisionId}` and return `Result<ContributionSimulationView>`.
A contributor can simulate only their own positive share on the current fully
approved pledged revision; only the organizer can wrap, after every payer has
simulated. Duplicate clicks are idempotent. Revision changes or changed approval
fingerprints hide prior progress. Zero shares require no simulated payment.
The view shows only group counts and the caller's own share, never private caps.

Additive table: `paymentSimulations {roomId, revisionId, approvalFingerprint,
completedParticipantIds, wrappedAt?, createdAt}` with room/revision indexes.
The fingerprint binds current approval IDs, participant IDs, statuses and update
times. Room purge deletes this table. It contains no card/provider objects,
Checkout URLs or real payment statuses. Wrapping affects only this demo row,
never `proposalRevisions`, `paymentAttempts`, `giftWorlds` or merchant orders.
Amounts remain the current proposal estimate; unresolved tax/shipping must stay
visible. UI always says simulation and no money/order. No live-payment action,
refund/recovery expansion, deployment or environment change is part of this work.

Owners/consumers: Dev 4 backend + reusable payment component; Dev 1 mounts it in
the new ring map's box. Small shared edits: table fragment import/spread and purge
entry only. This does not add features to the retired tower/drawer paths.


### MAP-011 pure projection seam (Dev 4)

`recommendationThemeIds({roomId, knowledgeRevision, recommendation, themes, clues})`
consumes the proposed `MapTheme` shape above against mocks, returning sorted unique
IDs. It links only current same-room suggested/accepted themes, whose clue IDs
are all still active, through the recommendation's own active published-clue
citations. Dismissed/stale/foreign themes and withdrawn/foreign citations do not
link. No label matching or model-provided theme references are trusted. No theme
schema, signal mutation, ranking change or new map query is implemented here.
Dev 2 can use the helper in MAP-007 once the proposed contract is accepted.
