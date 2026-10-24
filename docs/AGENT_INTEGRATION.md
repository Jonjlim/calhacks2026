# Member 3 agent integration

The agent backend runs inside the existing Convex application. One configurable model powers the buyer, extractor, and optional recipient roles; each receives a different permission-filtered snapshot. No external agent service is required.

## Current status

Implemented and tested with the Convex test backend, mocked model transport, and the real research worker driven by mocked provider responses. No live model call or deployed Convex smoke test has been performed. The application room still reads fixtures. The merged P0 backend implements auth, regular chat/import/publish endpoints, membership, proposals, and job infrastructure. Human chat submissions enqueue the agent; research success/failure/timeout queues one bounded response; confirmed clue changes re-evaluate cached candidates. Dev 4's source passed standalone live searches, but the combined deployed flow remains unverified.

The member 3 endpoints can be exercised with authenticated room/membership/evidence records. Tests create records through the P0 public endpoints and exercise scheduled agent/research work together. Recipient onboarding is synthetic operator mode only, not a production identity/consent flow. Sensitive-text filtering is defense in depth, not a complete classification guarantee.

## Configuration

Set `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY` on the **Convex deployment**, not in a client environment variable. The base URL must be HTTPS and point to the API base, typically ending in `/v1`. The server appends `/chat/completions`. There is no implicit vendor or model default. Use a provider/model that supports `response_format: { type: "json_object" }` and the standard completion envelope. JSON is validated locally against strict Zod schemas, including references and permissions. Provider compatibility is unverified until a live spike succeeds.

The adapter bounds HTTP requests to 20 seconds, response bodies to 128 KB, serialized input to 120,000 characters, and output to 2,400 tokens by default. `LLM_MAX_OUTPUT_TOKENS` may select 256–8,192. Optional `LLM_REASONING_EFFORT` must be supported by the chosen model. Invalid JSON/schema output is retried once, without echoing provider output into repair prompts. HTTP failures are not retried automatically. A 90-second watchdog fences abandoned jobs. The acting member can retry a failed/uncertain job once; old attempts cannot commit.

Each attempt records dispatched calls and provider-reported input/output/cached/reasoning tokens. `reportedCalls` distinguishes missing metadata from zero usage. Only the acting member sees these counts in `listActivity.jobs`; do not present them as a settled bill. A provider timeout or process failure can leave usage unreported. See [MODEL_SETUP.md](MODEL_SETUP.md) for the recommended starting model, price assumptions, and live verification.

The ordinary P0 flow requires no recipient configuration. For an explicitly synthetic demo, enable `RECIPIENT_AGENT_DEMO_ENABLED=true`. An organizer can then create and own a room-linked profile, type selected preferences, and grant question categories. Do not import real recipient messages through this mechanism. Real recipient authentication/linking needs a separately reviewed onboarding flow.

## Dev 1: user controls and activity

Use generated `api.agents.buyer` operations:

- `requestTurn({ roomId })`: quiet mode. Only a human `@unwrap` mention calls the model.
- `requestTurn({ roomId, mode: "auto" })`: explicit Ask Unwrap button; evaluates current room knowledge even if no chat has been sent.
- `listActivity({ roomId })`: subscribe to bounded events, open questions, job states/retry eligibility, and configuration-presence booleans. Each event has actor, kind, summary, job ID, time, and optional citations. Show actual started/handoff/completed/failed states. Extraction events are owner-only. Do not derive success from elapsed animation time.
- `answerQuestion({ roomId, slot, body, clientIdempotencyKey })`: use a stable key for the same submission. Stores the human chat message, closes the question, and schedules the next turn atomically. An answer is not automatically a published clue or a contribution cap.
- `abandonQuestion({ roomId, slot })`: closes an obsolete question.
- `retryJob({ jobId })`: owner-only, once, for failed/uncertain jobs. Stale work needs a new turn or updated evidence.

Each operation returns `Result<T>`. Render errors rather than assuming a returned job ID means completion. Call `requestTurn` on human submissions or an explicit button, never every reactive render or agent message. The existing room UI has not yet been switched from fixtures.

Normal `messages.sendMessage` also accepts `replyToSlot` to target an open question. It closes that question and schedules an auto turn atomically, without requiring another `@unwrap`. Untargeted chat does not guess which question was answered. Answer retries return the original message/job IDs even after later messages. Recommendation messages expose `agentJobId` and `citations` (listing IDs, supporting published clue IDs, candidate-pool job ID). Use these to highlight products/evidence; purchasing facts in message text are rendered from observations rather than model prose.

