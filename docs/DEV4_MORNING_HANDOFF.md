# Dev 4 morning handoff

Snapshot: October 24, 2026, about 09:50 America/Los_Angeles. This is a local integration snapshot, not a deployment sign-off. Later follow-up work should update this file rather than create competing handoffs.

## Branches and integration

The team now integrates through **dev**. At the latest remote check, `dev` points to `6df29dd` (Ally’s island/council/phone update), `main` remains at `62c1932`, and `alan` points to `4c02fa2`. Older Dev 4 core retrieval work is in dev; our newer experiments and fixes are local.

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

The discovery spikes are **not live production discovery features**. A recorded TikTok direction can now reach Alan’s existing buyer snapshot under `DEMO_SEED_ENABLED=true`, only for a matching confirmed vintage-denim clue and within 24 hours of the original sample retrieval. It is explicitly labeled recorded. Google Trends context is not connected. The reviewed model catalog is part of the current ranker; it is separate from social popularity and does not set trend scores.

## Validation so far

- Integrated suite including the new demo rehearsal: **359 passed, 3 live-only skipped**. The rehearsal passed individually as well.
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

1. **Dev 4 + Alan:** review the recorded discovery bridge now connected to the buyer snapshot. Live TikTok refresh, persisted discovery provenance and visible social-source explanations remain pending. Keep published preferences separate from public sample evidence.
2. **Dev 4:** broader product relevance beyond the two reviewed models needs actual product/category evidence; search/seller association alone is insufficient. Keep ownership literal and respect explicit category exclusions.
3. **Alan + Jonathon:** Alan’s photo/screenshot upload and read-once lifecycle are now integrated locally. The browser and real vision-provider acceptance still need to run; offline tests do not prove live media behavior.
4. **Dev 1 + team:** walk the live landing → join → import → review/publish → research → select → caps → approve flow in two browsers. Check card image failures/placeholders, price freshness, stale/failed research, and approval invalidation. The newer UI has images/freshness/pledge controls wired; browser behavior still needs acceptance.
5. **Team:** confirm the proposed no-pay demo decision. Stripe and recipient-agent features are optional; do not imply that approved pledges charge anyone.

## Review recommendation

Review the feature branch against **dev**, then merge through the team's usual review path. First review restored backend fixes and the two-model matching change; review optional source experiments separately in the diff. The catalog/exclusion behavior is documented in CONTRACTS.md for the integration checkpoint. Preserve the newer live UI during the review. Fetch again immediately before merging because teammates are active.

Until Alex reviews: no deploy, no shared-branch push/merge, no production data cleanup, no secret changes, no teammate messages and no new recurring paid source runs. Local commits are the reviewable deliverable. The bounded follow-up ends around 07:05 local time or earlier when useful independent work is complete.

## Overnight stop

Independent scoped work is complete at this snapshot. Remaining live acceptance and agent/media integration need team coordination or deployment access, so the bounded heartbeat was stopped early rather than adding unused features. All work stays local for Alex’s review. No live providers were called during the final offline rehearsal/brief-limit follow-up.

## Follow-up after Alex requested continued work

Hardened local fashion discovery against conflicting duplicate posts: neither source ordering nor the discovery caller can erase an advertising flag by supplying a second copy. Conflicting evidence is omitted; engagement counter updates alone are tolerated. Added backend integration regressions proving a failed replacement search retains the last successful catalog without restarting the provider, and an obsolete scheduled poll is fenced before any network request. Full offline suite: 286 passed, 3 live-only skipped; app and Convex TypeScript checks passed. No paid calls, deployments or shared-branch changes.

## Awake-session integration

- `bbb2439`: merged latest dev (`6df29dd`) locally, retaining our research changes.
- `c6d4062`: merged Alan’s ready branch (`4c02fa2`). Preserved Ally’s island/phone layout and placed media intake, chat mode/activity/stats, recipient demo and optional world sharing within its existing tabs. Retained our reviewed catalog matching; used Alan’s newer conversational agent and smoke/live scripts. No shared branch push.
- `6afeb59`: fixed /worlds build failure without Convex configuration by rendering an explicit offline fallback before any provider-dependent hooks.
- The recorded fashion bridge adds only an optional internal snapshot field and pure source-context builder. It does not add a database, paid call, service or environment change. Integration test runs Alan’s buyer with mocked model output, checks source context reaches it, then verifies the chosen query reaches the existing shopping worker while server budget/exclusions override model values. No new preference is published.
- Current validation: 359 passed, 3 live-only skipped; app and Convex TypeScript passed; webpack production build passed with the integrated /worlds and /council routes. Live browser/deployment acceptance is still pending.

## Connected two-browser attempt (October 24, about 10:10 local)

Alex supplied `https://striped-alpaca-645.convex.cloud` for the test. Used an isolated
copy of this branch on port 3100 to avoid interrupting a teammate’s dev server in
the main checkout. The process received only the public Convex URL; no env files
or deployment settings were changed.

Browser sessions used separate origins (127.0.0.1 and localhost) for independent
anonymous identities. Created the clearly labeled `TEST ONLY Maya 2026-10-24`
room (`mx7effrsrqq3ykp3qds5w9p3bd8gxsb5`) as Alex Browser Test. Jordan Browser Test
joined through its invite; the invite UI updated from one person to two. These
are synthetic test records on the supplied backend; no cleanup was attempted.

