# Unwrap

**Turn what your friends remember into a gift you choose together.**

Group gifts usually scatter across chats, duplicate suggestions, and one person who fronts the cost. Unwrap is a shared gift studio: friends drop in what they remember, an AI facilitator turns those memories into reviewable clues, and the group picks one real gift with a proposal everyone can approve.

The feeling we want is simple: *you remembered something I said.*

## The problem

People who love someone already know useful things — a pottery class mentioned once, a keyboard they already own, a color they hate. That knowledge lives in different heads and different threads. Buying together then becomes a second problem: research, taste conflicts, budgets, and “I’ll Venmo you later.”

Generic AI gift apps skip the evidence. Shared spreadsheets skip the feeling. Neither helps a group decide *and* stand behind one purchase.

## What Unwrap does

Friends gather in a lobby in front of a storybook present. When everyone is in, the camera pulls back and the gift map opens around it. On the map, friends drop memories, photos, and ideas; the AI council groups them into themes; real product listings grow between the themes they fit; and the group pulls the best ideas toward the box at the center until one gift is left.

Everyone sets a private contribution limit. Unwrap allocates shares deterministically. If the gift, total, or someone’s share changes, the old proposal dies and the group approves a new one.

A single buyer can use the same studio alone. Solo and group planning share one engine.

## Main features

- **A lobby at the present** where friends create and join a room, including a QR / link join path
- **One shared gift map** in rings: what friends share outside, themes in the middle, gifts inside, the box at the center
- **Click anywhere to add** a memory, message, photo, or idea, with named cursors for everyone in the room
- **Evidence-backed clues** extracted from contributor-selected messages and photos, reviewed privately before they go public on the map
- **Real product candidates** with source links, observed prices, and retrieval timestamps
- **Steering by dragging**: toward the box supports, away passes, and “why this?” lights the path back to the memories
- **Private contribution limits** and deterministic allocation
- **Versioned proposals** that invalidate when the deal changes

Later, if time allows: a privacy-bound recipient agent that can answer gift questions without exposing private messages, and sandbox payment orchestration that never lets an LLM move money.

## What makes this different

Not “the first AI gift recommender.” Those exist.

Unwrap is different when all of this is visible in the demo:

- Different friends contribute different knowledge
- Recommendations point at confirmed clues and real listings
- The group actually collaborates in one room
- Recipient-authorized private knowledge, if used, stays behind a permission boundary
- Purchasing decisions are explicit, revision-aware, and human-approved

## Planned stack

| Layer | Choice |
| --- | --- |
| App | Next.js, React, TypeScript, Tailwind CSS |
| Authoritative state | Convex queries, mutations, and actions |
| AI | One tool-capable LLM, structured outputs, Zod validation |
| Products | One verified shopping source; Apify is the first candidate |
| Map / motion | React Three Fiber island scene with a ring-layout gift map; Motion for state-honest animation |
| Payments (P1) | Stripe test mode, provider-hosted collection, no raw cards in our code |
| Hosting | Vercel + Convex |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and rejected alternatives.

## Architecture at a glance

The browser talks only to Convex. Convex holds membership, clues, themes, signals, selections, proposals, and job status. The map's layout is computed in the browser from that state. External calls — LLM, product search, later Stripe — run in Convex actions, then write validated results back. Application state and provider state are never treated as the same thing.

Solo mode is a one-participant room, not a second product.

## Documentation

| Doc | What it covers |
| --- | --- |
| [PLAN.md](PLAN.md) | Original planning notes. Historical reference; do not treat as the build spec. |
| [AGENTS.md](AGENTS.md) | Rules for humans and coding agents working in this repo |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Vision, journeys, P0/P1/P2 scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data model, runtime flows |
| [docs/AI_AGENTS.md](docs/AI_AGENTS.md) | Buyer agent, recipient agent, tools, and protocols |
| [docs/FETCH_AI_COUNCIL.md](docs/FETCH_AI_COUNCIL.md) | Fetch.ai AI Council agent: run it, register on Agentverse, test in ASI:One, demo checklist |
| [docs/DATA_AND_PRIVACY.md](docs/DATA_AND_PRIVACY.md) | Consent, classification, and access control |
| [docs/COMMERCE_AND_PAYMENTS.md](docs/COMMERCE_AND_PAYMENTS.md) | Listings, allocation, proposals, sandbox payments |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Shared TypeScript-shaped interfaces |
| [docs/EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md) | Phase 2 plan: map-first room, milestones, demo, open decisions |
| [docs/TEAM_TASKS.md](docs/TEAM_TASKS.md) | Phase 2 task table (MAP-xxx), then Phase 1 workstreams |

## Current status

**Phase 1 is complete in code.** Rooms, anonymous sign-in, invites, private evidence and photo clue review, research with normalized listings, the agent backbone, the Fetch.ai council, votes, private limits, allocation, and revision-aware approvals are implemented. On `main` / `refactor` the suite passes 597 tests (3 live-provider tests skipped). Without `NEXT_PUBLIC_CONVEX_URL` the room falls back to read-only fixtures.

Still unverified end to end on one shared deployment: live product search (`APIFY_TOKEN`), the council service (`FETCH_AGENT_URL` and its secrets), and a two-browser run of the whole path. Payments remain pledges.

**Phase 2 is starting: the map-first room.** The app will open in a lobby in front of the present, then zoom out to one gift map where all sharing, themes, research, votes, the box, and approvals happen. The tower, Backstage drawer, and separate map page are leaving the main path. See [docs/EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md) and the prototype in [work/vision-lab/](work/vision-lab/README.md).

## Development

```bash
npm install
npx convex dev      # first run: log in and create/link the team project; writes .env.local
npx @convex-dev/auth  # once per deployment: sets JWT_PRIVATE_KEY, JWKS, SITE_URL for anonymous auth
npm run dev         # in a second terminal; http://localhost:3000
```

The UI runs without Convex when `NEXT_PUBLIC_CONVEX_URL` is unset, so mock-only frontend work does not need a deployment. Checks: `npm run typecheck`, `npm test`, `npm run build`.

Where each workstream starts:

| Owner | Start here |
| --- | --- |
| Dev 1 | `app/`, `components/`, mocks in `lib/mocks/queries.ts` |
| Dev 2 | `convex/schema.ts`, `convex/rooms.ts`, `messages.ts`, `clues.ts`, `proposals.ts`, `allocations.ts`, `jobs.ts`, `votes.ts`, `convex/lib/auth.ts` |
| Dev 3 | `convex/agents/`, agent schemas in `lib/validation.ts` |
| Dev 4 | `convex/research/`, listing schema in `lib/validation.ts`; `convex/payments/` only for P1-B |

Shared types live in `lib/contracts/index.ts` and mirror `docs/CONTRACTS.md`. Each stub names its task ID (for example `BE-002`) in its `notImplemented(...)` call.

Cal Hacks 13.0 · October 2026
