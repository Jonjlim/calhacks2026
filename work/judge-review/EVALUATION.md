# Unwrap: first-time judge evaluation

Reviewed 2026-10-25, local branch `dev3/rings-prototype`, commit `449ee6e`. These scores are subjective product judgments, not usability-study measurements or prize probabilities.

**Verdict: 5.5/10 for the current two-minute demo.** The visual world is memorable. The core value is still hard to reach and a live research failure stops the journey. More features will not solve that. Finish one reliable memory → explanation → choice → approval → reveal path.

## Evidence and limits

- Browser-tested the actual app on localhost:3000 using a new synthetic “Demo Maya / Judge walkthrough” room. Created a room, entered the map, published three synthetic memories, grouped themes, started council research, opened a theme and inspected recovery controls.
- Theme generation succeeded: “Hands-on pottery craft” and “Slow Sunday coffee”. The result was present at the check 13 seconds after the request; this is an observation bound, not a measured provider latency.
- The council research request stopped without showing products. The present said “The search stopped · try again”; the bottom status still said “The council is looking for real gifts from these memories.” The UI did not expose enough information to identify the failed dependency. No repeat search was issued.
- Separately tested `/room/dev-reveal?many=1`, a development fixture, for populated-map readability, product inspection, the entire reveal, the reveal-to-contributions transition, and the attached split panel at 915 × 820. Fixture success is not evidence of live sourcing or two-user approvals.
- `npm run typecheck` passed. `npm test -- --reporter=dot`: 752 passed, 4 skipped (68 files passed, 2 skipped). These do not prove the deployed provider workflow.
- Did not independently verify two-device cursor/vote synchronization, two real participants approving a revision, live trend results, positive live shopping results, or real payments. Source code and the previous Claude handoff were reviewed for those seams.
- Frontend configuration targets `cool-bat-724`; the local Convex CLI deployment marker still names `compassionate-alpaca-531`. No environment or deployment changes were made.
- Code was not modified for this evaluation. One synthetic room was added through the UI; normal automatic discovery may have been scheduled by publishing its clues.

## Ratings

| Dimension | Score / 10 | Why |
| --- | --- | --- |
| Visual identity | 8.5 | Distinctive storybook world, custom icons, coherent craft; screenshot appeal is strong. |
| First-use clarity | 4 | The first action is Begin, then Invite. The personal gift value arrives after setup. Map gestures and themed terminology require explanation. |
| Functional completeness | 5 | Substantial backend and UI exist; theme generation worked, but the main live research path failed in this session. Multiuser acceptance remains unverified. |
| Two-minute flow | 4 | Manual setup, clue entry, grouping and research consume attention before a sourced recommendation appears. The ending routes back to an older drawer. |
| Visible personalization | 5 | Themes clearly reflected the clues. No live products appeared, so suitability, exclusion and re-ranking were not demonstrated. |
| Ending | 7.5 | The reveal works well in the fixture. Split amounts are legible, but approval and reveal are out of narrative order, with multiple contribution surfaces. |
| Overall demo readiness | 5.5 | A guided presentation can explain the promise; a cold judge cannot yet reliably discover and complete it. |

The tests justify confidence in implemented rules, not an 8/10 rating for the user experience.

## What is undermining the experience

1. **The main value can fail before it becomes visible.** If no products arrive, the judge sees a beautiful memory organizer. A generic retry sentence provides no useful route forward, and the contradictory status damages trust. Fix this before any new animation.
2. **The world gets attention before the task.** The intro timeline alone is 10.6 seconds before loading gates; setup then asks for an invite. The hero island occupies the center while actionable objects are small satellites. A judge can remember the island and still not know why this chooses a better gift.
3. **Cloud styling does not solve information density.** The current layer ordering is better. But opening a theme still adds memory clouds, a theme label, a caption cloud and action pills. At laptop width, the attached shares panel covers a substantial part of the map. Use semantic zoom, a single detail surface and camera framing/collision checks; do not make every piece of text a cloud.
4. **The user is operating the orchestration.** Share memories, Group, Find gifts, Help us choose and research trend suggestions are separate concepts. Hide that machinery behind a clear next action such as “Find a gift from these memories”; show the work as it happens.
5. **The agents have not yet earned their screen time.** Multiple characters and role names do not prove useful agent collaboration. Show one consequential result: “It ruled out the kit she owns, compared alternatives, and kept the class.” Let a human correction visibly change the outcome.
6. **The strongest narrative is reversed at the end.** The fixture permits reveal at 1/2 approvals, then says contributions are planned next. “Plan our contributions” opens the older shares drawer (`RoomLayout.tsx`, `onPlan`). Clicking the present separately opens `BoxPanel`. Decide on one order and one surface. For this demo: choose → each person approves their amount → wrap/reveal. Keep early preview separate if useful; this is a product flow issue, not evidence of an unauthorized charge.
7. **Capability is ahead of presentation.** The backend supports trend context, shared passes, multi-gift baskets and payment simulation. Some of those are not clearly integrated into the primary room. Do not add all of them to the two-minute story. A working feature elsewhere is not a completed main journey.

