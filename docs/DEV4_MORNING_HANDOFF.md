# Dev 4 morning handoff

Snapshot: October 24, 2026, about 04:30 America/Los_Angeles. This is a local integration snapshot, not a deployment sign-off. Later follow-up work should update this file rather than create competing handoffs.

## Branches and integration

The team now integrates through **dev**. At the remote check, `dev` and `main` both pointed to `62c1932`; `p0` still existed at `7d7f664`, despite being treated as historical by the team.

Work remains on `dev4/alex`. Main's 3D world/avatar/intro update and the latest dev live-UI update have been integrated. Merge `9093ee7` preserves dev's new UI while restoring the previously tested agent/ranking/photo-plan changes that the “Sync main into dev, keeping dev tree” commit omitted. No shared branch has been changed by this work.

The earlier homepage-mock concern applied to main at `90bb0de`. It is outdated for dev at `62c1932`: the newer landing actions and room screen are wired to Convex when configured, with a labeled offline preview otherwise.

## What is implemented

- Core Dev 4 product retrieval, normalization, job fencing/idempotency, live re-ranking, ownership/exclusion filters, listing invalidation, image preservation and freshness helpers.
- Wheel-throwing → pottery-wheel positive matching from the separate Dev 4 branch is included.
- `2f9612d`: local Google Trends spike and recorded tests.
- `c72d991`: local TikTok caption/hashtag fashion discovery and recorded shopping handoff.
- `5544caf`: two reviewed manufacturer/model matches for tool titles missing the pottery term. Explicit source explanations; bounded coverage, not a general category classifier.
- Search brief limits now obey the existing shared validator: 1–12, with safe defaults for non-finite inputs. Regression cases validate actual builder output against the shared Zod schema. The previous builder allowed 24 despite the validator allowing 12; current research requests use the default, so this hardens the optional pure-function input rather than fixing a demonstrated production outage.
- `convex/research/demo-flow.test.ts`: a two-member offline backend rehearsal from published preferences through a recorded product, selection, approved pledges, cap-change invalidation and listing recovery. Membership and private-cap views are exercised. It injects recorded data at the completion boundary and makes no provider/model calls.

The discovery spikes are **not production features**. No TikTok or Google Trends context is currently fed into Alan's LLM. The reviewed model catalog is part of the current ranker; it is separate from social popularity and does not set trend scores.

## Validation so far

- Integrated suite including the new demo rehearsal: **286 passed, 3 live-only skipped**. The rehearsal passed individually as well.
- App and Convex TypeScript checks pass after explicitly converting the public string listing ID back to its Convex ID type at mutation calls in the test.
- Exact locked dependencies installed with `npm ci --ignore-scripts`; the install reported zero vulnerabilities.
- Default Turbopack build: sandbox font-network failure, then a host process/port-binding panic on retry. This is not a passing default build.
- Supported alternate verification: **`npm run build -- --webpack` passed**, including TypeScript, page generation and build tracing. Project build defaults were not changed.
- No production deployment or real two-browser connected-room acceptance test was performed. Existing live-only tests remain skipped deliberately.

## What P means

P0, P1 and P2 are **three priority tiers**, not a serial progress bar. We are still validating the P0 end-to-end demo while optional work exists alongside it.

- P0: rooms, private import/review/publication, agent-assisted research, real products, selection, private caps, versioned approved pledges; photos are planned P0 with a fallback if the vision path slips.
- P1-A: separate permissioned recipient agent. P1-B: sandbox payments. P1-C: screenshot evidence.
- P2: extras such as trend integration, voice, additional/custom product Actors and other optional enhancements.

The execution document has six numbered phases (0 through 5), plus the 2B photo and 3C screenshot subphases. Checkpoints are C0 through C4, then freeze. A unit/build pass is not proof that C2/C3 browser/privacy acceptance has passed.

## Remaining work and ownership

1. **Dev 4 + Alan:** agree on the source-backed discovery-to-gift-direction handoff before integrating social context into the existing buyer agent. Keep published preferences separate from untrusted public posts. Avoid inventing a second agent system or parallel contract.
2. **Dev 4:** broader product relevance beyond the two reviewed models needs actual product/category evidence; search/seller association alone is insufficient. Keep ownership literal and respect explicit category exclusions.
3. **Alan + Jonathon:** actual photo reading/upload lifecycle remains a dependency; photo contracts and research matching tests do not prove media support is implemented. Verify their latest work before taking over files.
4. **Dev 1 + team:** walk the live landing → join → import → review/publish → research → select → caps → approve flow in two browsers. Check card image failures/placeholders, price freshness, stale/failed research, and approval invalidation. The newer UI has images/freshness/pledge controls wired; browser behavior still needs acceptance.
5. **Team:** confirm the proposed no-pay demo decision. Stripe and recipient-agent features are optional; do not imply that approved pledges charge anyone.

## Review recommendation

Review the feature branch against **dev**, then merge through the team's usual review path. First review restored backend fixes and the two-model matching change; review optional source experiments separately in the diff. The catalog/exclusion behavior is documented in CONTRACTS.md for the integration checkpoint. Preserve the newer live UI during the review. Fetch again immediately before merging because teammates are active.

Until Alex reviews: no deploy, no shared-branch push/merge, no production data cleanup, no secret changes, no teammate messages and no new recurring paid source runs. Local commits are the reviewable deliverable. The bounded follow-up ends around 07:05 local time or earlier when useful independent work is complete.

## Overnight stop

Independent scoped work is complete at this snapshot. Remaining live acceptance and agent/media integration need team coordination or deployment access, so the bounded heartbeat was stopped early rather than adding unused features. All work stays local for Alex’s review. No live providers were called during the final offline rehearsal/brief-limit follow-up.

## Follow-up after Alex requested continued work

Hardened local fashion discovery against conflicting duplicate posts: neither source ordering nor the discovery caller can erase an advertising flag by supplying a second copy. Conflicting evidence is omitted; engagement counter updates alone are tolerated. Added backend integration regressions proving a failed replacement search retains the last successful catalog without restarting the provider, and an obsolete scheduled poll is fenced before any network request. Full offline suite: 286 passed, 3 live-only skipped; app and Convex TypeScript checks passed. No paid calls, deployments or shared-branch changes.
