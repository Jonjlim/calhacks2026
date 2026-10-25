# Fetch.ai AI Council — setup, testing and demo

Five registered Fetch.ai agents form the **Unwrap Gift Council**. The **Courier** is the public agent: it answers gift requests in ASI:One and starts runs for the Unwrap website. It orchestrates four specialist agents (Archivist, Muse, Scout, Keeper) with typed uAgents messages, and every agent emits its own task events, so the website's AI Council animates from real execution.

```
ASI:One chat ─┐                        ┌─ Archivist ┐              ┌─ Convex councilEvents ─→ /council page
              ├─→ Courier (ACP 0.3.0) ─┼─ Muse      ├─ events ─────┤
/council page ┘   REST /council/run    ├─ Scout ────┼──────────────┴─ POST /council/research → Apify pipeline
                  GET /health          └─ Keeper    ┘
           (one Python process: a uAgents Bureau on $PORT)
```

| Piece | Where |
| --- | --- |
| Courier (Chat Protocol + REST) and the Bureau | `fetch-agent/agent.py` |
| Specialist agents, seeds, the Courier's client with timeouts and fallbacks | `fetch-agent/council/agents.py` |
| Typed messages | `fetch-agent/council/messages.py` |
| Role work (with events) | `fetch-agent/council/roles.py`, `archivist.py`, `muse.py`, `scout.py`, `keeper.py`, `courier.py` |
| ASI:One helper | `fetch-agent/council/llm.py` |
| Specialist READMEs (published to Agentverse) | `fetch-agent/readmes/*.md` |
| Shared contract + decoration library | `lib/council/contracts.ts`, `lib/council/library.json`, `docs/CONTRACTS.md` § AI Council |
| Convex ingest, read model, research | `convex/council.ts`, routes in `convex/http.ts`, tables in `convex/schema.ts` |
| Website | `/council` (`components/council/*`), `app/api/council/run/route.ts` |

## 1. Run the council (Python 3.10+)

```sh
cd fetch-agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # fill in AGENT_SEED (and ASI1_API_KEY, Convex values — see §3)
python print_addresses.py   # the five agent1q… addresses (no secrets printed)
python agent.py
```

The log prints `Starting agent with address: agent1q…` for each of the five agents, `Manifest published successfully` for the Chat Protocol and each specialist protocol, and `Council agents: courier=…, archivist=…`. Keep it running.

Seeds: the Courier uses `AGENT_SEED` itself, so it keeps the address the single coordinator agent was registered with. Each specialist uses `<ROLE>_SEED` if set (`ARCHIVIST_SEED`, `MUSE_SEED`, `SCOUT_SEED`, `KEEPER_SEED`), otherwise a seed derived from `AGENT_SEED` and the role name. Keep the seeds stable to keep the addresses.

Tests: `python -m pytest -q` (in `fetch-agent/`, with the venv active).

## 2. Register on Agentverse and test in ASI:One — needs your account

