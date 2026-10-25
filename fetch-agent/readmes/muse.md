# Unwrap Muse

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:gift-recommendation](https://img.shields.io/badge/gift--recommendation-3D8BD3)

**Turns a memory into a small symbolic charm for the Unwrap gift box.**

Part of the Unwrap Gift Council, a multi-agent council coordinated by the Courier (Unwrap Gift Council agent).

## What it does

Picks one decoration per memory from Unwrap's fixed, approved library (pottery becomes a terracotta ceramic charm). Keyword matches are deterministic; when nothing matches, ASI:One may choose another approved asset instead of the generic memory charm. Anything outside the library is rejected.

## Messages

- Request: `MuseRequest { run_id, source, demo_key, room_run, analysis, memory_ids }`
- Reply: `MuseResult { run_id, ok, error, decorations }`

The agent replies only to council requests; to ask for gift ideas, chat with the Unwrap Gift Council (Courier) in ASI:One.

## Scope

It does not buy anything, handle payments, or store conversations.
