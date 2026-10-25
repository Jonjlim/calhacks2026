# Moss agent plan

Status: **M1 and voice built** (2026-10-25): the *I don't know* nudge runs on `moss.recall.nudge` (D28), with keyword fallback. **Talk to Moss** (D29) and the browser-voice fallback are built; a live Moss call waits on a deployed voice agent (`scripts/moss-voice/deploy.py`, then `MOSS_VOICE_AGENT_ID` on the server). Room context goes in as the call's first text message instead of a tool, because hosted tools can't see which room they're in. Real Moss ranking needs `MOSS_ROOM_ENABLED=true` plus Moss credentials on the demo deployment (M0). Everything else below is still proposed. Owner: Dev 3 (agent and room guide), with Jonathon (Gift Twin and Moss SDK owner) and Dev 1 (guide UI). Contract changes go to [CONTRACTS.md](CONTRACTS.md) before code.

## The one-line pitch

Moss is the room's memory. Everything friends share about someone goes into a Moss index, and Moss, the guide on the island, uses it to help people remember more, find connections, and explain why a gift fits. It can do all of this out loud.

## Where we are today (verified)

- **Two things share the name.** The green guide's lines are hand-written in `lib/room/guide.ts`, and it never calls Moss. The Moss SDK (`@moss-js/moss` 1.21.0) runs only inside Gift Twin, on the backend (D26, D27).
- **Gift Twin's use is real but invisible.** Each run builds a throwaway Moss index from up to 256 consented recipient messages, searches it per open idea, then closes it. Nothing shows on screen.
- **It isn't on the deployment we demo from.**

  | Deployment | Fetch.ai council | Moss |
  | --- | --- | --- |
  | `cool-bat-724` (Alex) | yes (`FETCH_AGENT_URL`) | no |
  | `shiny-dotterel-658` (Jonathon) | no | yes (`MOSS_*`, `GIFT_TWIN_MOSS_ENABLED`) |
  | `compassionate-alpaca-531` (Alan) | no | no |

- **Measured costs (D26):**
  - On Convex, setup took 2.25 s, indexing 27 ms and retrieval 4 ms for 3 messages.
  - On a laptop, the first model load took 23 s.
  - Larger rooms and cold starts are unverified.
- **No voice anywhere.** Narration cues already exist: the client emits `unwrap:room-guide` events for an optional narrator (CONTRACTS.md), but nothing listens to them yet.

## Name decision

