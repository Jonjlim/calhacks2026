# Dev 3 demo beats

What to show for the agent work, in order. Each beat names the real behavior behind it and what to say if something is slow. Dev deployment: `compassionate-alpaca-531`. No beat depends on a paid product search: use the fixture pool (`DEMO_SEED_ENABLED=true`) when Apify is unavailable, and say so.

1. **Private to public.** In "Paste messages", paste two lines about the recipient. Unwrap proposes clues only you can see. Publish two. *Point out:* nothing reached the room until the tap.
2. **A photo.** In "Photos and screenshots", add a photo, tap the person it's for, and press Find clues. The note on screen says it's read once and deleted. Single-photo terms come back as "Maybe"; the same term in two photos merges. *If the vision call is slow:* the feed shows the real job state.
3. **Ask Unwrap.** `@unwrap what do you recommend?`. It cites the clues behind each option; prices and availability are copied from the stored listing, never typed by the model.
4. **The room learns something.** Add the clue "Already owns a starter kit". Within a few seconds the feed shows `Dropped “… Starter Kit” because the room confirmed: “Already owns a starter kit”` and the shortlist reranks without a new search.
5. **Follow-up.** `@unwrap why did the kit disappear, and which is cheapest?`. A short reply, then the observed facts for each option it mentions.
6. **Keep chatting.** Organizer turns on "Let Unwrap join the conversation"; a friend asks the room a question without @unwrap and Unwrap answers. It cannot start a search or ask a recipient question on its own.
7. **Agents talking.** With the synthetic recipient profile enabled, ask "would she like a beginner class? check with her agent". The feed shows Buyer agent ↔ Recipient agent; only approved, disclosable preferences are used.
8. **Real numbers.** "How Unwrap worked on this gift": calls, tokens, median answer time, dropped listings and why, recipient questions allowed or refused. Anything unrecorded says unknown.
9. **Zoom out.** `/worlds`: other gift sessions (labelled samples plus anyone who opted in) with occasion, friends, the clue lines their organizer chose, and the final pick. Share your own room from the right column.

Automated versions of beats 1, 3–5 and 7: `scripts/run-e2e-live.sh`, `A2A=1 scripts/run-e2e-live.sh`, `scripts/run-e2e-replan.sh`.
