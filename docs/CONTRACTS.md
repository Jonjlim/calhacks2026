# Contracts

Shared interfaces for parallel work. These TypeScript shapes are documentation, not compiled code. When implementation starts, copy them into `lib/contracts/` and keep this file authoritative for names and semantics.

Owners change this document in the same PR as the code. Consumers mock; they do not invent sibling types.

Related: [ARCHITECTURE.md](ARCHITECTURE.md), [AI_AGENTS.md](AI_AGENTS.md), [COMMERCE_AND_PAYMENTS.md](COMMERCE_AND_PAYMENTS.md), [TEAM_TASKS.md](TEAM_TASKS.md).

## Conventions

### Map-first room (proposed, D19, 2026-10-24)

**Status (2026-10-24): partly built.** Implemented with tests (`convex/mapAi.test.ts`), differing from the sketch below as follows:

- Direction signals: `mapSignals.setDirection({ roomId, targetKind: "clue" | "theme", targetId, value: 1 | -1 | 0 })` and `mapSignals.listSignals({ roomId })` → `{ targetKind, targetId, up, down, voters: { participantId, value, at }[] }[]`. Theme ids are council theme ids or the interim groups `interest | wish | moment`.
- Themes: `agents/themes.suggestThemes({ roomId })` (model with preset fallback, needs ≥3 memories, `stale_job` if knowledge changed) and `agents/themes.listThemes({ roomId })` → `{ id, label, clueIds, source, stale }[]`. Rename, merge and dismiss are not built.
- Sharpen: `agents/themes.sharpen({ roomId })` picks the two leading gifts from `readCatalog`, `getSharpen({ roomId })`, `answerSharpen({ sharpenId, option })` (publishes the option's clue as the answering member and bumps knowledge), `dismissSharpen({ sharpenId })`. Options carry `listingIds` instead of theme ids. Uses `AskedSlot`: no.
- Cursors: `map.moveCursor` accepts `space: "rings"` for map-plane coordinates (x, z stored as x, y).
- Room deletion purges all map tables, including the earlier cursor, sprout, feedback, position and idea-call tables.
- Room photos (D20): `photos.sharePhotos({ roomId, files: { storageId }[], sourceId? })` claims 1–3 fresh uploads against the caller's upload grants; `photos.listRoomPhotos({ roomId })` → `{ id, uploaderId, url, sourceId?, clueIds, createdAt }[]` for members, where `clueIds` are published clues read from the same pictures; `photos.deletePhoto({ photoId })` is uploader-only. The client uploads a second, private copy through `importMediaEvidence` for the read-once extractor.

Still proposed: theme rename/merge/dismiss, `getMapState` consolidation, and `themeIds` on recommendations (the client derives theme placement from cited clue ids).

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

### Agent collaborators and the Gift Twin (demo, D20, 2026-10-24)

Latency update (Dev 3, 2026-10-25; consumers Dev 1/Dev 2): the first pass records
screened deterministic insights/votes immediately and marks the vault ready.
`internal.giftTwin.agent.enrichVault` adds model-only insights and unresolved votes
independently in the background, with the same upload/expiry fences and dedupe.
`recordFindings` and `reviewPosts` accept optional `deterministicReview: boolean`;
only server-pattern findings use it to run the existing deterministic review
without a second model round-trip. That review is restricted to the exact inserted
`postIds`; it cannot pick up unrelated pending model posts. Model-generated
insights retain model review.
New-idea evaluation similarly records pattern votes first and sends only unresolved
refs to Moss/model. Existing votes remain immutable advisory posts.

`internal.giftTwin.agent.checkIdeas` accepts `{ collaboratorId, uploadId }`, claims
unchecked current idea refs transactionally, and schedules their evaluation without
starting another polling loop. Published room knowledge, new sprouts and completed
listings wake it after 200 ms. The 30-second watch is a recovery fallback. Bursts
dedupe at the transactional claim. No raw private data reaches the shared agent.

Moss indexes at most 256 distinct messages per evaluation: gift/preference-bearing
messages first, retaining both recent and older evidence; remaining space samples
the rest. Keyword evidence still searches the entire authorized vault. This bounds
embedding latency but semantic-only matches outside that working set may be missed.
No private cross-action cache, disk index, new table or provider is introduced.

Moss memory (2026-10-25): Owner Dev 3; consumers Dev 1 (existing screened feed),
Dev 2 (authorization/purge review). `internal.giftTwin.memory.vote` accepts only
`{ collaboratorId, uploadId, refs?: string[] }` and returns `TwinVoteCast[]`.
It reuses the twin's authorized snapshot/chunk queries, builds an ephemeral local
Moss session, and retrieves up to eight semantic/keyword matches per current
room idea. Returned IDs must resolve to that invocation's authorized messages;
SDK-returned text is never trusted. The recipient model gets those messages plus
bounded keyword evidence (at most 12 excerpts and 3,600 message characters per
idea). Only screened votes reach the existing `recordFindings`
and review path. Buyer/council agents never receive raw recall results.

Opt in with Convex server variables `GIFT_TWIN_MOSS_ENABLED=true`,
`MOSS_PROJECT_ID`, and `MOSS_PROJECT_KEY`. Missing configuration or SDK failure
uses existing keyword evidence. Local sessions are closed after each evaluation;
no cloud index, disk snapshot, cross-upload cache, new table, public endpoint, or
data migration. Setup/indexing and query timings are separate, numeric-only server
diagnostics; no sub-10ms application latency claim. Moss sends usage telemetry
(including opaque random session names, counts and timings), never message or
query text. Vault expiry is checked on every read and before findings are saved,
including when the scheduled deletion has not run yet. Existing insight extraction
still scans the authorized vault; Moss supplies evidence for idea evaluation.
`internal.giftTwin.memory.smoke` takes `{}` and returns `{ ok: true, passed,
setupMs, indexingMs, queryMs }` from a fixed synthetic paraphrase check, or
`{ ok: false, reason, stage?, category? }` with fixed diagnostic strings. It reads no room or
vault data, creates no cloud index, and supports validating the native Convex
runtime before enabling memory retrieval.

**Status: demo, behind `GIFT_TWIN_DEMO_ENABLED=true`.** Owner: Dev 3 (agents). Consumers: Dev 1 (room UI), Dev 2 (schema review, purge). Full design: [GIFT_TWIN.md](GIFT_TWIN.md).

An **agent collaborator** is an AI agent that joins a room next to people and posts notes the way a friend would ("I learned that Maya has been playing tennis"). It is not a `Participant`: it has no share, cap, selection, or approval, and its up/down votes are advisory posts, separate from participant `votes`. The first kind is `gift_twin`: the recipient pairs their Mac, grants **one-time permission** to upload the messages they sent into a temporary server-only vault, and a cloud twin agent acting for the recipient posts insights and votes on the room's ideas (existing and new) until the vault expires. `trend_scout` is reserved for the planned trend agent and uses the same tables and feed.

Shared types and Zod schemas live in `lib/agentCollaborators/contracts.ts` (used by Convex, the Mac companion, and the UI).

Map attribution: `getFeed` returns all room-indexed non-dismissed posts with optional `ideaRef` and `authorName`, so older published notes retain their AI origin even after disconnect. Dev 3 owns this additive view change; Dev 1 consumes it via optional `RoomData.agentCollaborators`. No table migration. The map uses `publishedClueId` to label twin-authored knowledge with the twin name, dedicated icon and violet styling; the inviting member remains the permission owner. `listing:<id>` evaluations attach to `gift:<id>`, and evaluations of gift-idea clues attach to `idea:<id>`. Reviewed evaluations (`added` or `noted`) show Supports / Doesn’t fit badges and screened rationale, separate from participant vote totals and revision approvals. Suggested/dismissed posts do not create evaluation badges. No private vault text or device credentials are exposed.

Recipient web onboarding (D20): members create the twin only at `/room/[roomId]/twin`. `createPairing` still returns the existing single-use code; the UI builds `/twin#invite=<pairingCode>` (fragment, never sent in HTTP requests). Opening the link does not consume it. Only an explicit recipient acceptance pairs it. The recipient page uses the same device operations without room membership and never receives room content. The device token is generated with Web Crypto and kept in this tab's session storage; closing the tab loses management access, but server expiry still applies. No raw messages are stored in browser storage.

After accepting the terms, the recipient explicitly selects `chat.db`; selection immediately reads and uploads through the CLI-equivalent pipeline: scan the newest 1 MiB of message content (incoming content counts toward that budget), then use the existing companion `planUpload` to send `VaultMessage` text/time. There is no extra content screening, preference extraction, message review/removal, or second confirmation before uploading. The CLI's existing sent-only selection, tapback exclusion, and 2,000-character text limit remain unchanged. The read limit and server vault text limit are now 1 MiB. `uploadMessages` strips emoji sequences server-side before storage and skips messages left empty; its returned count includes only stored messages. A batch containing only emojis succeeds without creating an empty chunk. Plain digits and ordinary text are preserved. The recipient uses a visible file-picker button; selecting the database after consent starts upload. The database itself, incoming messages, handles, and attachments never leave the browser. File selection is required: a website cannot obtain automatic macOS Messages access. Unsupported databases and file permissions are visible errors. The browser offers status, delete now, disconnect, and explicitly labelled sample data. Failed uploads can be deleted or replaced; no automatic upload retry can duplicate batches. Owner: Dev 3; consumers: Dev 1 and Dev 2. Migration: no table or endpoint shape change; pairing creation broadens from organizer to room member. CLI remains compatible.


```ts
type AgentCollaboratorKind = "gift_twin" | "trend_scout";
type AgentCollaboratorStatus = "pending_pairing" | "active" | "revoked";
type TwinInsightCategory = "interest" | "wish" | "dislike" | "owns" | "style";
type TwinVaultStatus = "uploading" | "processing" | "ready" | "expired";

interface VaultMessage {           // one message the recipient sent; never other people's
  text: string;                    // ≤2,000 chars
  sentAt: number;
}

interface TwinInsight {            // a gift idea found in the messages; strict, screened
  category: TwinInsightCategory;
  text: string;                    // ≤160 chars, third person, no quotes/links/contact details/sensitive topics
  confidence: "low" | "medium" | "high";  // low is dropped; one clear mention of a giftable thing is medium
  evidenceCount: number;
}

interface TwinVoteCast {           // the twin's vote on one room idea
  ideaRef: string;                 // server-issued ("clue:<id>", "idea:<id>", "listing:<id>")
  vote: "up" | "down";
  text: string;                    // same screening as insights
  category?: TwinInsightCategory;  // downvotes: "dislike" | "owns"
  confidence: "low" | "medium" | "high";
  evidenceCount: number;
}

interface TwinVaultView { status: TwinVaultStatus; messageCount: number; expiresAt?: number }

interface AgentCollaboratorView {
  id: string; roomId: string; kind: AgentCollaboratorKind; displayName: string; status: AgentCollaboratorStatus;
  deviceLabel?: string; pairingExpiresAt?: number;
  consentedAt?: number; reportedAt?: number; vault?: TwinVaultView; createdAt: number;
}

interface AgentCollaboratorPostView {
  id: string; collaboratorId: string;
  kind: "insight" | "vote";
  category?: TwinInsightCategory; text: string; confidence: "low" | "medium" | "high";
  evidenceCount?: number;
  ideaRef?: string;                    // server-validated room target, never private evidence
  authorName?: string;                 // collaborator display name, including historical posts
  ideaText?: string; vote?: "up" | "down";   // votes
  status: "suggested" | "added" | "noted" | "dismissed";
  publishedClueId?: string; createdAt: number;
}
```

| Operation | Kind | Input | Output | Access |
| --- | --- | --- | --- | --- |
| `giftTwin/room.createPairing` | action | `{ roomId, recipientLabel? }` | `Result<{ collaboratorId, pairingCode, expiresAt }>` | Member; flag on; one connected twin per room; code single-use, 15 min, stored hashed |
| `giftTwin/room.getFeed` | query | `{ roomId }` | `Result<{ collaborators, posts }>` | Member; never returns hashes, upload ids, or message text; dismissed posts hidden |
| `giftTwin/room.revokeCollaborator` | mutation | `{ collaboratorId }` | `Result<null>` | Organizer; the token stops working and the vault is deleted |
| `giftTwin/device.pair` | mutation | `{ pairingCode, deviceToken, deviceLabel? }` | `Result<DeviceSession>` | Anyone with a valid code; flag on |
| `giftTwin/device.session` | query | `{ deviceToken }` | `Result<DeviceSession>` | Device; includes `vault` status, never message text |
| `giftTwin/device.startUpload` | mutation | `{ deviceToken, consent: true }` | `Result<{ uploadId, expiresAt }>` | Device; flag on; `consent` must be true; deletes any earlier upload; schedules deletion at `expiresAt` (24 h) |
| `giftTwin/device.uploadMessages` | mutation | `{ deviceToken, uploadId, messages: VaultMessage[] }` | `Result<{ messageCount }>` | Device; ≤1,000 messages and ≤250,000 chars per call; ≤1 MiB of UTF-8 message text and 40 batches per upload |
| `giftTwin/device.finishUpload` | mutation | `{ deviceToken, uploadId }` | `Result<{ messageCount, expiresAt }>` | Device; schedules the twin agent |
| `giftTwin/device.forget` | mutation | `{ deviceToken }` | `Result<null>` | Device; deletes the vault now; posts stay |
| `giftTwin/device.disconnect` | mutation | `{ deviceToken }` | `Result<null>` | Device; same as revoke |
| `internal.giftTwin.agent.processVault` | internal action | `{ collaboratorId, uploadId }` | — | First pass: insights + votes on current room ideas (model role `recipient`) |
| `internal.giftTwin.agent.watchTick` | internal mutation | `{ collaboratorId, uploadId }` | — | Every 30 s while the vault is `ready`: claims new room ideas and schedules `voteOnNewIdeas` |
| `internal.giftTwin.agent.expireVault` | internal mutation | `{ collaboratorId, uploadId }` | — | Deletes the vault at `expiresAt` |
| `internal.giftTwin.review.reviewPosts` | internal action | `{ collaboratorId }` | — | Publishes insights (LLM may veto) and downvotes; notes upvotes; hides the rest |

Rules:

- Vaulted messages (`twinVaultChunks`) are server-only. No public or device query returns them; only `internal.giftTwin.agent.*` reads them. They are deleted at expiry, on `forget`, on disconnect/revoke, on a new upload, and on room purge.
- Agent output is untrusted: `recordFindings` re-validates every insight and vote with the Zod schemas before insert. Vote refs must name a current room idea; the stored `ideaText` is the server's copy.
- The gift agent, not a person, decides what becomes room knowledge. Insights and downvotes become `manual` `PublishedClue`s attributed to the member who invited the twin. Post `status`: `suggested` = awaiting review, `added` = published, `noted` = shown with no new clue (upvotes), `dismissed` = skipped and hidden.
- Category to clue kind: interest/style → `interest`, wish → `explicit_wish`, dislike → `exclusion`, owns → `ownership`.
- One vote per room idea per twin (`dedupeKey = vote:<ideaRef>`).
- Errors: `unauthorized`, `not_found`, `validation_failed`, `refused`, `stale_job` (upload no longer open).

Migration: additive tables `agentCollaborators`, `agentCollaboratorPosts`, and `twinVaultChunks` (`convex/giftTwin/schema.ts`), all included in room purge. Replaces the demo's earlier `device.roomContext` / `device.submitReport` (on-device extraction) and renames evaluation posts (`kind: "evaluation"`, `verdict`) to votes (`kind: "vote"`, `vote: "up" | "down"`). Existing demo rows in `agentCollaboratorPosts` must be cleared before pushing. No non-twin table, endpoint, or contract changes. Production promotion: see [GIFT_TWIN.md](GIFT_TWIN.md) § Production path.

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
  foundBy?: SearchOrigin; // provenance only; see "Search provenance and variety" below
}

