# Fetch.ai AI Council — setup, testing and demo

One registered Fetch.ai agent (**Unwrap Gift Council**) runs five specialist roles and answers gift requests directly in ASI:One. The Unwrap website can also start runs and animates its AI Council from the agent's real task events.

```
ASI:One chat ─┐                                  ┌─ Convex councilEvents ─→ /council page (5 avatars, jars, gift box)
              ├─→ fetch-agent (uAgent, ACP 0.3.0)┤
/council page ┘     Archivist → Muse ∥ Scout →    └─ POST /council/research → existing Apify pipeline
                    Keeper → Courier
```

| Piece | Where |
| --- | --- |
| Coordinator (Chat Protocol + REST) | `fetch-agent/agent.py`, roles in `fetch-agent/council/` |
| Shared contract + decoration library | `lib/council/contracts.ts`, `lib/council/library.json`, `docs/CONTRACTS.md` § AI Council |
| Convex ingest, read model, research | `convex/council.ts`, routes in `convex/http.ts`, tables in `convex/schema.ts` |
| Website | `/council` (`components/council/*`), `app/api/council/run/route.ts` |

## 1. Run the agent (Python 3.10+)

```sh
cd fetch-agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -c "from uagents_core.contrib.protocols.chat import chat_protocol_spec as s; print(s.name, s.version)"   # AgentChatProtocol 0.3.0
cp .env.example .env        # fill in AGENT_SEED (and ASI1_API_KEY, Convex values — see §3)
python agent.py
```

The log prints `Starting agent with address: agent1q…`, `Manifest published successfully: AgentChatProtocol` and an **Agent inspector** link. Keep it running.

Tests: `python -m pytest -q` (in `fetch-agent/`, with the venv active).

## 2. Register on Agentverse and test in ASI:One — needs your account

1. Sign in at [agentverse.ai](https://agentverse.ai) and [asi1.ai](https://asi1.ai) (create an API key there for `ASI1_API_KEY`).
2. With `python agent.py` running, open the **Agent inspector** URL from the log → **Connect** → **Mailbox**. The log should then show the mailbox connected (until then it warns "Agent mailbox not found").
3. In Agentverse → your agent → **Agent Profile**: set name **Unwrap Gift Council**, a handle, and keep the README (published from `fetch-agent/README.md`) as the description.
4. Click **Chat with Agent** (or search for it in ASI:One) and send:
   > Find a birthday gift for Maya. She loves pottery, has a beginner kit already, prefers handmade things, and our budget is $80.
5. Confirm the reply lists products with links and observed prices, what was excluded and why, and the Muse's charm. The agent terminal shows each role starting and finishing.

The "not enough funds to register on Almanac contract" warning is optional on-chain registration; the mailbox path does not need it.

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

Without Convex the agent still answers in ASI:One; set `APIFY_TOKEN` in `fetch-agent/.env` to research directly with the same verified actor. With neither, the reply says research is unavailable and gives clearly-labelled search ideas — it never invents products.

Optional: `COUNCIL_BROADCAST_KEY=<slug>` in `fetch-agent/.env` mirrors ASI:One chats to Convex so `/council?watch=<slug>` animates them live (no room id is invented).

## 4. Run Unwrap

```sh
npm install
npm run dev            # http://localhost:3000/council
```

**Keep all three processes running in separate terminals.** `npm run dev` starts only Next.js; it does not start Convex or the Fetch.ai coordinator. From the repository root, run `npm run dev:convex`, `npm run dev:agent` (after the Python setup in §1), and `npm run dev`.

- **Ask the Council** starts a live run (needs §1 + §3).
- **Play sample replay** plays a recorded session, labelled on screen as a replay — use it if the venue network fails. It is never shown as live results.

## Reliability notes

- Events are idempotent (`eventId`), ordered by `sequence`, and stored; refreshing or reconnecting rebuilds the council and the gift box from Convex.
- A run with no event for 120 s shows as interrupted and the avatars settle to a calm pose.
- Muse and Scout run in parallel; research has a 90 s budget; event delivery retries with backoff without blocking the agent.
- Live research and cache reads reject reserved example/test domains and local addresses. Recorded fixture products belong only in tests/replay; they must never seed the live cache. Malformed or contaminated cache entries are treated as misses.
- Research results are cached on disk for 6 h (`fetch-agent/.cache/`); cached answers say so and keep their original observation time.
- All 3D assets load from `/public`; the council model is ~1.7 MB.
- `COUNCIL_USE_LLM=0` skips the optional model call for the fastest, fully deterministic Archivist.

## Demo checklist

1. `python agent.py` running, mailbox connected (Agentverse inspector shows it online).
2. ASI:One: send the Maya prompt → products with links/prices, exclusions, charm.
3. `/council`: submit the pottery memory → Archivist reads, Muse crafts, Scout searches, Keeper checks, Courier delivers; the note drops into the **Wishes** jar and the spirit carries the **terracotta ceramic charm** to the box.
4. Refresh the page → the charm is still on the box, not duplicated.
5. Network down? **Play sample replay** (labelled).

## Known limitations

- Only the Archivist has its own model so far; Muse, Scout, Keeper and Courier reuse its rig with role tints until their GLBs are delivered. Clip substitutions are documented in `lib/council/animation.ts`.
- `/council` is a self-contained vertical slice keyed by a browser demo key. Wiring it into the live room's memory flow (and its membership rules) is the next step; raw memories are sent only to the coordinator and are not stored by the council tables.
- The REST endpoint listens on all interfaces (uagents default) and is protected by `COUNCIL_AGENT_SECRET`; keep that secret private on shared networks.