Opening the room failed on `councilRoom:state`, request IDs
`a4cc9b7371e14456` and `d7766a58788cc310`. The browser received a generic server
error, so the underlying cause is not confirmed. The old UI incorrectly rendered
“Room not found”. Local code now separates the council query behind an error
boundary, shows council unavailability, disables its launch button in that state,
and uses a backend-failure message for unexpected core room errors. This changes
no server permissions, money, research routes or deployment code.

The post-change browser retest could not complete because browser automation
became unresponsive. TypeScript passed and the full offline suite remained
359 passed / 3 live-only skipped. This does not establish a passing live room test.
Private clue isolation, live voting, live cap privacy, and browser approval
invalidation remain unverified in this deployment. Server-side logs were requested
from Alex. No paid provider calls, purchases, shared-branch pushes or deployments
were performed by this test.

## Shared-dev publication preparation (October 24, after personal dev setup)

Alex configured personal dev deployment `cool-bat-724`, set up auth, and added the
four model/product variables. A live API preflight on that deployment passed two
independent sign-ins, room creation/invite/join, a two-member room read, and an
empty `councilRoom:state` response without AI or Apify calls. Alex then reported
the browser flow works. This is distinct from the earlier production failure.

Before publishing, fetched shared dev at `18bcd59` and integrated its desktop
stage / phone controller, real invite QR and avatar changes. Kept Alan’s photo,
private clue review, chat, activity/stats and optional sharing tools accessible
through the stage’s room-tools drawer and the phone’s collapsible room tools.
This is integration wiring, not a replacement for either developer’s layout.
Kept the newer surface routing and the council failure isolation. Restored the
team’s exact lockfile after installing its existing pinned QR dependency.

The initial merged checks passed 364 tests (3 live-only skipped) and app/Convex
TypeScript. Production build and final remote race check are required before the
requested shared-dev push. No production Convex deployment is part of this push.

Final publication checks: 364 tests passed, 3 live-only skipped; app and Convex
TypeScript passed; webpack production build passed from an isolated archive of
merge `03d6262`, including `/room/[roomId]/phone`. Final fetch showed zero remote
commits missing from this branch. Alex authorized the shared-dev push. This is
source integration, not a production Convex deployment or a new live-browser
acceptance claim for the merged phone surface.

## P1-B adapter work started at Alex’s request

P0 implementation/acceptance is no longer used to block independent Dev 4 P1 work.
Implemented a test-only Stripe REST adapter for hosted organizer collection or
manual authorization, Checkout/intent retrieval, open-session expiry, explicit
capture and refunds; added raw-body webhook signature verification. Outbound writes
require idempotency keys; provider objects require test mode, exact requested IDs,
USD amounts and revision/participant/attempt metadata. Pending/uncertain states
remain explicit; the helper neither authorizes operations nor writes payment state.

Validation: 47 new payment tests; full suite 411 passed / 3 live-only skipped;
app and Convex TypeScript passed. All payment tests use synthetic provider responses;
no actual Stripe call, charge, capture, refund or webhook acceptance was performed.
Alex is configuring a test key privately. Dev 2’s payment tables, durable claims,
event deduplication and state transitions are still absent, so no client payment
endpoint or UI has been enabled. Live sandbox spike, post-authorization cancellation,
refund polling and multi-contributor recovery remain open. Payment work stays local
for the money/state integration review; the earlier dev push did not contain it.

## Independent backend work while Alex was away (October 24, about 11:20 local)

- `075b576`: completed read-only Stripe recovery helpers and an auditable sandbox spike. Provider reads compare amount, intent IDs and room/revision/member/attempt bindings; refunds are fresh, bounded and deduplicated. Full vs partial capture/refund and unresolved states remain distinct. Raw failures stay sanitized.
- Actual sandbox check on personal dev cool-bat-724 passed create → retrieve → expire of one $1 synthetic Checkout. No card entered, funds authorized/captured or refund executed. Run 29a37712-0039-47a8-9d69-1d72f2fa2720. The configured secret was read into memory only, never printed or saved. Initial missing-key checks made no Stripe requests.
- `136db89`: removed the fifty-request limit that could hide a valid older successful shortlist, and fenced superseded lost workers as stale before the timeout path. This avoids blocking a fresh explicit search with an old unresolved request. Both bugs have regression tests.
- Validation: 438 passed / 3 live-only skipped with `npm test -- --maxWorkers=2`; app and Convex TypeScript passed. A simultaneous default-parallel run hit five-second timeouts; no assertions were weakened. Limited-concurrency verification passed all tests.
- Synced backend code to **personal dev cool-bat-724 only** with `npx convex dev --once`; functions ready at 11:20:08. No production deployment, shared-branch push or secret/environment modification was performed.
- Payment adapter/recovery work remains in local commits for review. End-to-end payments are not enabled: Dev 2 still needs durable attempt/event storage, operation claims, approvals/current-revision checks, state transitions and the webhook route. See DEV4_PAYMENTS_HANDOFF.md. Verified signature parsing alone is not durable webhook handling.

Remaining task status: RC-010 has verified hosted-session primitives, not a finished
user-facing Checkout flow. RC-011 has capture primitives but not multi-contributor
orchestration. RC-012 has signature verification plus fresh provider reconciliation,
not durable database deduplication. RC-013 has expiry/refund primitives and recovery
observations; real post-authorization cancellation and group recovery still need
acceptance. RC-014 remains recorded discovery context, not live discovery fetching;
RC-015 (optional additional product source) is not implemented. Do not call these
full milestones complete from adapter/unit test results.