For a selected import, call `api.agents.extract.extractClues({ sourceId })`, then use Dev 2's `listMyProposedClues`/publish controls. Extraction sees only the source owner's messages, stores proposed clues, and never publishes them. Photo (P0) and screenshot (P1-C) clues use `api.media.generateEvidenceUploadUrl` and `api.media.importMediaEvidence` (first implemented by Dev 3; Dev 2 owns them), then the same `extractClues` call. The extract job reads each file once with the vision model, stores observation rows (photos) or transcript rows (screenshots), proposes clues, and deletes the files in the same transaction. Photo clue text is built by `convex/agents/photo.ts` from sanitized observations, never from model prose; a term seen in one photo is `uncertain`, the same term in two or more photos merges. Unmarked photos never produce activity or ownership clues. Failure, timeout, and source deletion also delete the files. A 15-minute cron (`convex/crons.ts` → `cleanup.sweepStaleUploads`) deletes any stored file older than one hour that no `evidenceMedia` row references, so uploads that never reached `importMediaEvidence` do not accumulate. See "Photo observation" in [CONTRACTS.md](CONTRACTS.md).

Synthetic recipient operator controls use `api.agents.recipient.createProfile`, `getMyProfile`, and `updateRecipientPreferences`. The owner alone can read/replace records. Empty preferences/grants revoke them. Non-disclosable rows never enter the recipient model. Other members see only a fixed verdict summary when the buyer asks a permitted question.

## Dev 2: chat and backend hook

The `p0` merge wires this helper into `messages.sendMessage`. Question answers also update `room.latestMessageId`. Keep one enqueue call per new human message; do not also enqueue a legacy hash-only job. The generic helpers in `jobs.ts` remain available for other backend work, but current buyer jobs require the full runtime context and acting participant.

After storing a new human chat message, call the exported helper inside the same mutation:

```ts
import { enqueueBuyerTurn } from "./agents/runtime";

// After membership/validation and inserting the participant's message:
await enqueueBuyerTurn(ctx, roomId, participant._id, "quiet");
```

Do not call it for `buyer_agent` messages. Quiet is a safe default; auto mode should be an explicit product choice. The helper persists and schedules atomically, binds the acting participant, and deduplicates the exact input version. Identity does not propagate into scheduled actions; the stored participant is rechecked before loading and committing data.

The schema changes are additive: optional job context/attempt timestamps, optional decision payloads, message/evidence metadata, question answers, activity events, and isolated recipient tables. Review shared schema/contract changes before merging with backend work. Agent tables contain no payment integration. Source deletion must increment `sourceRevision` or set `deletedAt`; either fences in-flight extraction. A member removal fences its running jobs. Published clue changes must use `bumpKnowledgeRevision`, which now also debounces cached re-evaluation. Do not add a second publication callback.

Extraction writes its validated proposed clues and completion in one internal mutation. It checks source ownership/revision and every cited message/contradiction again. It does not call the separate `clues.insertProposedClues` endpoint; the member 3 path must keep completion and writes atomic.

## Dev 4: research handoff

The buyer planner inserts `researchJobs` with a brief, published clue IDs, knowledge revision, pending status, input hash, and `agent-research:<agentJobId>` key. It captures the acting participant, originating agent job, and latest human message, then schedules the implemented `internal.research.research.runResearch({ jobId })`.

The brief contains query terms, server-owned room budget/occasion/revision, exclusions/ownership clues, and a 1–12 result limit. It contains no private imports, contribution caps, or recipient profile text. Dev 4 owns listing normalization, ranking, completion/failure status, and source validity. The UI remains subscribed to Convex results.

`readCatalog` in `convex/research/catalog.ts` is shared by the recommendations query and buyer snapshots. It re-ranks the same latest-successful pool against current active clues, returns excluded candidates/reasons internally, and keeps public query output compatible. The agent never relies on the legacy stored recommendations table.

Completion, controlled failure, and timeout call `enqueueResearchContinuation` in the same transaction as settlement. A `continuationAgentJobId` pointer deduplicates callbacks. Newer requests/knowledge/chat or removed members suppress obsolete replies. Legacy research jobs without an acting participant do not receive an automatic response. The public `startResearch` path captures a requester too, so it can use the same callback. Do not call the helper a second time from the frontend.

The automatic follow-up can recommend or clarify but cannot search or query the recipient agent. Failed/uncertain research produces a fixed status message without a model call. Confirmed clue changes schedule a 350 ms cached re-evaluation; stale jobs exit before model access. New paid research requires a human turn/request. If the old pool has no grounded options, the agent asks for a different direction once rather than inventing a product. It never changes selection, shares, or approvals.

## Agent-to-agent protocol

Buyer decisions are strict JSON. A `query_recipient` decision contains only a question type and subject; the server supplies query, job, room, and profile IDs. The recipient endpoint is internal-only. It checks grants before model access, loads only authorized/disclosable rows, validates cited preference IDs, and returns a verdict. Fixed guidance and the public subject are shown in the room; profile text, preference IDs, and model rationale are not exposed in activity.

Unknown/forbidden questions stop there. There is no retry with looser permissions. Changes to the profile revision invalidate an in-flight response before it can post. A recipient verdict is never auto-published as a clue. Each human event starts at most one buyer decision and one recipient request. A research request may produce exactly one subsequent facilitator job with external work disabled.

## Verification