**Keep "Moss", but only if the guide actually runs on Moss by the demo.** The name fits the world (moss grows on the islands and keeps what's been there), the team already uses it, and it's the most direct way to show the sponsor where their technology lives. In credits and the README, say "Moss, our memory guide, built on Moss semantic search".

If M1 below isn't working by the demo cut-off, rename the guide (for example "Fern") and keep Moss only for Gift Twin. A guide named after a sponsor it doesn't use looks like borrowing the logo. This is a one-line change in `lib/room/guide.ts` and the guide copy.

## What the Moss agent does

Moss never publishes, votes, selects gifts or approves shares. It reads, searches and suggests; people decide.

1. **Nudge ("I don't know").** When someone taps *I don't know: Moss, give me a little nudge*, Moss searches the room's memories with the question they picked and shows one related memory a friend already shared:

   > "Jon remembered she's been saving wheel-throwing posts. Does that remind you of anything?"

   The person still writes their own memory. Nothing is saved for them.
2. **"Sounds related."** When a new memory lands, Moss checks it against the others. If one is close, it points out the echo between those two memories by name ("this sounds like Ally's 'Sunday table'"). It doesn't call it a theme: CONTRACTS.md lets only council themes be described as connections, so the wording stays "sounds related" unless that contract changes.
3. **Ask Moss.** Anyone can ask "what do we know about her mornings?" Moss answers with the matching memories quoted and credited, plus any gifts that cite them. It's read-only.
4. **Evidence shown on screen.** "Why?" on a gift and Gift Twin votes show what Moss recalled, for example *Found with Moss: 3 memories · 4 ms*, with the quotes. This makes the semantic match visible: a "ceramics workshop" idea pulling up "I'd love to learn wheel throwing" with no shared words. Gift Twin quotes appear only to the recipient. The room sees the count and the screened posts.

Build 1 first, 4 next, then 2 and 3 only if time allows.

## Privacy rules (unchanged authority)

- **The room's Moss index holds only room-visible material:** active published memories, room photo captions already shared, and listing titles. It never includes private imports, unpublished proposed clues, contribution limits, Gift Twin vault messages or another room's data.
- **Gift Twin keeps its own separate session per evaluation**, as in D26. The two indexes never mix.
- **Indexes are temporary, rebuilt from Convex per call or per room change.** No `pushIndex`, `loadIndex` or saving to disk. Convex stays the source of truth.
- **Credentials stay server-side** (`MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY`). Moss receives usage telemetry only, as documented in D26.
- **Moss output is untrusted.** It returns IDs and scores only, and the server maps those back to memories the caller is allowed to see.

## How it's built

- **`convex/moss/roomRecall.ts`** (Node internal action, `"use node"`, reuses the `@moss-js/moss` setup and `MOSS_MODEL_CACHE_DIR` workaround from `convex/giftTwin/memory.ts`):
  - Loads the room's active published memories through an internal query with a membership check, capped at 256.
  - Opens a session, `addDocs` with local IDs, queries with `{ topK: 5, alpha: 0.8 }`, then `close()` in `finally`.
  - Returns `{ hits: { clueId, score }[], ms }`.
  - If the SDK is missing or failing, falls back to keyword overlap with the same result shape.
- **`convex/moss/guide.ts`** (public action with a membership check), `nudge({ roomId, questionKey })` and `ask({ roomId, text })`:
  - Returns a typed `Result`: `ok`, `not_found`, `unauthorized`, `validation_failed`, or `provider_timeout` when over 4 s.
  - Phrasing is a deterministic template first; the existing room model may rephrase later. No new model provider.
- **Warm-up:** call recall once with a throwaway query when the map opens, so the first real tap doesn't pay the 2 s setup.
- **Client:**
  - `useRoomGuide` calls `nudge` from the *I don't know* card and shows the result in Moss's speech bubble.
  - Gift cards show the "Found with Moss" chip when a run has recall stats.
- **Contracts:** add `MossRecallView`, `nudge` and `ask` to CONTRACTS.md, and record a decision D28 in ARCHITECTURE.md with any new data-flow lines in DATA_AND_PRIVACY.md.
- **Tests:**
  - Mock-SDK unit tests: it only indexes room-visible memories, rejects other rooms and non-members, and falls back to keyword search when the SDK fails.
  - The `scripts/moss-memory-smoke.mts` style live check for paraphrase hits.

## Voice: Moss's own hosted voice agent, with browser voice as the safety net

Moss sells a hosted voice agent, and it fits our stack without a new server of ours (checked 2026-10-25 against Moss's public demo and the `@moss-tools/voice-server` package README; not yet run by us):

- **One-time deploy:** the Python package `moss-voice-agent-manager` (beta) deploys an agent to the Moss Platform with a prompt, a greeting and Python tool functions, and prints a `MOSS_VOICE_AGENT_ID`. It's a script we run once, not a service we host. Moss runs the speech, model and voice on its side, on LiveKit.
- **Joining a call:** a Next.js server route uses `@moss-tools/voice-server` (`1.0.0-beta.3`, depends on `livekit-server-sdk`) with `MOSS_PROJECT_ID`, `MOSS_PROJECT_KEY` and `MOSS_VOICE_AGENT_ID`. It returns `{ serverUrl, roomName, participantToken }`; the token lasts 15 minutes. The browser joins with `livekit-client` and the mic.
- **Accounts:** Moss Platform voice access only. No separate LiveKit, speech-to-text or text-to-speech keys appear in Moss's demo.

| Option | What it is | Cost and risk | Verdict |
| --- | --- | --- | --- |
| **A. Moss voice agent (hosted)** | **Talk to Moss** in the guide opens a live voice call with Moss. It greets you, asks the guide's questions, and its tool `recall_room_memories(question)` answers from the room's shared memories, then helps you put one into words. | Beta packages, unknown pricing and limits, a mic on a noisy stage, and the network. Two new npm dependencies; a new external processor for audio and room-visible text. | **Do this as the showcase,** after a 1–2 hour spike proves it works. This is Moss's product, used for what it's built for. |
| **B. Browser voice** | Moss reads its guide lines aloud with the browser's `speechSynthesis`, from the existing `unwrap:room-guide` events. **Hold to talk** dictates a memory with `SpeechRecognition`. | No keys or cost. Chrome works best; the voice sounds synthetic. | **Keep as the fallback** if the spike fails or the venue network is bad. About 2 hours. |

How the agent reaches room memories (needs the spike to confirm):
- Our route names each call `unwrap-<random session id>` and stores `{ session, roomId, participantId, expiresAt }` in Convex when it mints the token. No room ID or text goes into the name.
- The agent's tool calls a Convex HTTP action, `/moss/voice-recall`, with that session ID and a shared secret stored with the agent's configuration. Convex checks both and the expiry, then returns up to 5 ranked, room-visible memories, using the same ranking as `moss.recall.nudge`.
- Open questions the spike must answer: can a deployed tool read its LiveKit room name and make outbound HTTPS calls? Where are tool secrets kept? What model does the hosted agent use? What are the latency, minute limits and cost?

Voice rules for both options:
- **The draft is the only output.** The person reviews it and presses share, same as typing. Moss never publishes, votes or chooses.
- **Moss only sees room-visible text.** Audio, transcripts and the recalled memories go to the Moss Platform (and LiveKit) during the call, and nothing private ever does: no imports, unshared clues, limits or Gift Twin vault. Record this processor in DATA_AND_PRIVACY.md and ARCHITECTURE.md before shipping, marked unverified until the spike passes.
- **Off by default.** The mic only starts on an explicit tap, with a visible "Moss is listening" state and one-tap hang-up. Calls end when the guide closes or the reveal starts.

## Milestones

| # | Task | Owner | Time | Done when |
| --- | --- | --- | --- | --- |
| M0 | One demo deployment with both the council and Moss | Alex + Jonathon (deployment owners decide) | 30 min | One deployment lists `FETCH_AGENT_URL`, `MOSS_*` and `GIFT_TWIN_MOSS_ENABLED`; `.env.local` and `EXECUTION_PLAN.md` name it |
| M1 | Room recall plus the *I don't know* nudge | Dev 3 | 2–3 h | Tapping the nudge in a room with 3+ memories shows a related friend's memory within 1 s when warm; keyword fallback works with Moss off; mock-SDK tests pass |
| M2 | "Found with Moss" on Why? and Gift Twin | Dev 3 + Jonathon | 1–2 h | A gift's Why shows recalled memories with count and ms; recipient-only quotes stay private |
| M3a | Moss voice spike: deploy a test agent with `moss-voice-agent-manager`, join it from a test page | Dev 3 + whoever holds the Moss account | 1–2 h | A call connects in the browser, Moss greets and answers; the open questions above are answered |
| M3b | **Talk to Moss** in the guide, with the `recall_room_memories` tool on `/moss/voice-recall` | Dev 3 | 3 h | A call can quote a friend's memory and help word a draft; nothing is published by the call; session tokens expire |
| M3c | Browser voice fallback (option B) | Dev 1 + Dev 3 | 2 h | Guide lines read aloud when sound is on; hold-to-talk fills the draft |
| M4 | Sounds related and Ask Moss | Dev 3 | 2 h | Optional; only after M1–M3 pass the rehearsal |

Cut-off: if M1 doesn't pass by the start of the final rehearsal block, rename the guide and ship without it.

## Demo beat (about 20 seconds)

1. A judge opens the room. Moss speaks: "This little island is yours. Let's give it a memory of Maya."
2. The judge taps *I don't know*. Moss answers: "Jon remembered she's been saving wheel-throwing posts. Does that remind you of anything?" The bubble shows *found with Moss · 4 ms*.
3. The judge holds to talk: "She made a little bowl last week." It appears as a draft, they press share, and it lands on the Pottery theme.
4. Later, Why? on the chosen gift shows the memories Moss matched, including one with no shared words.

## Risks

- **Cold start.** The first Moss setup can take seconds, which is why the map opens with a warm-up. Rehearse on the demo deployment, not a laptop.
- **Small rooms.** With 2–3 memories, semantic search has little to show. The prepared demo room should have about 10 memories from 3 people.
- **Privacy creep.** Keep room and Gift Twin indexes separate. A test asserts the room index never contains private or vault text.
- **Feature sprawl.** This replaces hand-written guide lines with real recall. It must not add a new button to the main flow.

## Sources

- Moss product and integrations (search runtime inside conversational agents; Pipecat and LiveKit integrations): [GitHub listing](https://awesome.ecosyste.ms/projects/github.com%2Fusemoss%2Fmoss), [Y Combinator profile](https://ycombinator.com/companies/moss), [project summary](https://www.sourcepulse.org/projects/27018143)
- Unwrap internal: ARCHITECTURE.md D26 and D27, CONTRACTS.md (room guide events), GIFT_TWIN.md
