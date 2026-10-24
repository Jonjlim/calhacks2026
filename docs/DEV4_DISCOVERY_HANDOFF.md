# Dev 4 public-style discovery integration

The persisted backend lives in `convex/research/fashion.ts`. It uses the existing
Apify account and pinned GoFetch Actor; no new provider/key is needed. This is a
bounded public caption sample, not a TikTok popularity or growth measurement.
No room UI or Alan agent files were modified.

## Consumer sequence

1. Publish a confirmed interest/wish containing denim (and vintage if applicable).
2. Call `api.research.fashion.startDiscovery({roomId, idempotencyKey})` from an
   explicit human action. At most 20 posts, one fixed public query, cap $0.50.
3. Subscribe to `api.research.fashion.getDiscovery({roomId})`. Display the current
   job status and, if available, `sample.directions`. Each direction has garment,
   searchQuery, postUrls, distinctCreators and an honest sampled-mentions label.
   Display sample window/retrieval time and the source label. No growth/viral badge.
4. To search products from that context, call the existing
   `api.research.research.startResearch` with its ordinary arguments plus
   `fashionJobId: sample.jobId`. Include the supporting published clue IDs. The
   first sourced direction becomes the shopping query; usual budget/exclusions,
   membership, normalization and stale-job rules still apply.
5. If `latestJob.canResume`, call `resumeDiscovery({roomId, jobId})` to poll the
   existing run. This starts no new paid run. Unknown-start outcomes require
   operator review in Apify, not a new request key/repeated start.

The current bounded vocabulary supports denim garments. Other clothing categories
need a reviewed seed/vocabulary extension; arbitrary names, accounts and private
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