interface SearchOrigin {
  query: string;
  source: "memory" | "trend" | "discovery";
  publishedClueId?: string;
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

Five registered Fetch.ai uAgents run in one process (a uAgents Bureau). The **Courier** is the public agent (Chat Protocol for ASI:One, plus the website's REST `POST /council/run` and `GET /health`; the `POST /council/run` acceptance additively returns optional `agentAddress` (the Courier's `agent1…` address), which Convex stores as optional `councilRuns.agentAddress` and exposes on the room's council `run`; the request additively accepts optional `callbackSite` — the calling deployment's `https://<name>.convex.site` URL, sent only when the caller's `CONVEX_SITE_URL` has that shape — which must exactly match (after trailing-`/` trim) an entry of the agent's `COUNCIL_ALLOWED_SITES` (comma-separated, default `CONVEX_SITE_URL`) or the run is refused with `{ ok: false, error: "callback not allowed" }`; every events/results/research callback for that run then goes to that site, so one agent serves several deployments sharing `COUNCIL_INGEST_SECRET`. Without it, and for ASI:One chats, the agent's `CONVEX_SITE_URL` is used). It asks four specialist agents with typed uAgents messages and `ctx.send_and_receive`; each specialist emits its own events for its actor at its real execution boundaries:
| Actor | Task | Does |
| --- | --- | --- |
| `archivist` | `analyze_memories` | Extracts clues (interests, wishes, owned items, dislikes, budget) from the request/memories |
| `muse` | `design_decoration` | Maps clues to a `DecorationSpec` from the approved library only |
| `scout` | `research_gifts` | Real product research via the existing Apify pipeline (`/council/research`), cached |
| `keeper` | `check_constraints` | Budget, ownership and dislike rules; hard exclusions vs. soft notes |
| `courier` | `deliver_recommendations` | Coordinates the specialists and prepares the final answer |

Specialist messages (`fetch-agent/council/messages.py`, uAgents `Model`s). Every request carries `{ run_id, source: "asi1"|"web", demo_key?, room_run }`; every result carries `{ run_id, ok, error? }`. Nested payloads are the JSON form of the Python contracts in `fetch-agent/council/contracts.py` and are re-validated by the receiver:

| Role | Request | Result |
| --- | --- | --- |
| Archivist | `ArchivistRequest { memories: [{memory_id, text}], budget_minor? }` | `ArchivistResult { analysis? }` |
| Muse | `MuseRequest { analysis, memory_ids }` | `MuseResult { decorations: DecorationSpec[] }` |
| Scout | `ScoutRequest { analysis }` | `ScoutResult { report: ScoutReport }` |
| Keeper | `KeeperRequest { analysis, listings: Listing[] }` | `KeeperResult { report: KeeperReport }` |

Timeouts and fallback: if a specialist does not answer within its timeout (`COUNCIL_<ROLE>_TIMEOUT_S`) or replies with something that fails validation, the Courier emits that actor's `failed` event (the `error` says the local fallback was used) and runs the same role function in-process without further events for that actor. Late events from the abandoned specialist are dropped. The Scout is the exception: its fallback runs no second search and reports that no listings were verified. ASI:One (`asi1`) may assist the Archivist (extra clues found in the text), the Muse (an approved asset instead of the generic charm) and the Keeper (one "Fit: …" note per kept listing, no digits or currency); deterministic rules decide everything else and every model output is validated. No event or callback shape changed: event `result` keys stay `{ summary?, count?, decorations?, cached?, error? }`.
`CouncilEvent` — `{ eventId, runId, actor, task, status: started|completed|failed, sequence, timestamp, result? }`. `result` is display-only and small: `{ summary?, count?, decorations?, cached?, error? }`. Products, URLs and raw memories never travel in events. `roomId` is never invented: ASI:One runs have none; web demo runs carry a browser `demoKey`.

`DecorationSpec` — `{ memoryId, jar: wish|interest|moment, assetId, color, placement, label }`, every enum from `lib/council/library.json`.

Tables: `councilRuns` (`runId`, `source`, `demoKey?`, `status`, `lastSequence`, timestamps), `councilEvents` (unique `eventId`), `giftDecorations` (unique per `demoKey` + `memoryId`).

HTTP (server-to-server, `Authorization: Bearer $COUNCIL_INGEST_SECRET`): `POST /council/runs`, `POST /council/events`, `POST /council/research`. Queries: `council.demoState({ demoKey })` — latest run, its events, and persisted decorations.

Semantics: events are idempotent by `eventId`; state per actor is the highest `sequence` seen, so duplicates and out-of-order delivery cannot rewind a finished task; a decoration is upserted per memory, so reconnects never duplicate charms; a run with no event for 120 s reads as `interrupted`.

---

### Room council integration (Dev 1 + Dev 3 + Dev 4)

Client parity (Dev 1; consumers: map, book, phone): adding a gift uses `addGiftToBox` on every surface and never silently replaces an existing collection. Approval screens show every frozen `revision.items` entry and retain revision controls after pledging. The phone/list surface also serves as the accessible fallback if WebGL fails.

Live display projection: `RoomData.researchJobs?` carries the existing authorized `jobs.listRoomJobs` rows, now including optional `directionId` and up to 25 unfinished jobs alongside the ten newest jobs (deduplicated); `RoomWorld.members?` carries derived `CouncilMemberState` values from council events and authorized agent/research/trend jobs. Active jobs take precedence over historical events; pending, uncertain, failed, canceled and stale work have distinct captions. The display sequence is a change token for projected jobs, not an ingested council-event sequence. No synthetic events are persisted. Private extraction activity stays owner-only. Pending direction/theme/sharpen actions additionally drive the requesting viewer’s Muse caption only for the actual promise lifetime. Ring research supports `uncertain` separately from `running`, and per-direction progress uses the stored direction ID. These fields are additive; older clients can use `latestResearch`.


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
  screen?: "model" | "words"; // model = LLM kept only product/style/experience searches; words = fallback filter
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


### Trend sprouts on the gift map (Dev 4, Phase 2)

`research/trendJobs.getDiscovery` adds optional `listingLinks: TrendListingLink[]`
(`{ listingId, query, sourceUrl }`): active listings from succeeded research jobs
bound to the current usable trend sample (fingerprint) whose shopping query is one
of its suggestions. Membership-checked, last 10 research jobs, no schema change.

On the map (`lib/map/trendIdeas.ts`, `useGiftRings`): a memory's **Look for trends**
calls `startDiscovery`; its suggestions sprout between the theme and gift rings at that
memory's angle, labelled by observed signal ("breakout search", "searches +N%").
**Research this direction** calls `startResearch` with `trendJobId` + `discoveryQuery`.
Gifts with a link say "found while researching [query]" and can open the Trends
source; "Why this?" lights the sprout. Never a per-product trending claim. Optional
`RoomData.trends` and `RoomActions.findTrends` / `researchTrend` / `passTrend` keep preview mode unchanged.

**Several memories.** `getDiscovery` adds `samples` (newest usable sample per memory, at
most 6; `sample` is the first). Trend jobs are no longer fenced on room
`knowledgeRevision`: a new memory keeps other memories' ideas. A job still goes stale
when its own memory is withdrawn or its seed changes, or the requester leaves.

**Shared passes.** Additive table `trendPasses {roomId, trendJobId, query, participantId,
createdAt}` (indexes `by_room`, `by_job_query_participant`; purged with the room).
`research/trendJobs.setTrendPass({roomId, trendJobId, query, passed})` is a member
mutation, one row per member per suggestion, idempotent; `passed: false` takes it back.
The query must be one of that job's suggestions. `getDiscovery.passes:
TrendPassSummary[]` (`{trendJobId, query, count, mine, passerNames}`). A pass fades the
idea and shows "✕ N passed" for everyone; it never hides or deletes the idea or any memory.
This is interim until MAP-012 direction signals cover trend ideas.

**Automatic lookup.** After `publishClue`, `upsertManualPreference` and `map.plantSprout`
insert a memory, they call `scheduleAutoTrend` (one line each in Dev 2/Dev 3 files).
`internal.research.trendJobs.autoDiscover` then runs the normal `startDiscovery` path
with key `auto:<clueId>` for a confirmed interest/wish with a safe seed. At most
`AUTO_TRENDS_PER_ROOM = 3` automatic jobs per room (about $0.60 worst case); cached
24 h samples and open jobs are reused and do not count. Clients cannot use `auto:` keys.
Set Convex env `TREND_AUTO_DISCOVERY=off` to disable.

**Gift-shaped filter.** `isGiftShapedQuery` (`lib/research/trends.ts`) keeps a related
search only if it names a product, a style, or a bookable experience (tickets, classes,
lessons, workshops, tours, tastings) and is not news, an event result, or a lookup
(deaths, accidents, results, schedules, tournaments, how to, near me, names…). Years are
dropped unless paired with an experience word. The filter also applies when reading
stored samples, so older samples never resurface filtered queries, and
`startResearch`/`setTrendPass` refuse them.

**Buyer agent.** `BuyerSnapshot.trendDiscovery?: TrendAgentContext`
(`{mode, label, ideas: {publishedClueId, query, signal, retrievedAt}[]}`) lists current
ideas minus any with a pass; it participates in the buyer input version. The prompt lets
the agent put one supplied query first in a search or mention one idea as a related
search, never as a preference, popularity claim or invented query.

`emptyTrendNote(sample)` in `lib/map/trendIdeas.ts` returns a plain sentence when a
finished sample has no suggestions: "no related US searches" when Google returned no
observations, or "none for something to buy or book" when every related search was
news or a lookup. Null when ideas exist. The map shows it in the memory's caption.
Pure; reads only fields already in `TrendDiscoverySample`.

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


### Gift box with one or multiple gifts (Alex-authorized integration)

Owners: Dev 2 selection/proposal state, Dev 4 simulation integration. Consumer:
Dev 1 buying screen. This is a bounded basket, not an optimizer or merchant order.

`proposals.setGiftBox({roomId, listingIds})` atomically replaces the box with
1–12 distinct same-room USD listings (one unit each). An empty array clears it.
Only the organizer may change it; payment-frozen proposals remain frozen.
Input order is retained for display; an identical ordered box is idempotent.
`selectGift` remains the backward-compatible replace-with-one operation.
`getSelection` returns the existing selection plus optional `items`.

```ts
interface GiftBoxItem {
  listingId: string;
  quantity: 1;
  listingSnapshot: Pick<ProductListing,
    "title" | "sourceUrl" | "priceMinor" | "priceStatus" | "retrievedAt"
    | "currency" | "shippingMinor" | "shippingStatus" | "imageUrl">;
}
// Additive fields on GiftSelection and ProposalRevision:
// items?: GiftBoxItem[];
```

When present, `items` is the complete box, including the first item. Legacy
`listingId`, `quantity` and selection `listingSnapshot` describe only that first
item for old clients; they must never be used as the multi-gift total. Legacy
rows without `items` are interpreted as one gift. No existing-data migration is
required. New revisions freeze every item's observed snapshot, combined estimate,
shares and conditions. Sum each observed price and separately observed shipping;
unknown shipping/tax remain explicitly excluded, with no inferred combined
shipping discount. Unknown/nonpositive/unsafe prices, unsafe totals, unavailable
or invalid items make the whole proposal infeasible. No partial box funding.

Any material item snapshot change (including a second item's price or shipping),
box membership/order change, or changed shares supersedes the revision and its
approvals. Invalidating any selected item clears the entire box and its revision,
matching the existing conservative invalidation behavior. The organizer can then
reselect the remaining valid items. Simulation follows the combined revision and
therefore resets with it; a real charge/order is never created. Each item keeps
its own source link. Dev 1 must render `revision.items` for approval and
`selection.items` for the current box, with the one-item fallback for old rows.


### Search provenance and variety (Dev 4, Phase 2)

Owner: Dev 4. Consumers: Dev 1 (gift captions, "Why this?" MAP-016), Dev 3 (catalog reads). Additive: one optional `Recommendation.foundBy` field; no schema, endpoint or validator change. Migration: none.

- **`foundBy`.** Each research pool comes from exactly one provider search (the first query term), so every recommendation in it carries that `query`. `source: "memory"` names the active published clue whose search phrase it was, or, for a query written around a memory (the buyer agent writes "hiking gifts"), the most specific clue whose every search word the query contains, ignoring generic words like "gifts" or "ideas"; `"trend"` names the chosen Google Trends suggestion and its clue; `"discovery"` is any other sourced direction, or a memory since withdrawn (no `publishedClueId` then). It says how a listing was **found**. It is never a clue citation: `publishedClueIds`, scores and exclusions are unchanged, and the buyer agent's citation rules still read only `publishedClueIds`.
- **Explanation.** A listing that no clue matches, found by a memory search, now reads `Found by searching "hiking" from "we hiked mt hood". No published clue matches this directly`. Matched listings and trend finds keep their existing wording (the map already captions trend finds).
- **Variety.** `rankListings` keeps the best-ranked listing of each product and at most `MAX_PER_SELLER` (3) per seller before other sellers' products. A product is its title before any `|`, without size, fit, colour, pure-number or catalog-code words; titles match when equal or when one extends the other by at least three leading words. Men's and women's versions stay separate. A seller's further distinct products fill only slots nobody else can. This changes which rows are shown and their order, never a score or citation. It applies everywhere ranking runs (room catalog, council, agents).
- **Search terms.** `shoppingPhrase` turns a memory told as a story about a reviewed activity verb into the activity (`we hiked mt hood` → `hiking`, `avid climber` → `climbing`, `I ran a marathon` → `running`), drops enthusiast suffixes (`matcha drinker` → `matcha`), and keeps only the object of a plain story verb after a pronoun (`we got matcha` → `matcha`, `we tried rock climbing` → `rock climbing`). A past tense counts only with a subject or a where/when/with continuation, so `baked goods`, `knitted socks`, `bowler hat` and `camper van` stay products. Repeated-letter typos in leading framing words (`lovees`, `obsesssed`, `ownns`) are repaired by comparing squashed spellings, so real words like `gloves` or `lives` are never rewritten. This feeds the search brief, ranking tokens and Google Trends seeds alike.


### Directions flow — trial (D23, `dev4/directions-trial`)

Owner: Dev 4 for the trial, touching Dev 3 (agents), Dev 2 (schema/signals) and Dev 1 (map). **Trial branch only** until the team reviews it. Every field below is additive and optional for old clients.

Memories → directions → gifts. A direction is the council's suggestion of one gift direction that combines memories. It is an interpretation, never room knowledge: it publishes nothing, and it never changes budgets, caps, selection or approvals.

```ts
interface MapDirection {
  id: string;
  label: string;            // 2–6 words, e.g. "Vintage-pattern trail jacket"
  query: string;            // the one shopping search for it, ≤ 60 chars
  why: string;              // one sentence grounded in the cited memories
  clueIds: string[];        // ≥ 2 active published clues, unless one is an explicit wish
  trend?: { trendJobId: string; query: string }; // a caught trend cloud it weaves in
  broad: boolean;           // rests on one broad memory → the council asks one question
  source: "agent" | "preset";
  stale: boolean;           // memories changed since it was proposed
  researched: boolean;      // a research job exists for it
}
```

- `agents.directions.propose({ roomId })` (action, any member, explicit tap). Model output is Zod-validated: cited memory numbers must exist and be active; a direction citing one memory must cite an explicit wish; no links, prices or sensitive traits. Without a model it builds presets by pairing published interest/wish phrases. It keeps researched directions, replaces unresearched ones (max 4 shown), starts **one** room-level Google Trends lookup for a memory without a recent sample, and, for a new broad direction, opens one probe question.
- `agents.directions.list({ roomId })` → `Result<MapDirection[]>`, membership-checked.
- **Probe questions** reuse `mapSharpens` with optional `directionId` and empty `listingIds`/`finalistIds`. Answering publishes the chosen sentence as the answering member's memory, as Sharpen does. A preset Sharpen option (no model) now has an empty `clue`; answering it casts that member's up vote on its listing instead of publishing product text as a memory.
- **Signals.** `mapSignals.targetKind` adds `"direction"` (target: direction ID) and `"trend"` (target: `trendJobId:query` from a usable sample). On a trend, +1 = caught, −1 = let it drift. A direction or gift fades once passed and leaves the map when at least half the room has passed and nobody pulled it in. Nothing is deleted.
- **Research per direction.** `research.startResearch` accepts optional `directionId`. The direction's `query` becomes the one search; its clues must be included. The job stores `directionId`; jobs in different directions run side by side, and only a newer job **in the same direction** makes one stale. `listRecommendations` merges the newest succeeded pool per visible direction (top `GIFTS_PER_DIRECTION` = 4 each, after variety) with the general pool (top 4 when directions exist, otherwise the usual 12).
- `SearchOrigin.source` adds `"direction"` with optional `directionId`. `RecommendationsView` adds optional `searchPools: { jobId, directionId?, query, found, removedByClues, foldedDuplicates, shown }[]`, so "Why this gift?" can show what each search did.
- **Trend clouds.** Publishing a memory no longer starts a trend lookup. At most 3 uncaught, unpassed suggestions drift through the outer sky; a trend never starts a search by itself.
- **"She already has it"** publishes `Already owns <category>` (the product's last two naming words, e.g. "hiking boots") instead of the full listing title, so it filters similar gifts and keeps the memory ring readable.

#### Passes the council reacts to (D23 trial)

- **Reasons.** `votes.castVote` and `mapSignals.setDirection` accept optional `reason: "style" | "price" | "has_similar" | "vibe"` on a pass ("not her style", "too pricey", "she has something like it", "wrong vibe"). Stored on the vote/signal row; ignored on pulls. Skipping the reason is still a pass.
- **Retiring.** A direction is retired (`mapDirections.retiredAt`, never deleted) when the room has let the direction go (`fadeOf` = gone) or let `GIFT_PASSES_TO_RETIRE` (2) of the gifts its newest search found go. Retired directions leave `agents.directions.list` and the catalog; their search, reasons and history stay in the decision log.
- **Replacement.** Retiring schedules `internal.agents.directions.replace`: one new direction beside the others (`replaces` links them), drafted with the same model/preset path and checks, told which directions the room passed on and why ("too pricey" asks for a simpler or smaller gift). It never deletes or resets other directions and starts no trend lookup.
- **Pulls.** A direction pulled in (more pulls than passes) shows one more gift (5 instead of 4). `listRecommendations` is ordered by the room's net gift votes, then score: pulled gifts lead and passed ones trail. Scores and citations are unchanged; the map keeps this server order.
- The retirement and the replacement each write one council line to the decision log, which also reaches every member's status line for 15 seconds.

#### Decision log — "How we got here" (D23 trial)

```ts
interface TrailEntry {
  _id: string;
  at: number;
  stage: "memories" | "council" | "steering" | "search" | "choice" | "money";
  actor: "council" | "checks" | "trends" | "search" | "person";
  participantId?: string; who?: string;     // set for "person"
  outcome: "kept" | "rejected" | "info";    // "rejected": a check threw it out, or a friend passed
  text: string;                             // one plain sentence, ≤ 280 chars
  directionId?: string; listingId?: string; clueIds?: string[];
}
```

- `trail.list({ roomId })` → `Result<TrailEntry[]>`, membership-checked, oldest first, last 300.
- Append-only `roomTrail` table, written inside the steps themselves: how memories were read as search words; each direction the council kept (with its why and search) and each one the checks threw out (with the reason); the probe question; each Google Trends screen result (seen vs kept); each search's outcome (results, kept, dropped, failures); pulls/passes on directions and gifts, caught/dropped trend clouds, question answers, "she already has it"; who put what in the box; approvals with the **room-visible share** and total, and the "everyone approved — simulated" line.
- **Privacy:** only room-visible facts. Never raw imports, unpublished guesses, recipient-private data or anyone's contribution maximum. Logging never blocks or changes a decision. Purged with the room.
- The map opens it from the box's "Why this gift?", a gift's ⋯ menu, and the council menu; lines on the chosen gift's path (same listing, direction or cited memories) are highlighted.


### Live group question votes and additive gift-box actions

Alex requested changeable group question votes, vote-driven ranking and multiple
selected gifts in the map UI. Owners: Dev 4 implementation; Dev 1 consumes the
map controls, Dev 2 reviews membership/selection and Dev 3 consumes questions.

`mapSharpens.ballots?` is an additive array of `{participantId, option, updatedAt}`
with at most one ballot per member and 2,000 ballots per question. Old rows remain
valid and room purge already deletes the parent. `questionPolls.state({roomId})`
returns the latest non-dismissed question's ID, live option counts, own option,
member/voter counts, leader (null on tie), open/closed/stale status and canFinish.
`questionPolls.vote({questionId, option: number | null})` records, changes or
withdraws the caller's own vote; it rejects nonmembers, stale, superseded or
closed questions and invalid options. Voting never publishes a clue, changes
money, or changes the explicit listing votes table. Organizer-only
`questionPolls.finish({questionId})` closes a current poll with a unique leader;
ties remain open or can be skipped through the existing dismissal operation.
Existing answerSharpen remains for compatibility; the live map uses poll votes.

Research ordering applies direct gift votes, then question support, then existing
relevance/deterministic tie order BEFORE truncating a pool. Question support is
an advisory signal from explicitly linked product IDs or literal product-title
matches to an option; it is not a recipient fact or a new evidence citation.
Ownership, exclusion, invalid-listing and availability filters remain authoritative.
A question's signals apply only at its current knowledge revision. Existing
selected products remain available in the room projection across searches.

`proposals.addGiftToBox({roomId, listingId})` atomically appends one distinct gift
and is idempotent. `removeGiftFromBox` removes only that gift, clearing when empty.
Both are organizer-only, preserve the 12-item bound and payment locks, and use
existing proposal recomputation/approval invalidation. `setGiftBox` remains full
replacement; `selectGift` remains legacy replace-with-one. The live map now uses
add/remove, presents Add to box as a primary action and renders every item and
the combined proposal estimate. Votes never select gifts or approve a proposal.

#### Themes that form on their own (D23 trial)

- **No kind buckets.** Until the council groups them, memories float individually on the outer ring (`lib/map/rings.ts`: theme `UNGROUPED = ""`, steady golden-angle seats). The Loves / Wishes / Moments jar buckets and the "Also shared" catch-all are gone from the map; a memory no theme holds yet floats until the next regroup.
- **Automatic regroup.** `bumpKnowledgeRevision` schedules `internal.agents.themes.autoRegroup({ roomId, revision })` `AUTO_THEME_DELAY_MS` (5 s) later. A run whose revision is no longer current gives way, so a burst of changes regroups once. Fewer than 3 memories clears the themes; without a model or within-budget call (`IDEA_CALLS_PER_WINDOW`) the current themes stay unchanged. The model is shown the current themes and asked to keep them unless the memories clearly call for a change.
- **Stable identity.** `storeThemes` reconciles instead of replacing: `matchThemes` pairs each new grouping with the existing theme it shares at least a third of its memories with (strongest first), keeping that `mapThemes._id` (and so its island, position and votes); unmatched themes are added or removed. A "Regrouped N memories into K themes" line is logged only when something changed.
- The manual `suggestThemes` action remains for compatibility, but the map no longer shows a grouping button.

#### Every gift on the map (D23 trial)

The map draws every gift the catalog returns, apart from ones the room let go. Only past `CROWDED_AT` (16) gifts does `lib/map/giftBundles` fold each theme's extras (beyond its best `SHOWN_PER_GROUP` = 3) into a "+N" bundle placed where they would sit; tapping a bundle fans it out on that screen. The chosen gift and gifts on the branch in focus are always drawn. The Book of Possibilities still lists everything. Replaces the earlier top-3 and top-6 caps.

#### TikTok inspiration (D25 trial)

- `research.tiktokLooks.look({ roomId, trendJobId, query })` → `Result<{ lookId }>`, membership-checked; `query` must be a suggestion of a usable trend sample in the room. Reuses a pending/running search or one that succeeded in the last 24 h for the same room and query.
- `research.tiktokLooks.list({ roomId })` → `Result<{ id, query, status, posts: { url, videoId }[], retrievedAt?, lastError? }[]>`. Posts are public TikTok links (private accounts and ads dropped), at most 6.
- New `tiktokLooks` table (room-scoped, purged with the room). A successful search logs one "looked at N public TikToks" line in the decision log.


### Room guidance (Dev 1 presentation contract)

The room guide observes existing `PublishedClue`, council themes, map signals and
listing votes. Its first contribution uses `RoomActions.addManualClue` or the
existing photo/import review flow; there is no tutorial room, tutorial memory,
or checklist after it. After the first memory is confirmed the guide steps
aside (`live`) and pauses the room once (`connect`) when another member's
published memory first lands, explaining how connected memories form themes
that lead to more gifts. The pause holds for a fixed time or until dismissed,
auto-publication or reset. Local completion is scoped to room + participant.
Skipping/replaying guidance never changes memories, votes, selection or approvals.
Only a council theme containing both published clues may be described as a
connection. The connection pause waits behind an active composer, drawer or
reveal; it never takes over someone's draft.

The client emits `unwrap:room-guide` as a `CustomEvent` for the optional Moss
narrator. Detail is `{ roomId, step, peerId, title, text, active, typing }`; `step` is
`arrival | welcome | help | compose | saved | live | connect | null`.
`peerId` is a published clue ID or null. `typing: true` marks feedback that changes while someone writes; narrators skip it. `active: false` cancels narration when
the guide is hidden, paused or unmounted. This event is presentation only and
never authorizes a room action or external data access. Narrator consumers must
not publish, vote, select gifts or approve shares in response. Existing Convex
contracts and the private import consent flow remain authoritative.

The cinematic presentation adds a local `RingGuideScene` (Moss position, pose,
seed-island visibility and viewer avatar) to `RingsWorld`. This is never stored
as a clue. The guide may move the existing composer into its side panel, but
only one editor is mounted. Help questions and topic choices are local prompts,
not inferred recipient preferences: no suggested answer is automatically saved.
Draft-length feedback stays local and raw drafts are never included in narrator
events. Authored camera framing yields to user gestures and reveal ownership.

### Moss room recall (Dev 3, MAP-024; plan in MOSS_AGENT_PLAN.md)

`moss.recall.nudge({ roomId, questionIndex })` is a public Node action behind the
guide's *I don't know* step. `questionIndex` selects one of `MOSS_QUESTIONS`
(`lib/room/guide.ts`); free text is not accepted. The server checks membership,
then searches only the room's active published memories (gift ideas excluded,
at most 256, newest first) and returns one memory shared by **another** member:

```ts
type MossNudgeView = {
  clueId: Id<"publishedClues">;
  text: string;            // the published memory, already room-visible
  author: string;          // its publisher's display name
  match: "moss" | "keyword" | "recent";
  ms: number;              // server time for the search, rounded
} | null;                  // null when no other member has shared a memory
```

`match` is `moss` when the Moss SDK ranked it (`MOSS_ROOM_ENABLED=true` plus
`MOSS_PROJECT_ID`/`MOSS_PROJECT_KEY`), `keyword` when word overlap did (SDK off or
failing), and `recent` when nothing overlapped and the newest friend's memory is
offered instead. Errors: `unauthorized`, `not_found`, `validation_failed`.

`moss.recall.warm({ roomId })` loads the embedding model with synthetic text so
the first nudge doesn't pay the cold setup; it returns `{ warmed: boolean }` and
never touches room text. Members only.

Rules: the Moss session is rebuilt per call from Convex rows and always closed;
no `pushIndex`, `loadIndex`, cloud index or disk save. Session names and document
IDs are random and local; no room ID, user ID or text is put in them. The room
index never contains private imports, proposed clues, contribution limits,
Gift Twin vault text or another room's data, and stays separate from Gift Twin's
own sessions (D26). A nudge is a suggestion shown to the person who asked; it is
never saved, published or attributed to them, and the guide never fills the
draft with it.

### Moss voice (Dev 3, MAP-026 / MAP-027; D29)

`GET /api/moss-voice` → `{ available: boolean }`: true only when the Next.js
server has `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` and `MOSS_VOICE_AGENT_ID`. The
"Talk to Moss" choices are hidden otherwise.

`POST /api/moss-voice` with body `{ roomId }` and `Authorization: Bearer <the
caller's Convex auth token>` → `{ ok: true, value: { serverUrl, roomName,
participantToken } }` or `{ ok: false, error }` with `unauthorized` (401/403),
`validation_failed` (400), `unavailable` (503) or `provider_timeout` (502).
Membership is checked by `moss.voice.canCall({ roomId })` with the caller's own
token. Room and participant names in the call are random (`unwrap-voice-<uuid>`,
`friend-<uuid>`); no room ID, user ID or name is sent to Moss. The pass lasts 15
minutes.

In a call, the browser sends one text message on topic `lk.chat` first: the
room context from `callContextText` (recipient name, the caller's display name,
up to 30 active published memories with authors, one line each, quoted, as
data). Nothing else from Convex is sent. Live captions arrive on
`lk.transcription` and stay in the browser. "Use what I said" copies the
caller's own latest words into the memory draft (`fillDraft`); the person still
presses share. The call never publishes, votes, selects gifts or approves shares,
and ends when the guide hides, a drawer or reveal opens, or the person hangs up.

The agent's prompt and greeting live in `scripts/moss-voice/agent.json` and are
deployed with `scripts/moss-voice/deploy.py`. Its voice is chosen on the Moss
Platform (a young female voice). Browser-voice fallback: with room sound on and
no live call, `useMossNarrator` speaks the guide's own `unwrap:room-guide` text
with `speechSynthesis`, preferring a female English system voice.

Natural narration (D30): `GET /api/moss-voice/speak` → `{ available }` (true when
`ELEVENLABS_API_KEY` is set). `POST /api/moss-voice/speak` with `{ roomId, text }`
(text ≤ 400 characters, one guide line) and the caller's Convex token returns
`audio/mpeg` in Moss's ElevenLabs voice, or `{ ok: false, error }` with
`unauthorized`, `validation_failed`, `unavailable` or `provider_timeout`. Members
only. The narrator uses it when available and falls back to `speechSynthesis` per
line on any failure. Lines marked `typing: true` are never spoken.
