# Unwrap Keeper

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)
![tag:gift-recommendation](https://img.shields.io/badge/gift--recommendation-3D8BD3)

**Checks real listings against the budget and what the recipient already owns or dislikes.**

Part of the Unwrap Gift Council, a multi-agent council coordinated by the Courier (Unwrap Gift Council agent).

## What it does

Plain, auditable rules decide what is kept or excluded, and every exclusion carries its reason. ASI:One may add one short "why it fits" note per kept listing; it never keeps, excludes or reorders anything, and notes with numbers or prices are dropped.

## Messages

- Request: `KeeperRequest { run_id, source, demo_key, room_run, analysis, listings }`
- Reply: `KeeperResult { run_id, ok, error, report }`

The agent replies only to council requests; to ask for gift ideas, chat with the Unwrap Gift Council (Courier) in ASI:One.

## Scope

It does not buy anything, handle payments, or store conversations.
