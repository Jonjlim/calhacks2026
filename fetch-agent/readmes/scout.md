# Unwrap Scout

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:gift-recommendation](https://img.shields.io/badge/gift--recommendation-3D8BD3)

**Finds real product listings for a gift idea.**

Part of the Unwrap Gift Council, a multi-agent council coordinated by the Courier (Unwrap Gift Council agent).

## What it does

Searches live Google Shopping results through Unwrap's verified Apify pipeline, keeping only listings with an https link and an exact USD price (or an honest "price not observed"). It never asks a language model for products or prices. Cached answers are labelled cached and keep their original observation time.

## Messages

- Request: `ScoutRequest { run_id, source, demo_key, room_run, analysis }`
- Reply: `ScoutResult { run_id, ok, error, report }`

The agent replies only to council requests; to ask for gift ideas, chat with the Unwrap Gift Council (Courier) in ASI:One.

## Scope

It does not buy anything, handle payments, or store conversations.