## Prioritized next steps

### P0. Restore the real gift path

- Confirm the intended deployment and running server use the same backend; resolve the CLI/frontend mismatch before a deployment.
- Reproduce the stopped council request and inspect the existing run's provider/service error. Check council endpoint/secret/callback health, model configuration and source credentials based on the actual error. Do not assume an OpenAI key enables the whole chain.
- Drive all visible progress from persisted job state. Failure must override an earlier success notice. Distinguish failed, uncertain, empty and completed; resume uncertain work rather than creating another paid job.
- Surface one useful recovery action on the present. Preserve all clues. Allow the user to inspect already retrieved, timestamped real results when available; label prepared results truthfully rather than inventing live success.
- Acceptance: three consecutive fresh synthetic rooms produce at least two usable, source-linked options, or an honest recoverable empty/error state. Separately force a failure and verify no stale “searching” message remains.

### P0. Make one demo path, with one ending

- Make a present-attached task spine: Add a memory → Find gifts → Compare → Approve shares → Reveal. Keep the current step and primary action visible; do not require the user to know agent-role names.
- Route every contribution action to the existing map-native split surface. Eliminate the reveal CTA's older-drawer detour. Close competing cards and frame the present when shares open.
- Preserve each person's explicit approval of their own amount and revision resets. Establish private limits before the final split so the judge does not discover zero/unset caps at the climax.
- Acceptance: two independent sessions join, contribute, react, choose, set limits and approve. Change the gift/share; both sessions must show reset approvals. Then reveal. No hidden administrator actions or presenter-only backend repair.

### P1. Prove personalization with one intervention

- Start with three complementary clues, including an ownership/avoidance constraint.
- Show two or three image-led options with a short recognizable name, observed price and a concrete fit reason. Source details can expand on demand.
- Let the judge add “she already owns that.” Show the attributed change, exclusion or alternative and its evidence path. Keep soft votes distinct from facts.
- Acceptance: the judge can explain why the chosen gift fits in one sentence without opening Backstage.

### P1. Reclaim visual space and reduce setup

- Keep the island world, custom icons, restrained clouds and reveal. Reduce the center scenery's dominance while comparing options.
- At rest: tiny people/dots and short theme labels. At focus: one compact card; fade other labels and make room instead of drawing over them. At shares: only the present and approvals need detailed text.
- Add a plain-language promise at entry and a direct “Start a gift” action. Make inviting optional while the organizer adds the first memory. Offer a clearly labelled prepared demo room for the presentation; keep a genuine fresh-room path for follow-up.
- Acceptance: at 915 × 820 and phone width, selected controls stay in view, targets do not move on hover, important content is not obscured, and new users find the first action without coaching.

### P2. Only after the above

- Show one trend discovery only if it improves the gift and its provenance is legible. Search interest is not recipient preference or product popularity.
- Refine multi-gift boxes, the paid-flow simulation, additional sources, agent exposition and decorative polish after the primary path passes.
- Do not spend the next block adding a provider, completing real Stripe, or producing more camera sequences. They do not fix today's blocked research and fractured ending.

## Proposed two-minute presentation (target timings, not measured)

| Time | User-visible beat | Proof |
| --- | --- | --- |
| 0–10 s | “Friends know different pieces of someone. Unwrap turns those memories into one gift everyone agrees on.” Open a prepared room. | Product promise, not a tour of the world. |
| 10–25 s | Judge adds one short memory; a second participant's cursor/contribution is visible. | Real collaboration. Prepared clues are identified as prepared. |
| 25–45 s | Related themes and 2–3 sourced options appear. | Explain whether results were fetched now or retrieved earlier; keep source and observation time available. |
| 45–65 s | Judge passes or confirms ownership of an option; alternatives change. | A consequential intervention, with an intelligible reason. |
| 65–85 s | Inspect Why, then put the chosen option in the present. | Memory → theme → gift evidence, not agent chatter. |
| 85–105 s | Each participant sees and approves their own split amount. | Exact version, visible agreement, private caps stay private. |
| 105–116 s | Wrap/reveal animation. | Emotional payoff after agreement. |
| 116–120 s | End on gift, price/source and everyone's yes. | Selected/pledged, not purchased or charged. |

For a cold fresh-room demo, do not pretend these timings are already achievable. Instrument time to first useful option and full completion. First target: a useful option by 45 seconds in the prepared demonstration and a complete honest two-minute journey in three rehearsals. Stop narration during the judge's key interaction so the interface has to carry the explanation.

## Competitive judgment

The art direction can win attention. Attention is not yet proof of a useful product. Today I would remember “a beautiful floating-island gift app” more readily than “a system that found the right gift and got friends to agree.” Change that memory through visible cause and effect. The distinctive combination is collaborative clues, grounded recommendations and a versioned group decision. More agents or more scraping are supporting implementation, not the pitch. Prize odds cannot be inferred from this review without the actual rubric and competing entries.
