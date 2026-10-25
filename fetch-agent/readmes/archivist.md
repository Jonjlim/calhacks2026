# Unwrap Archivist

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)
![tag:gift-recommendation](https://img.shields.io/badge/gift--recommendation-3D8BD3)

**Reads what friends remember about a gift recipient and turns it into structured clues.**

Part of the Unwrap Gift Council, a multi-agent council coordinated by the Courier (Unwrap Gift Council agent).

## What it does

Extracts interests, wishes, style preferences, things already owned, dislikes, the budget, the occasion and what is still unknown. A deterministic reader runs first; ASI:One may add clues it missed, but only clues whose words appear in the text, and it can never remove or change what the rules found.

## Messages

- Request: `ArchivistRequest { run_id, source, demo_key, room_run, memories: [{memory_id, text}], budget_minor }`
- Reply: `ArchivistResult { run_id, ok, error, analysis }`

The agent replies only to council requests; to ask for gift ideas, chat with the Unwrap Gift Council (Courier) in ASI:One.

## Scope

It does not buy anything, handle payments, or store conversations.
