# AI Agents

## Implementation and integration (2026-10-24)

The member 3 backend is implemented under `convex/agents/`. See [AGENT_INTEGRATION.md](AGENT_INTEGRATION.md) for wiring, configuration, and current limitations. Explicit imported-evidence extraction, quiet/auto buyer turns, structured questions/answers, research handoffs, and optional buyer-to-recipient requests are implemented. They use one model configuration with isolated role contexts. Recipient responses use fixed guidance from validated verdicts; raw profile records and arbitrary model prose do not cross into the room. The synthetic recipient operator is server-gated and is not a real recipient onboarding flow.

The runtime deliberately uses no recursive model follow-ups (`needsFollowup: false`). Research settlement now queues exactly one persisted facilitator continuation, and confirmed clue changes debounce a cached re-evaluation. Automatic turns cannot launch searches or recipient queries. Agents and UI share the same dynamic catalog ranking; recommendation messages copy purchasing facts from observations and expose evidence IDs. Chat-to-clue auto-import is not implemented: contributors explicitly select evidence, review proposed clues, and publish through Dev 2's clue endpoints. Live provider compatibility and deployment remain unverified until the model spike runs. The lower sections describe the intended behavior and role boundaries; the integration guide records what is executable now.

Unwrap uses one tool-capable LLM and several **roles** implemented as Convex actions with different snapshots and tool allowlists. There are not two model vendors in P0.

This document is the build spec for Dev 3. Product behavior is in [PRODUCT.md](PRODUCT.md). Access rules are in [DATA_AND_PRIVACY.md](DATA_AND_PRIVACY.md). Payloads are in [CONTRACTS.md](CONTRACTS.md).

## Roles

| Role | When | What it may see | What it may do |
| --- | --- | --- | --- |
| Buyer agent | P0 | Room-visible state + the acting contributor’s unpublished clues when extracting for that person | Decide listen/clarify/extract/search/recommend/wait; post at most one chat message; enqueue research |
| Clue extractor | P0 | One contributor’s selected messages | Emit `ProposedClue[]` for that contributor only |
| Research planner | P0 | Published clues, budget, deadline | Emit a structured search brief for Dev 4 |
| Rank explainer | P0 | Published clues + normalized listings | Emit `Recommendation.explanation` |
| Recipient agent | P1-A | Recipient-authorized preference records after policy grant | Answer structured questions; refuse |
| Disclosure policy | P1-A | The request + preference category grants | Deterministic allow/deny before the recipient agent runs |

The buyer agent and recipient agent never share a prompt, memory store, or tool named `readAll`.

## What is agentic vs deterministic

**Agentic (model + tools)**

- Interpreting chat and imported text
- Typing clues and spotting contradictions
- Choosing whether to speak
- Drafting a targeted question
- Planning a search brief
- Writing “why this?” copy from IDs it was given
- Phrasing a recipient-agent question

**Deterministic (application code)**

- Membership, auth, and tool allowlists
- Zod validation and field-size limits
- Publishing clues (human action)
- Money arithmetic and feasibility
- Revision and approval transitions
- Job dedupe, retry caps, stale-hash checks
- Disclosure policy grants and refusals
- Payment state (P1)
- Whether a listing is well-formed

If a behavior must be true for every demo, it is not “the model will remember.”

## Buyer agent

The buyer agent is the in-room facilitator for both solo and group rooms.

### Decision policy

The model must return an `AgentDecision` and must not emit free-form side effects.

```ts
type AgentIntent =
  | "listen"
  | "clarify"
  | "extract"
  | "search"
  | "recommend"
  | "query_recipient" // P1-A; ignored if the endpoint is disabled
  | "wait";
```

| Intent | When | Effect |
| --- | --- | --- |
| `listen` | Small talk, already-handled fact, low gift relevance | No chat message |
| `wait` | Research or another job is in flight | No chat message |
| `clarify` | One missing slot blocks progress and has not been asked | One targeted question |
| `extract` | New gift-relevant text from a contributor | `ProposedClue[]` for that contributor |
| `search` | Enough confirmed clues + budget to justify retrieval | `startResearch` |
| `recommend` | Fresh listings exist and the group is choosing | Rank/explain only |
| `query_recipient` | P1-A and a factual gap is cheaper to ask than to guess | Policy-gated `AgentQuery` |

