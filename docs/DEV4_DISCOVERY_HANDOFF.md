# Dev 4 public-style discovery integration

The persisted backend lives in `convex/research/fashion.ts`. It uses the existing
Apify account and pinned GoFetch Actor; no new provider/key is needed. This is a
bounded public caption sample, not a TikTok popularity or growth measurement.
No room UI or Alan agent files were modified.

## Consumer sequence

1. Publish a confirmed interest/wish naming a reviewed style category: denim/jeans,
   jewelry/earrings/necklaces/bracelets, sneakers, sweaters/cardigans/knitwear, or
   handbags/purses/totes/crossbody (plus vintage if applicable).
2. Call `api.research.fashion.startDiscovery({roomId, idempotencyKey})` from an
   explicit human action. At most 20 posts, one fixed public query, cap $0.50.
3. Subscribe to `api.research.fashion.getDiscovery({roomId})`. Display the current
   job status and, if available, `sample.directions`. Each direction has garment,
   searchQuery, postUrls, distinctCreators and an honest sampled-mentions label.
   Display sample window/retrieval time and the source label. No growth/viral badge.
4. To search products from that context, call the existing
   `api.research.research.startResearch` with its ordinary arguments plus
   `fashionJobId: sample.jobId`. Include the supporting published clue IDs. The
   first sourced direction becomes the shopping query. An empty valid sample
   keeps the ordinary published-clue query, with no trend claim; usual budget/exclusions,
   membership, normalization and stale-job rules still apply.
5. If `latestJob.canResume`, call `resumeDiscovery({roomId, jobId})` to poll the
   existing run. This starts no new paid run. Unknown-start outcomes require
   operator review in Apify, not a new request key/repeated start.

The bounded vocabulary (`lib/research/styleCategories.ts`) supports denim, jewelry,
sneakers, knitwear and bags. Other categories need a reviewed table entry; arbitrary names, accounts and private
evidence cannot become social search terms. Empty suggestions are legitimate.
Style mentions do not establish garment age, size, stock or recipient ownership.

## Shared change and lifecycle

`schema.ts` adds only an import/spread of the research-owned `fashionTables`
fragment. `fashionJobs` has room/seed/request-key indexes. Existing data, payment
tables and agent jobs are unchanged. This additive table must be included when
the team next deploys the reviewed backend; no production deployment or shared
branch push is included in Dev 4's work.

Completion, reads and the shopping handoff recheck room knowledge, current
supporting clues and a 24-hour freshness window. Removed members/withdrawn clues
cannot leave a usable sample. Pending is durable before the paid POST. There is
one worker claim, a watchdog, saved run ID and no automatic paid retry.
Only derived directions/source URLs/provenance are stored, not raw captions,
author profiles, video media or raw private evidence. Alan may optionally consume
the new view/tool; his existing recorded `FashionAgentContext` is unchanged.

## Acceptance command

`node --env-file=.env.local scripts/fashion-smoke.mts --start` is restricted to
personal dev `cool-bat-724`, creates a synthetic test room and explicitly requests
one bounded source run. It makes no shopping, model or Stripe calls. Reports stay
under ignored `work/research-spike/fashion-live/<UUID>/`. A separate local file
contains only the synthetic room invite capability for resuming with another
anonymous session; auth tokens/API keys are never saved or printed.

If interrupted, use `--resume <same directory>`; do not repeat `--start`. A lost
mutation response reuses the same persisted idempotency key. A known uncertain
provider run resumes GET polling. The script reports real results, including zero
corroborated directions, without inventing a successful recommendation.

## Verified personal-dev result

Run `24af846a-937f-44b0-b0ce-29f6c589fb57`, provider run `1R5KZQSel0lZNY4uQ`,
completed on cool-bat-724. Synthetic room `p17dnds1emtkymdhzjnkz84jdd8gwzct`,
fashion job `pd791csvfjnv653hpp2hpm56558gxcbx`. One capped source start; no shopping,
model or Stripe calls. Read-only inspection of the same completed dataset found
20 rows, 8 normalized recent public posts and **zero corroborated style directions**.
The source responded correctly; it did not establish a recurring garment in this
bounded sample. Do not present it as a successful live trend recommendation.

This finding led to the empty-sample fallback and optional evidence counts.
Persisted start/poll/completion and member reads are verified live. The positive
discovery-to-shopping handoff is verified offline against recorded source data;
it was not established by this live sample. No repeated paid search was issued.
UI cards and Alan's tool call remain consumer work. Payment worker/cancellation
changes remain offline-tested helpers, not enabled payment controls.

