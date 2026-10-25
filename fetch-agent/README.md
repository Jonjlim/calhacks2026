# Unwrap Gift Council

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)
![tag:gift-recommendation](https://img.shields.io/badge/gift--recommendation-3D8BD3)
![tag:shopping](https://img.shields.io/badge/shopping-3D8BD3)

**Finds real, budget-checked gifts from what you remember about someone.**

Tell the council about the person: what they love, what they want to try, what they already own, what they dislike, and your budget. It replies with real product listings (links and observed prices), explains why each one fits, and says what it left out and why.

## Try it

- “Find a birthday gift for Maya. She loves pottery, has a beginner kit already, prefers handmade things, and our budget is $80.”
- “Maya loves pottery and handmade crafts, wants to try a pottery class, already owns a beginner kit, and the budget is $80.”
- “Gift for Sam under $50 — he enjoys gardening and coffee but hates scented candles.”

## What happens

The council is five Fetch.ai agents that talk to each other with typed messages:

| Agent | Work |
| --- | --- |
| **Courier** (this agent) | The public coordinator. It receives your chat, asks each specialist for its part, and writes the answer. |
| **Archivist** | Reads your message and extracts clues: interests, wishes, preferences, things already owned, dislikes, budget, occasion, and what is still unknown. Rules first; ASI:One may add clues it finds in your text. |
| **Muse** | Turns the memory into a symbolic charm for the Unwrap gift box (pottery → a terracotta ceramic charm), chosen from a fixed library. ASI:One may suggest another approved charm when no keyword matches. |
| **Scout** | Searches live Google Shopping results via a verified Apify actor (through the Unwrap backend), keeping only listings with an https link and an exact USD price or an honest “price not observed”. |
| **Keeper** | Enforces the budget, removes things they already own or dislike, and notes soft preferences like “handmade”. ASI:One may add a short “why it fits” note; it never changes what is kept. |

```
             ┌─ ArchivistRequest ─→ Archivist
ASI:One ─→ Courier ─┼─ MuseRequest ──────→ Muse     (in parallel with the Scout)
             ├─ ScoutRequest ─────→ Scout
             └─ KeeperRequest ────→ Keeper
```

Muse and Scout run in parallel. If a specialist does not answer in time, the Courier says so and does that step itself (except research, which it never repeats or invents). Each agent reports its progress, which the Unwrap website uses to animate its AI Council characters.

## Agent addresses

| Agent | Address |
| --- | --- |
| Courier (Unwrap Gift Council) | `agent1q2vtalfkht476sacz6v3aslhas7pflw73m9lcpf64cth8vza3j52xtnq5mg` |
| Archivist | `agent1qvy8ev9ze4e6zhuec59shm7d8mterdfl7duzxcnq4vlnlgg8k6227nylv43` |
| Muse | `agent1q2q6anuhf0khmgkh5w5fw05hgw85vdgltc3qv4zl6gxd2q6y4r6d57uwwr4` |
| Scout | `agent1qwptueewcv6r7t3ra7jejgvte0tjgmua8hm2du6hgdvehmw55j2vcmv66mm` |
| Keeper | `agent1qvrvpqjhey6g8crugt3qznxzdw7utysct068tgtlsw44j6twtxp32epyej4` |

The public chat entry point is [Courier in ASI:One](https://asi1.ai/ai/agent1q2vtalfkht476sacz6v3aslhas7pflw73m9lcpf64cth8vza3j52xtnq5mg). Specialist agents handle typed council requests rather than public chat.

## Run or test

From the repository root (Python 3.10+):

```sh
cd fetch-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill .env with your own private seeds and provider credentials.
python print_addresses.py
python agent.py
```

Run offline tests in this directory with `python -m pytest -q`. Real shopping needs a configured Convex research backend and Apify credentials, or the direct Apify fallback described in [the setup guide](../docs/FETCH_AI_COUNCIL.md). ASI:One reasoning uses an optional ASI1_API_KEY; no live shopping credentials means no verified products. Preserve the deployed seeds to preserve the published addresses; fresh seeds create new agent identities.

## Honesty rules

- Products, links and prices come only from research results, never from the language model.
- If research is unavailable, the reply says so and offers search ideas clearly marked as unverified.
- Cached research is labelled as cached and keeps its original observation time.
- Prices are as observed at retrieval time; check before buying.

## Scope

Gift ideas for one person at a time, US listings in USD. It does not buy anything, handle payments, or store your conversation.