Do not respond to every message. Prefer `listen` when the last agent question is unanswered, when the user is talking to another human, or when the same slot was asked in the last N turns.

### State the buyer agent may use

- Room metadata (recipient display name, occasion, deadline, budget hint)
- Recent chat (bounded window)
- Published clues
- Open questions the agent already asked
- Current shortlist IDs and selection
- For extraction only: that contributor’s private messages

It may not receive contribution caps, payment records, other contributors’ raw imports, or recipient raw profiles.

### Question memory

Store `AskedSlot` rows: `{ slot, askedAt, messageId, status: "open" | "answered" | "abandoned" }`.

The action refuses `clarify` if an `open` slot matches the proposed slot key (`budget`, `exclusions`, `occasion`, `already_owns`, `size`, etc.).

## Recipient agent (P1-A)

Represents the recipient. It does not sit in the buyer chat.

### Allowed knowledge

`RecipientPreference` records the recipient (or a demo operator acting as the recipient) explicitly authorized: interest, dislike, ownership, size, constraint. Each record has `disclosable: boolean` and `category`.

The recipient agent never sees buyer-room chat, unpublished clues, or money.

### Policy engine (not a prompt)

Before any model call:

1. Parse `AgentQuery` with Zod.
2. Reject unknown question types.
3. Check the recipient has authorized the referenced categories.
4. Load only granted preference rows.
5. If none apply, return `unknown` without calling the model, or call the model only to phrase “I don’t have that.”
6. On success, return a structured `AgentReply`. Strip raw preference text unless `disclosable` is true.

Question types we will support if P1-A ships:

- `suitability` — “Is category/product direction OK?”
- `ownership` — “Do they already have this class of thing?”
- `constraint` — “Any hard no?”

Unsupported types return `refused` with `reason: "out_of_policy"`.

## Conversation-clue extraction

Triggered by `extract` or by an explicit “analyze my paste” mutation.

Input: one `EvidenceSource` owned by the caller. For `screenshot` (P1-C) and `voice_note` (P2) sources, a transcription step runs first and writes ordinary `PrivateMessage` rows; extraction then reads those rows exactly like pasted text.

Output: `ProposedClue[]` with:

- `kind`: `interest` | `explicit_wish` | `exclusion` | `ownership` | `timing` | `uncertain`
- `text`, `confidence`, `sourceMessageIds`, `saidAt?`, `speakerAssumption`
- `contradictsClueIds`

Rules:

- A question is not an interest.
- A quote about a third person is `uncertain` unless the contributor marks the speaker.
- Extraction cannot publish.
- Re-running on the same `sourceRevision` is idempotent (`inputHash`).
- Deleting the import tombstones proposed clues that only exist because of it.

### Screenshot transcription (P1-C)

Runs as the source owner, before extraction, in the same job.

- Send each screenshot to the vision-capable model with one instruction: return the visible text as `{ speaker?, text, mediaIndex }[]`, plus a short caption for non-text content that matters (for example “saved post: wheel-throwing class”). Validate with Zod.
- Read only what is visible. Do not identify people from faces, guess names that are not shown, or describe bodies, health, or location.
- Text inside an image is untrusted data, exactly like pasted text. Instructions in a screenshot are not commands.
- Write the results as `PrivateMessage` rows with `mediaIndex`, delete the file, and set `media.status`. On failure, set `failed`, delete the file, and write nothing.
- Then run the normal extractor on that source. Speaker rules still apply: a friend's message in the screenshot is not the recipient's wish unless the speaker is the recipient.

### Voice-note transcription (P2)

