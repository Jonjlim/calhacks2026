# Unwrap

**Turn what your friends remember into a gift you choose together.**

Group gifts usually scatter across chats, duplicate suggestions, and one person who fronts the cost. Unwrap is a shared gift studio: friends drop in what they remember, an AI facilitator turns those memories into reviewable clues, and the group picks one real gift with a proposal everyone can approve.

The feeling we want is simple: *you remembered something I said.*

## The problem

People who love someone already know useful things — a pottery class mentioned once, a keyboard they already own, a color they hate. That knowledge lives in different heads and different threads. Buying together then becomes a second problem: research, taste conflicts, budgets, and “I’ll Venmo you later.”

Generic AI gift apps skip the evidence. Shared spreadsheets skip the feeling. Neither helps a group decide *and* stand behind one purchase.

## What Unwrap does

Friends open a gift room. They talk naturally, paste a few selected messages, and confirm the clues that actually matter. Unwrap researches live product listings, shows why each recommendation fits, and lets the group shortlist, compare, and lock one gift.

Everyone sets a private contribution limit. Unwrap allocates shares deterministically. If the gift, total, or someone’s share changes, the old proposal dies and the group approves a new one.

A single buyer can use the same studio alone. Solo and group planning share one engine.

## Main features

- **Gift rooms** you create and join, including a QR / link join path
- **Realtime chat** with an AI facilitator that listens more than it talks
- **Evidence-backed clues** extracted from contributor-selected messages, then reviewed before they go public in the room
- **Real product candidates** with source links, observed prices, and retrieval timestamps
- **A shortlist and lightweight gift map** that answers “why this?”
- **Shared selection** with comparison or voting
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
| Map / motion | React Flow if it stays lightweight; Motion or CSS for state-honest animation |
| Payments (P1) | Stripe test mode, provider-hosted collection, no raw cards in our code |
| Hosting | Vercel + Convex |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design and rejected alternatives.

## Architecture at a glance

The browser talks only to Convex. Convex holds membership, chat, clues, selections, proposals, and job status. External calls — LLM, product search, later Stripe — run in Convex actions, then write validated results back. Application state and provider state are never treated as the same thing.

Solo mode is a one-participant room, not a second product.

## Documentation

| Doc | What it covers |
| --- | --- |
| [PLAN.md](PLAN.md) | Original planning notes. Historical reference; do not treat as the build spec. |
| [AGENTS.md](AGENTS.md) | Rules for humans and coding agents working in this repo |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Vision, journeys, P0/P1/P2 scope |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data model, runtime flows |
| [docs/AI_AGENTS.md](docs/AI_AGENTS.md) | Buyer agent, recipient agent, tools, and protocols |
| [docs/DATA_AND_PRIVACY.md](docs/DATA_AND_PRIVACY.md) | Consent, classification, and access control |
| [docs/COMMERCE_AND_PAYMENTS.md](docs/COMMERCE_AND_PAYMENTS.md) | Listings, allocation, proposals, sandbox payments |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Shared TypeScript-shaped interfaces |
| [docs/EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md) | Hackathon phases, demo, risk register |
| [docs/TEAM_TASKS.md](docs/TEAM_TASKS.md) | Four-person workstreams and task IDs |

## Current status

Documentation and team plan only. No application code, Convex deployment, product API integration, or payment provider setup exists yet. Do not demo this repository as a working product.

Cal Hacks 13.0 · October 2026
