# Unwrap branch and application review — 25 October 2026

Snapshot: `dev3/fetch-council` at `c197da1`, plus the current uncommitted ElevenLabs migration. This review inventories all changed paths and inspects the main experience, authority boundaries, service wiring and tests. It is not a line-by-line security audit of every changed file.

Compared with the earlier `449ee6e` snapshot: 79 reachable commits and 331 changed paths, including 60 screenshot paths. Relative to the locally available `origin/main`, the branch is 18 commits ahead and zero behind. No fetch, merge, deployment or push was performed during this review.

## Verdict

The application now has most of a complete collaborative gifting experience: enter a shared world, contribute memories, derive directions, research sourced listings, compare, choose a multi-item box, approve an exact proposal, complete a clearly simulated checkout and wrap together. The primary demo risk is deployment integration, followed by coordination among the guide, book, map details and finale.

Subjective assessment: visual/product ambition 8.5/10; first-use coherence 6/10; current live demo readiness 4/10. These are review judgments, not measured performance scores. Live research and voice have not been demonstrated end to end in this review.

## What changed

- **World and navigation:** expanded skies, camera presets, bridges, character paths, label occlusion, council robot homes and off-screen cues. The map remains the primary shared surface.
- **Cinematic onboarding:** an establishing shot, island approach, real Type/Photo editor, I-don't-know questions and Moss beside the island. Published memories remain normal room data. The latest guide now hands off after the first memory and pauses for one peer connection; it no longer walks through vote/Why/selection as separate tutorial steps.
- **Council:** Courier, Archivist, Muse, Scout and Keeper have separate uAgents identities and typed request/reply messages. Timeout/invalid-reply handling falls back explicitly; Scout does not silently retry paid research. Real task events drive the robots and detail history.
- **Memory-to-gift reasoning:** combined gift directions cite actual published clues, constrain model output, preserve ownership/exclusion checks, and connect research jobs to a direction. Theme matching stabilizes existing groups. Search normalization handles actual provider shapes and empty results.
- **Group decisions:** directional signals, gift votes, ownership/price reactions, a question poll and sharpening. Multiple products share a frozen revision and allocation; stale approvals are invalidated.
- **Comparison and explanation:** Book of Possibilities provides a readable catalogue of the room's listings; How We Got Here presents the recorded decision trail and source-linked explanations. These reuse the existing selection/actions.
- **Ending:** plan contributions, explain equal/capped shares, approve the current revision, simulate each payment, wrap, and reach a shared End screen. Checkout explicitly states that no charge or order occurs.
- **Gift Twin:** optional recipient pairing, browser/Mac import paths, a private expiring vault and recipient-side ideas/votes. Room-visible memory retrieval and private Twin retrieval are separate.
- **Moss:** room-visible recall with keyword fallback, an optional hosted voice call via LiveKit, transcript-to-draft review, and narration from guide cues. ElevenLabs migration is currently uncommitted and its shared client file is untracked.

## Confirmed active-deployment issue

The local frontend configuration names `https://compassionate-alpaca-531.convex.cloud`. I queried environment variable **names only** on that exact Convex deployment. It lacks `FETCH_AGENT_URL`, `COUNCIL_AGENT_SECRET`, `COUNCIL_INGEST_SECRET` and `APIFY_TOKEN`. LLM variables are present, but those do not configure council transport or product sourcing.

The live Scout history showed failures for council configuration and product/trend credentials. The repository matches those errors: `convex/councilRoom.ts:155` refuses dispatch without the council URL/secret; `convex/research/provider.ts:30` refuses research without the product token. Both product and trend jobs consume `APIFY_TOKEN`.

The local agent `.env` targets `cool-bat-724.convex.site`; its callback allowlist does not contain `compassionate-alpaca-531.convex.site`. No service answered at the default local council endpoint `127.0.0.1:8001/health`. That does not determine whether a different hosted/team agent is healthy; its running configuration and registration were not inspected.

**Required next step:** pick one demo deployment and align its hosted council URL, matching authentication secrets, callback allowlist/HTTP site, Apify credentials and deployed functions. Convex cloud cannot reach a developer laptop at `127.0.0.1`. Then run a fresh, bounded research request and inspect the new run, rather than treating old history as current health.

## Integration findings

### P1 — Voice startup can outlive closing the guide

`components/room/useMossVoice.tsx:48` begins an asynchronous token request before assigning `room.current`. Closing the guide during that request calls `stop()` while no Room exists. The pending continuation still creates/connects a Room and enables the microphone at line 86. There is no abort/generation/active check after those awaits. Repeated clicks during the same window can also start more than one request.

Fix: invalidate startup on stop/unmount, guard concurrent starts and check the current attempt after every asynchronous boundary before connecting or enabling the mic. Verify close-during-token, close-during-connect, room change and double-click. This is a static control-flow finding; no microphone call was started in this review.