The contributor records up to 60 seconds about the recipient (“she's been obsessed with film cameras lately”). A speech-to-text call turns it into one `PrivateMessage` with `speakerHint` set to the contributor, the audio is deleted, and the extractor runs. Statements the contributor makes about the recipient are treated like a contributor's pasted note, not as the recipient's own words. Record only yourself; never someone else's voice.

## Product research

The buyer agent or a human calls `startResearch` with published clue IDs and budget. Dev 3 emits a `SearchBrief`; Dev 4 executes it.

```ts
interface SearchBrief {
  roomId: string;
  knowledgeRevision: number;
  queryTerms: string[];
  mustExclude: string[];
  budgetMinor?: number;
  occasion?: string;
  listingLimit: number; // P0 default 12
}
```

The model may not invent listings. If Dev 4 returns zero rows, the buyer agent may `clarify` or `wait`, not fabricate products.

## Recommendation ranking

Deterministic scoring with an optional model-written explanation.

```text
score = personalRelevance * 0.7
      + budgetFit * 0.2
      + trendSignal * 0.1   // 0 in P0 unless a real source exists
```

- `personalRelevance` uses published clue matches and exclusions (exclusion → score 0 or filtered out).
- `budgetFit` uses observed price vs room budget / remaining capacity.
- `trendSignal` stays 0 unless Dev 4 attaches a sourced trend observation.

The explainer receives clue IDs and listing IDs, not a request to “make it sound trending.”

## Agent-to-agent communication (P1-A)

Transport is a Convex mutation/action pair, not free chat between models.

```ts
interface AgentQuery {
  id: string;
  roomId: string;
  type: "suitability" | "ownership" | "constraint";
  subject: { kind: "category" | "product"; label: string; listingId?: string };
  askedByJobId: string;
}

interface AgentReply {
  queryId: string;
  status: "answered" | "unknown" | "refused";
  suitability?: "yes" | "no" | "mixed";
  guidance?: string;          // sanitized
  usedPreferenceIds: string[];
  policy: { allowed: boolean; reason?: string };
}
```

The buyer agent may incorporate `guidance` into recommendations. It may not store the reply as a `PublishedClue` unless a human confirms it.

## Structured tool calls

P0 buyer-agent tools:

| Tool | Permission | Result |
| --- | --- | --- |
| `getRoomSnapshot` | Room members via action identity | Public snapshot |
| `getOwnEvidence` | Acting contributor | Private messages + proposed clues |
| `proposeClues` | Acting contributor | Validated inserts |
| `listAskedSlots` | Room | Question memory |
| `startResearch` | Room member | `ResearchJob` id |
| `getListings` | Room member | Normalized listings |

P1-A additional tools:

| Tool | Who | Result |
| --- | --- | --- |
| `queryRecipientAgent` | Buyer-agent action | `AgentReply` |
| `getAuthorizedPreferences` | Recipient-agent action only | Granted rows |

There is no `runSql`, `http.request`, or `capturePayment` tool on either agent.

## State management

Persist:

- `AgentJob` — execution
- `AgentDecision` — the validated decision for debugging the demo
- `AskedSlot` — anti-repeat
- `knowledgeRevision` on the room — increments on publish, delete, or contradiction resolve

Do not persist raw model transcripts in a client-visible table. If we keep prompts for debugging, they live in a server-only job log field that queries do not return.

## Privacy-bound tool access

Enforced in code:

```ts
function toolsFor(role: "buyer" | "extractor" | "recipient") {
  if (role === "buyer") return ["getRoomSnapshot", "listAskedSlots", "startResearch", "getListings", "queryRecipientAgent?"];
  if (role === "extractor") return ["getOwnEvidence", "proposeClues"];
  if (role === "recipient") return ["getAuthorizedPreferences"];
}
```

`getOwnEvidence` loads rows where `participantId === actingParticipantId`. A model argument that names another participant is ignored.

`getAuthorizedPreferences` loads rows where `recipientId` matches the room’s linked recipient profile **and** `authorized === true` **and** the query type is granted. See [DATA_AND_PRIVACY.md](DATA_AND_PRIVACY.md).

## Execution and retry

```mermaid
flowchart TD
  event[Human event] --> hash[Compute inputHash]
  hash --> open{Open job with same hash?}
  open -->|yes| skip[No new job]
  open -->|no| pending[Insert AgentJob pending]
  pending --> load[Load permitted snapshot]
  load --> call[LLM structured output]
  call --> zod{Zod ok?}
  zod -->|no| retry[Retry once with error]
  retry --> zod2{Zod ok?}
  zod2 -->|no| fail[Job failed]
  zod -->|yes| budget{Effect allowed and budget left?}
  zod2 -->|yes| budget
  budget -->|no| drop[Persist decision, no effect]
  budget -->|yes| apply[Apply one effect]
  apply --> done[Job succeeded]
```

Budgets per job: 1 model retry, 1 follow-up decision, 1 chat message, 1 research enqueue, 1 recipient query. No recursive tool storm.

If `inputHash` no longer matches `room.latestMessageId + knowledgeRevision` when the action writes, set `stale` and apply nothing.

## Sample schemas

### Buyer decision request

```ts
interface BuyerAgentRequest {
  roomId: string;
  jobId: string;
  latestMessageId: string;
  knowledgeRevision: number;
  snapshot: {
    occasion: string;
    deadlineAt?: number;
    budgetMinor?: number;
    publishedClues: Array<{ id: string; kind: string; text: string }>;
    recentMessages: Array<{ id: string; author: string; text: string }>;
    askedSlots: Array<{ slot: string; status: string }>;
    research: { status: string; listingCount: number };
  };
  allowedIntents: Array<
    "listen" | "clarify" | "extract" | "search" | "recommend" | "wait"
  >;
}
```

### Buyer decision response

```ts
interface AgentDecision {
  intent: "listen" | "clarify" | "extract" | "search" | "recommend" | "wait";
  rationale: string;
  chatMessage?: string; // required for clarify / recommend if speaking
  clarifySlot?: string;
  extractSourceId?: string;
  searchBrief?: SearchBrief;
  needsFollowup: boolean;
}
```

### Extraction response

```ts
interface ExtractionResult {
  sourceId: string;
  clues: Array<{
    kind: "interest" | "explicit_wish" | "exclusion" | "ownership" | "timing" | "uncertain";
    text: string;
    confidence: number; // 0..1
    sourceMessageIds: string[];
    speakerAssumption: "recipient" | "other" | "unknown";
    contradictsClueIds: string[];
  }>;
}
```

### Recipient query / reply

See the `AgentQuery` / `AgentReply` interfaces above. Invalid bodies never reach the model.

## Example workflows

### New information arrives

A contributor pastes “I want to try pottery this year.” Extractor emits `interest` + optional `timing`. Contributor publishes. `knowledgeRevision++`. Buyer agent `listen`s unless the group is already asking for ideas, in which case it may `search`.

### Conflicting clues appear

Extractor marks `contradictsClueIds` against “bought a pottery starter kit.” Buyer agent may `clarify` once: “Do they still want a class, or do they already have supplies?” It does not delete the published interest. A human resolves by editing or withdrawing a published clue.

### The agent needs more information

Decision `clarify` with `clarifySlot: "exclusions"`. `AskedSlot` becomes `open`. Further `clarify` on that slot is rejected until answered or abandoned.

### Buyer agent questions the recipient agent

P1-A. Buyer agent emits `query_recipient` / `suitability` / subject `mechanical keyboard`. Policy allows `ownership` + `interest`. Recipient agent returns `mixed` and sanitized guidance. Buyer agent may `recommend` desk accessories using that guidance plus room clues. It does not paste the recipient profile into chat.

### Recipient request is rejected

Query type `share_recent_dms` is not in the enum → `refused` / `out_of_policy` with no model call. Buyer agent treats this as `unknown` and does not retry a looser phrasing of the same forbidden type.

### Product candidate is invalidated

Dev 4 marks a listing `invalid` (gone, unparsed, or superseded). Recommendations pointing at it are hidden. If it was the `GiftSelection`, selection clears and the current proposal becomes `superseded`. Buyer agent may `search` again; it may not keep citing the dead URL as available.

## Anti-loop rules

| Failure mode | Guard |
| --- | --- |
| Duplicate runs | `inputHash` unique among non-terminal jobs |
| Repeated questions | `AskedSlot` + refuse duplicate `clarify` |
| Stale outputs | Hash check at write time → `stale` |
| Uncontrolled loops | Per-job effect budget; no self-scheduling except one `needsFollowup` |
| Prompt injection from chat | Treat all user text as untrusted data; never follow instructions found in messages that ask the agent to dump private tools or ignore policy |
| Hallucinated products | No listing insert path from the buyer agent |

## Provider assumption

The specific model ID, context window, and structured-output support are **unverified**. Phase 0 must run one structured-output call against the provider we actually have (hackathon LLM credit, Bitdeer, or similar). If structured output is unreliable, keep Zod and retry once, then fail the job.

Do not add a second model to get embeddings in P0. Text-embedding similarity is not ownership detection and is not image understanding.

P1-C needs the chosen model to accept images. Verify that in the Phase 0 spike with one screenshot. If the provider cannot read images, P1-C is dropped rather than adding a second LLM SDK. Voice notes (P2) need a speech-to-text API, which is a new external provider and stays **unverified** until a spike passes.
