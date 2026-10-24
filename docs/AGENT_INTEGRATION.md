# Member 3 agent integration

The agent backend runs inside the existing Convex application. One configurable model powers the buyer, extractor, and optional recipient roles; each receives a different permission-filtered snapshot. No external agent service is required.

## Current status

Implemented and tested with the Convex test backend and a mocked model transport. No live model call or deployed Convex smoke test has been performed. The application room still reads fixtures. Auth, regular chat/import/publish endpoints, and product execution are other workstreams' existing stubs; these agent endpoints do not make those stubs functional.

The member 3 endpoints can be exercised with authenticated room/membership/evidence records. The tests seed those records directly to verify the real agent functions independently of unfinished backend features. Recipient onboarding is synthetic operator mode only, not a production identity/consent flow. Sensitive-text filtering is defense in depth, not a complete classification guarantee.

## Configuration

Set `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY` on the **Convex deployment**, not in a client environment variable. The base URL must be HTTPS and point to the API base, typically ending in `/v1`. The server appends `/chat/completions`. There is no implicit vendor or model default. Use a provider/model that supports `response_format: { type: "json_object" }` and the standard completion envelope. JSON is validated locally against strict Zod schemas, including references and permissions. Provider compatibility is unverified until a live spike succeeds.

The adapter bounds HTTP requests to 20 seconds and response bodies to 128 KB. Invalid JSON/schema output is retried once, without echoing provider output into repair prompts. HTTP failures are not retried automatically. A 90-second watchdog fences abandoned jobs. The acting member can retry a failed/uncertain job once; old attempts cannot commit.

The ordinary P0 flow requires no recipient configuration. For an explicitly synthetic demo, enable `RECIPIENT_AGENT_DEMO_ENABLED=true`. An organizer can then create and own a room-linked profile, type selected preferences, and grant question categories. Do not import real recipient messages through this mechanism. Real recipient authentication/linking needs a separately reviewed onboarding flow.

## Dev 1: user controls and activity

Use generated `api.agents.buyer` operations:

- `requestTurn({ roomId })`: quiet mode. Only a human `@unwrap` mention calls the model.
- `requestTurn({ roomId, mode: "auto" })`: explicit Ask Unwrap button; evaluates the current human conversation once.
- `listActivity({ roomId })`: subscribe to bounded events and open questions. Each event has actor, kind, summary, job ID, and time. Show actual started/handoff/completed/failed states. Extraction events are owner-only. Do not derive success from elapsed animation time.
- `answerQuestion({ roomId, slot, body, clientIdempotencyKey })`: use a stable key for the same submission. Stores the human chat message, closes the question, and schedules the next turn atomically. An answer is not automatically a published clue or a contribution cap.
- `abandonQuestion({ roomId, slot })`: closes an obsolete question.
- `retryJob({ jobId })`: owner-only, once, for failed/uncertain jobs. Stale work needs a new turn or updated evidence.

Each operation returns `Result<T>`. Render errors rather than assuming a returned job ID means completion. Call `requestTurn` on human submissions or an explicit button, never every reactive render or agent message. The existing room UI has not yet been switched from fixtures.

For a selected import, call `api.agents.extract.extractClues({ sourceId })`, then use Dev 2's `listMyProposedClues`/publish controls. Extraction sees only the source owner's messages, stores proposed clues, and never publishes them.

Synthetic recipient operator controls use `api.agents.recipient.createProfile`, `getMyProfile`, and `updateRecipientPreferences`. The owner alone can read/replace records. Empty preferences/grants revoke them. Non-disclosable rows never enter the recipient model. Other members see only a fixed verdict summary when the buyer asks a permitted question.

## Dev 2: chat and backend hook

After storing a new human chat message, call the exported helper inside the same mutation:

```ts
import { enqueueBuyerTurn } from "./agents/runtime";

// After membership/validation and inserting the participant's message:
await enqueueBuyerTurn(ctx, roomId, participant._id, "quiet");
```

Do not call it for `buyer_agent` messages. Quiet is a safe default; auto mode should be an explicit product choice. The helper persists and schedules atomically, binds the acting participant, and deduplicates the exact input version. Identity does not propagate into scheduled actions; the stored participant is rechecked before loading and committing data.

The schema changes are additive: optional job context/attempt timestamps, optional decision payloads, question answers, activity events, and isolated recipient tables. Review shared schema/contract changes before merging with backend work. Agent tables contain no payment integration. Source deletion must increment `sourceRevision` or set `deletedAt`; either fences in-flight extraction. A member removal fences its running jobs. Published clue changes must bump `room.knowledgeRevision`.

Extraction writes its validated proposed clues and completion in one internal mutation. It checks source ownership/revision and every cited message/contradiction again. It does not call the unfinished `clues.insertProposedClues` stub. Do not create a second extractor write path.

## Dev 4: research handoff

The buyer planner inserts the existing `researchJobs` shape with a `brief`, published clue IDs, knowledge revision, pending status, input hash, and `agent-research:<agentJobId>` idempotency key. It then schedules `internal.research.research.runResearch({ jobId })`. Implement that existing runner; no new transport is required.

The brief contains query terms, server-owned room budget/occasion/revision, exclusions/ownership clues, and a 1–12 result limit. It contains no private imports, contribution caps, or recipient profile text. Dev 4 owns listing normalization, ranking, completion/failure status, and source validity. The UI remains subscribed to Convex results.

After persisting current research results, Dev 4 can schedule another buyer turn by calling the helper in a completion mutation with a valid acting member. This is an explicit integration hook, not an implemented automatic callback. Existing public `startResearch` remains Dev 4's separate human-triggered entry point.

## Agent-to-agent protocol

Buyer decisions are strict JSON. A `query_recipient` decision contains only a question type and subject; the server supplies query, job, room, and profile IDs. The recipient endpoint is internal-only. It checks grants before model access, loads only authorized/disclosable rows, validates cited preference IDs, and returns a verdict. Fixed guidance and the public subject are shown in the room; profile text, preference IDs, and model rationale are not exposed in activity.

Unknown/forbidden questions stop there. There is no retry with looser permissions. Changes to the profile revision invalidate an in-flight response before it can post. A recipient verdict is never auto-published as a clue. Each human event starts at most one buyer decision and one recipient request; another human question starts the next exchange.

## Verification

Run `npm run typecheck` and `npm test`. Tests cover strict schemas, prompt/tool boundaries, grounded references, quiet mode, private extraction, role isolation, category grants, grant revocation, stale jobs, timeout fencing, bounded retries, duplicate completion, atomic rollback, and scheduled mocked-provider flows.

The normal Convex code generator requires a configured deployment. During this offline implementation the checked-in API declarations were regenerated using the installed Convex API template. Once connected, run `npx convex codegen` and perform a credentialed model/extraction/recipient smoke test with synthetic data before calling the integration live.