1. Sign in at [agentverse.ai](https://agentverse.ai) and [asi1.ai](https://asi1.ai) (create an API key there for `ASI1_API_KEY`).
2. With `python agent.py` running, open the **Agent inspector** URL each agent logs → **Connect** → **Mailbox**. Do this for all five agents (all of them are served on the one Bureau port). Until then each logs "Agent mailbox not found".
3. In Agentverse → the Courier → **Agent Profile**: set name **Unwrap Gift Council**, a handle, and keep the README (published from `fetch-agent/README.md`) as the description. The specialists publish `fetch-agent/readmes/<role>.md`.
4. Put the five addresses from `python print_addresses.py` into the table in `fetch-agent/README.md`.
5. Click **Chat with Agent** on the Courier (or search for it in ASI:One) and send:
   > Find a birthday gift for Maya. She loves pottery, has a beginner kit already, prefers handmade things, and our budget is $80.
6. Confirm the reply lists products with links and observed prices, what was excluded and why, and the Muse's charm. The terminal shows each specialist starting, finishing and replying to the Courier (`archivist agent replied (ok=True)`).

The "not enough funds to register on Almanac contract" warnings are optional on-chain registration; the mailbox path does not need it.

## 3. Real research and live events (Convex)

The Scout's research and the website's live events need a Convex deployment:

```sh
npx convex dev                                    # links/creates your dev deployment, writes .env.local
npx convex env set COUNCIL_INGEST_SECRET "$(openssl rand -base64 32)"
npx convex env set APIFY_TOKEN <your Apify token>  # console.apify.com → Settings → Integrations
```

Then set in **both** `fetch-agent/.env` and the Next.js `.env.local`:

| Variable | Value |
| --- | --- |
| `CONVEX_SITE_URL` | `https://<deployment>.convex.site` (the HTTP actions URL, *not* `.convex.cloud`) |
| `COUNCIL_INGEST_SECRET` | the same value you set on the deployment |
| `COUNCIL_AGENT_SECRET` | any long random string, identical on both sides |
| `FETCH_AGENT_URL` (Next only) | `http://127.0.0.1:8001` |

Without Convex the council still answers in ASI:One; set `APIFY_TOKEN` in `fetch-agent/.env` to research directly with the same verified actor. With neither, the reply says research is unavailable and gives clearly-labelled search ideas — it never invents products.

Optional: `COUNCIL_BROADCAST_KEY=<slug>` in `fetch-agent/.env` mirrors ASI:One chats to Convex so `/council?watch=<slug>` animates them live (no room id is invented).

## 4. Run Unwrap

```sh
npm install
npm run dev            # http://localhost:3000/council
```

**Keep all three processes running in separate terminals.** `npm run dev` starts only Next.js; it does not start Convex or the Fetch.ai council. From the repository root, run `npm run dev:convex`, `npm run dev:agent` (after the Python setup in §1), and `npm run dev`.

- **Ask the Council** starts a live run (needs §1 + §3).
- **Play sample replay** plays a recorded session, labelled on screen as a replay — use it if the venue network fails. It is never shown as live results.

## 5. Deploy (Render)

`render.yaml` defines one always-on Docker web service built from `fetch-agent/Dockerfile`. All five agents run in that one process; the Bureau's HTTP server binds to Render's `$PORT` and serves the Courier's `/health` and `/council/run`. Set `AGENT_SEED`, `ASI1_API_KEY`, `CONVEX_SITE_URL`, `COUNCIL_INGEST_SECRET` and `COUNCIL_AGENT_SECRET` (and optionally the four specialist seeds) in the dashboard.

## Multi-agent behaviour

- The Courier asks each specialist with `ctx.send_and_receive`, using a fresh context (and so a fresh session) per request, so concurrent runs never collide.
- Timeouts: `COUNCIL_ARCHIVIST_TIMEOUT_S` (25), `COUNCIL_MUSE_TIMEOUT_S` (20), `COUNCIL_SCOUT_TIMEOUT_S` (research budget + 20 = 110), `COUNCIL_KEEPER_TIMEOUT_S` (20).
- If a specialist does not answer, or answers with something that fails validation, the Courier emits that specialist's `failed` event ("… the Courier used its local fallback") and runs the role in-process. Late events from that specialist are dropped. The Scout's fallback never searches again (research may be paid and already had its full time); it reports that no listings were verified.
- `COUNCIL_MODE=local` skips the agent messages and runs every role in-process (each role still emits its own events). Runs that arrive before the Bureau has finished starting also run in-process.
- ASI:One reasoning: the Archivist may add clues whose words appear in the text; the Muse may replace a generic charm with another approved library asset; the Keeper may add one "Fit: …" note per kept listing (notes with digits or currency are dropped). Deterministic rules decide budget, exclusions, products and prices. `COUNCIL_USE_LLM=0` or no `ASI1_API_KEY` turns all of it off.

## Reliability notes

- Events are idempotent (`eventId`), ordered by `sequence`, and stored; refreshing or reconnecting rebuilds the council and the gift box from Convex. In one process all five agents share one sink per run, so sequences stay unique.
- A run with no event for 120 s shows as interrupted and the avatars settle to a calm pose.
- Muse and Scout run in parallel; research has a 90 s budget; event delivery retries with backoff without blocking the agents.
- Live research and cache reads reject reserved example/test domains and local addresses. Recorded fixture products belong only in tests/replay; they must never seed the live cache. Malformed or contaminated cache entries are treated as misses.
- Research results are cached on disk for 6 h (`fetch-agent/.cache/`); cached answers say so and keep their original observation time.
- All 3D assets load from `/public`; the council model is ~1.7 MB.

## Demo checklist

1. `python agent.py` running, all five mailboxes connected (Agentverse inspector shows them online).
2. ASI:One: send the Maya prompt → products with links/prices, exclusions, charm.
3. `/council`: submit the pottery memory → Archivist reads, Muse crafts, Scout searches, Keeper checks, Courier delivers; the note drops into the **Wishes** jar and the spirit carries the **terracotta ceramic charm** to the box.
4. Refresh the page → the charm is still on the box, not duplicated.
5. Network down? **Play sample replay** (labelled).

## Known limitations

- Only the Archivist has its own model so far; Muse, Scout, Keeper and Courier reuse its rig with role tints until their GLBs are delivered. Clip substitutions are documented in `lib/council/animation.ts`.
- `/council` is a self-contained vertical slice keyed by a browser demo key. Wiring it into the live room's memory flow (and its membership rules) is the next step; raw memories are sent only to the coordinator and are not stored by the council tables.
- All five agents share one process and port. A specialist moved to another process would open its own event sink for the run, and its sequence numbers could then interleave with the Courier's; keep them in one Bureau.
- The REST endpoint listens on all interfaces (uagents default) and is protected by `COUNCIL_AGENT_SECRET`; keep that secret private on shared networks.