## Google Trends discovery (live, same pattern)

`convex/research/trendJobs.ts` adds persisted Google Trends discovery for any short,
confirmed published interest/wish (e.g. "pottery tools", "rock climbing", "film camera").

1. `api.research.trendJobs.startDiscovery({roomId, publishedClueId, idempotencyKey})`
   from an explicit human action. One capped run ($0.20), US, past 3 months.
2. Subscribe to `api.research.trendJobs.getDiscovery({roomId})`. Show `sample.suggestions`
   (query, Google Trends link, rising % or breakout) with the label "related US searches,
   past 3 months; search interest, not sales". Show failed/uncertain status honestly.
3. Shop it: `api.research.research.startResearch({..., trendJobId: sample.jobId})` with the
   supporting published clue included. The first suggestion becomes the shopping query.
4. `resumeDiscovery({roomId, jobId})` when `latestJob.canResume`.

Names, numbers and long phrases are refused before any paid call. Needs Jonathon's deploy
(new `trendJobs` table) before it works on the shared deployment.

## Phase 2 — chosen ideas in the gift rings

The current map-first plan is on `origin/refactor` (`9550a1a` when this work began).
It proposes outer memories → middle themes → inner sourced listings → the box.
The MapTheme/DirectionSignal contracts remain proposed; this work does not invent
new theme tables or change Alan's agent implementation.

Dev 4 now supports choosing a specific returned trend/style query:

```ts
api.research.research.startResearch({
  roomId,
  publishedClueIds,
  idempotencyKey: "new-key-for-this-choice",
  trendJobId: sample.jobId,
  discoveryQuery: sample.suggestions[1].query,
});
```

Use `fashionJobId` plus a returned `sample.directions[i].searchQuery` for public
style samples. Without `discoveryQuery`, old callers still choose the first
suggestion. Explicitly choosing that same first item reuses an existing open
job. Different choices use distinct fingerprints and require new request keys.
Invented queries are refused; same-room/current-clue/freshness checks stay in
place. Selection itself makes no external discovery call or preference write;
it schedules the ordinary research pipeline when deployed and invoked.

Suggested consumer flow (not implemented here):

1. Alan's agent reads the available room-scoped discovery view and proposes an
   idea with the source URL, observation window, retrieval time and supporting
   published clue. Existing public discovery starts stay explicit human actions.
2. Ally renders it as a suggested direction by the relevant theme. “Research
   this” chooses its exact returned query using the call above.
3. Sourced products appear on the inner ring. A source path may explain “found
   while researching MKM pottery tools”; the observed related-search signal
   does not prove any individual SKU is trending. Keep personal exclusions ahead
   of trends and keep product prices/shipping/stock with product sources.
4. “Pass” is an attributed, undoable direction/theme reaction under Dev 2's agreed
   map contract. It must not withdraw confirmed interests, erase the source,
   become a private dislike, or silently invalidate everybody's products. The
   exact shared dismissal behavior still needs the theme/signal checkpoint.

Remaining integration: Dev 3 snapshot/tool wiring and theme generation, Dev 2
map projection and dismiss semantics, Dev 1 node actions/links. MAP-011 theme IDs
must derive from recommendation clue IDs after the proposed map contract is
accepted. No new provider, paid run, UI change, deployment or experience-gift
promotion is included. Maps/studio spikes remain deferred until the documented
team approval and architecture decision.

Validation on this branch: full offline suite **617 passed / 3 live skipped**;
`npm run typecheck` passed for frontend and Convex. Discovery selection is tested
against persisted fixture jobs; no new live Apify run was made. This validates
the backend seam, not the unbuilt agent/map interactions or a shared deployment.

### MAP-011 helper prepared against the proposed theme contract

`convex/research/themeLinks.ts` exports `recommendationThemeIds`. It derives a
stable unique list of theme IDs by intersecting a recommendation's active
same-room published-clue citations with each current theme's clue IDs. Dismissed,
stale, foreign and withdrawn-source themes do not produce paths. Theme label
similarity is never used as product evidence. Eight offline cases pass.

This helper does not implement or deploy the theme schema or map projection.
Dev 2 calls it from the membership-scoped ring projection once the shared proposed
shape is agreed; Dev 1 can then draw paths using the returned IDs. Alan still owns
creating themes/agent suggestions. Existing trend/style selection already accepts
`discoveryQuery` for a chosen returned suggestion. Source windows and provenance
stay visible; group dismissal remains the agreed signal/theme operation.