### P1 — Guide and voice do not pause for all foreground experiences

`components/room/RoomLayout.tsx:236` pauses the guide for convergence or a drawer, while `bookOpen`, `finaleOpen` and the final End state are separate. Moss can remain active while the book or contribution flow is foregrounded.

Fix: one foreground-experience rule shared by camera, guide narration, calls and map interaction. Pause for book, finale, explanation dialogs and End, and restore without resetting a draft.

### P1 — The tutorial does not yet teach the complete judge journey

`lib/room/guide.ts:21` contains arrival/welcome/help/compose/saved/live/connect only. After saving, the guide automatically hands back the map; the vote/Why/choose/split beats from the cinematic concept are not explicit guidance stages. A fresh room also needs another memory before its default combine-directions action becomes available (`useGiftRings.tsx:861`).

Fix: continue with brief, state-triggered cues when a real direction, listing and selection first become available. For the two-minute demo, prepare a clearly real room with other friends' published memories so the judge's first contribution has context immediately. Do not fabricate peer arrivals or provider success.

### P2 — Recall failure and no match are described as no friends' memories

`components/room/useRoomGuide.tsx:317` says nobody else shared a memory whenever recall is null. The caller also maps errors to null, and keyword retrieval can return no match even with friends' memories present.

Fix: distinguish empty room, no relevant hit and unavailable retrieval. Existing room-visible memories must not disappear in the narrative just because retrieval failed.

### P2 — Runtime/setup is inconsistent across entry points

The shell is Node 20.19.5. Gift Twin documents Node 23.6+ and uses `node:sqlite` and direct TypeScript execution. Default `npm test` fails importing sqlite; `npm run test:twin` cannot expand/execute those TypeScript tests under Node 20. Under bundled Node 24.19.0 the CLI tests pass and the full suite passes with four workers. Python pytest must run from `fetch-agent/` so its asyncio configuration is applied.

Fix: declare/pin the supported Node version in the root and CI; provide consistent test commands and cap worker count for local rehearsal. No source change was needed to obtain the passing results below.

### P2 — Sponsor integration claims need a current capability matrix

Room semantic Moss retrieval and hosted Moss voice require configuration separate from the OpenAI key and ElevenLabs narration. The local server lacks Moss project/voice variables; the active Convex variable list also lacks the Moss variables. ElevenLabs key presence is not a successful synthesis check. `docs/MOSS_AGENT_PLAN.md` mixes a new completion banner with older 'No voice anywhere' text.

Fix: label each path as built, configured, live-verified or fallback. The ElevenLabs model choice is consistent with its current official model documentation, but actual synthesis and a hosted Moss conversation remain unverified here. Reference: https://elevenlabs.io/docs/overview/models/

## Validation

- `npm run typecheck`: passed, including frontend, Convex and Gift Twin projects.
- Node 24.19.0, `vitest run --maxWorkers=4`: **1,034 passed, five skipped; 105 files passed, three skipped**.
- Node 24.19.0, Gift Twin CLI: **seven passed**.
- `fetch-agent/.venv/bin/python -m pytest -q`, working directory `fetch-agent`: **53 passed**.
- Initial Node 24 run with default worker count had six five-second timeouts; all cleared with four workers. Initial Node 20 and root-directory pytest failures were environment/entry-point issues, not reproduced assertion failures.
- Browser accessibility inspection verified live room controls, memory/idea nodes, council roles and Scout's failure history. A later browser screenshot capture timed out and detached; the newest book/finale/voice flows were inspected in source rather than claimed as newly completed live flows.
- No live provider search, microphone permission, real payment, hosted agent deployment or production mutation was performed for this review.

## Priorities for the next work block

1. Restore the active deployment's council and sourcing connections; prove one fresh successful run with real sources.
2. Fix voice cancellation and foreground-experience coordination.
3. Extend the integrated first-memory moment into the first real gift decision; keep one clear next action visible.
4. Rehearse two independent users: publish → direction → sourced gift → Why → ownership/pass correction → choose → approve exact amounts → simulated checkout → wrap. Change a revision once to prove approvals reset.
5. Keep Gift Twin, TikTok and live voice as optional showcases until that core rehearsal completes repeatedly within two minutes.

## Changes arriving during the review

A final working-tree check found additional concurrent edits: the guide's displayed name is changing from Moss to **Ssom**, and Scout's summaries now distinguish missing configuration, timeouts and no-result searches while keeping failed optional trend jobs from painting Scout's main role as broken. This improves presentation but does not configure the missing services. The voice-start cancellation and foreground pause findings still apply to the latest inspected code. The main test results above precede those concurrent copy/status edits; targeted checks are run separately.

Targeted checks after those concurrent edits: 29 tests passed across five Moss-voice/recall and council contract/path/robot test files. `git diff --check` is clean.