Run `npm run typecheck` and `npm test`. Tests cover strict schemas, prompt/tool boundaries, grounded references, quiet mode, private extraction, role isolation, grants/revocation, stale jobs, timeout fencing, bounded retries, duplicate completion, atomic rollback, end-to-end mocked-source feedback, cached replanning, explicit answer continuity, fact-safe rendering, output budgets, and token metadata. Three paid live-model tests are skipped by default; run `npm run agents:smoke` explicitly with model credentials in the local process environment. This does not read Convex dashboard secrets or run paid Apify searches.

The normal Convex code generator requires a configured deployment. During this offline implementation the checked-in API declarations were regenerated using the installed Convex API template. Once connected, run `npx convex codegen` and perform a credentialed model/extraction/recipient smoke test with synthetic data before calling the integration live.

## Conversation, revision trace, stats, and verification (Dev 3)

- **`reply` intent.** The buyer can answer a follow-up ("why not the kit?", "which is cheaper?") from the room's published clues, listings, and excluded reasons. It writes only a chat message and a decision row. Cited ids must exist in the snapshot or they are dropped. Ids that leak into prose are replaced by listing titles or clue text. The posted body is the model's short wording plus observed facts for every cited listing, copied from the stored records. Automatic continuations never chat.
- **Keep chatting.** `api.agents.buyer.setChatMode({ roomId, mode: "quiet" | "chatty" })` is organizer-only and stored as `rooms.agentChatMode`. `listActivity().capabilities` exposes `chatMode` and `canSetChatMode`. In chatty mode the buyer may consider an unaddressed message, but only when the last voice was human and the agent has been quiet for 20 seconds. Unprompted, it may only `reply` or `listen`; search, recommendations, questions, and recipient queries need an `@unwrap` or Ask Unwrap.
- **Revision trace.** When a confirmed clue drops options from the cached shortlist, the activity feed gets one event per dropped option, such as `Dropped “Complete Pottery Starter Kit” because the room confirmed: “Already owns a starter kit”.`, citing the listing and the clue.
- **Stats.** `api.agents.stats.getRoomStats({ roomId })` returns only recorded values. Anything not recorded is `null`. Token and cost figures are the caller's own jobs; cost is set only when `LLM_INPUT_USD_PER_MTOK` and `LLM_OUTPUT_USD_PER_MTOK` are configured on the deployment and usage is complete. Recipient-agent outcomes come from `agentDecisions.recipientOutcome`.
- **Verifier.** `convex/agents/verify.ts` makes no model call. Before a recommendation posts, each listing is checked against its record: unavailable, over-budget, or non-USD listings are dropped (no candidate left means no post); stale prices, unconfirmed price or availability, and over-budget-with-shipping are flagged in the message. Replies may not state prices, links, availability, or promotions of their own: an amount must match a stored record, otherwise the wording is replaced by record-based facts.

## Room budget, demo fixtures, and live checks (Dev 3)

- **Model budget.** `enqueueBuyerTurn` and `extractClues` return `refused` once a room has had `AGENT_MAX_JOBS_PER_ROOM_HOUR` (default 60) model-backed jobs in the rolling hour. Jobs that never reached the model do not count. This protects provider credit from a chatty room or a loop.
- **Citation recovery.** If the model cites evidence that is not in the snapshot, `decideBuyer` corrects it once, then builds the answer deterministically from the ranked records. It never fails the whole turn over a bad citation when grounded records exist.
- **Demo fixture pool.** `api.demo.seedFixturePool({ roomId })` inserts five `manual_fixture` listings (example.com URLs, labelled "fixture" in the UI) so a room can show the shortlist, revision trace and replies without a paid search. It needs `DEMO_SEED_ENABLED=true` and the organizer.
- **Live checks** (dev deployment, `.env.local` points at it): `scripts/run-e2e-live.sh` (two users, privacy, agent loop), `A2A=1 scripts/run-e2e-live.sh` (buyer to recipient agent), `PHOTO_FILE=/path/scene.jpg scripts/run-e2e-photo.sh` (photo read-once), `scripts/run-e2e-replan.sh` (recommend, new ownership clue, "Dropped X because…" trace, grounded follow-up). `npx convex run agents/smoke:all` checks the model connection only.

## Gift worlds (zoom out)

Opt-in, anonymized view of other gift sessions. `api.worlds.shareWorld({ roomId, recipientAlias?, highlightClueIds? })` (organizer only) publishes: occasion, a budget band, friend count, clue-kind counts, up to three organizer-picked active clue lines (the recipient's and participants' names are replaced by the alias; sensitive text is rejected), and the final pick. `unshareWorld`, `getMyWorldShare`, `listWorlds` (signed-in readers; returns worlds plus real aggregates) complete the set. Readers never receive a room id, account id, invite token, real names, chats, caps, or private imports. `seedSampleWorlds` adds clearly labelled samples when `DEMO_SEED_ENABLED=true`. The `/worlds` page and the room's share panel are plain UI; the 3D world scene can bind to `listWorlds` as islands.
