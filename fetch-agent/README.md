# Unwrap Gift Council

![tag:gift-recommendation](https://img.shields.io/badge/gift--recommendation-3D8BD3)
![tag:shopping](https://img.shields.io/badge/shopping-3D8BD3)
![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)

**Finds real, budget-checked gifts from what you remember about someone.**

Tell the council about the person: what they love, what they want to try, what they already own, what they dislike, and your budget. It replies with real product listings (links and observed prices), explains why each one fits, and says what it left out and why.

## Try it

- “Find a birthday gift for Maya. She loves pottery, has a beginner kit already, prefers handmade things, and our budget is $80.”
- “Maya loves pottery and handmade crafts, wants to try a pottery class, already owns a beginner kit, and the budget is $80.”
- “Gift for Sam under $50 — he enjoys gardening and coffee but hates scented candles.”

## What happens

One coordinator agent runs five specialist roles, each a real function:

| Role | Work |
| --- | --- |
| **Archivist** | Reads your message and extracts clues: interests, wishes, preferences, things already owned, dislikes, budget, occasion, and what is still unknown. |
| **Muse** | Turns the memory into a symbolic charm for the Unwrap gift box (pottery → a terracotta ceramic charm), chosen from a fixed library. |
| **Scout** | Searches live Google Shopping results via a verified Apify actor (through the Unwrap backend), keeping only listings with an https link and an exact USD price or an honest “price not observed”. |
| **Keeper** | Enforces the budget, removes things they already own or dislike, and notes soft preferences like “handmade”. |
| **Courier** | Coordinates the run and writes the answer. |

Muse and Scout run in parallel. Each step reports progress, which the Unwrap website uses to animate its AI Council characters.

## Honesty rules

- Products, links and prices come only from research results, never from the language model.
- If research is unavailable, the reply says so and offers search ideas clearly marked as unverified.
- Cached research is labelled as cached and keeps its original observation time.
- Prices are as observed at retrieval time; check before buying.

## Scope

Gift ideas for one person at a time, US listings in USD. It does not buy anything, handle payments, or store your conversation.
