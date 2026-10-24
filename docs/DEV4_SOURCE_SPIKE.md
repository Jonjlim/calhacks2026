# Dev 4 source spike (RC-002)

Status: **conditional go for discovery** — two authenticated live searches succeeded. Direct merchant URLs and final checkout prices remain unverified.

Candidate: [johnvc Google Shopping API](https://apify.com/johnvc/google-shopping-api-google-shopping-products-prices-deals).
Chosen for documented keyword search, US targeting, one-page limit, and nested shopping_results with product_link/extracted_price/source. This is a community Actor; documentation is not evidence of live reliability.

## Setup

1. Sign into Apify and apply any hackathon credits.
2. Open the Actor page and confirm account access and current pricing.
3. In Apify Settings → Integrations, get an API token.
4. Add APIFY_TOKEN to the repo's ignored .env.local using an editor. Never put it in chat, git, a NEXT_PUBLIC variable, or a command argument.
5. From the repo root (Node 22.18+):

```bash
node --test scripts/apify-spike.test.mts
node --env-file-if-exists=.env.local scripts/apify-spike.mts "pottery tools"
```

No npm install or Convex deployment is needed for this spike. The script sends the public product query only. It requests one page, a 120-second Actor timeout and a $0.20 maximum total charge through the Apify run API. No automatic POST retry. A timeout is uncertain, not proof no run started. Check Apify Console before retrying.

Each attempt saves report.json under ignored work/research-spike/. Successful runs also save raw.json. Reports retain run ID, build, timestamps, latency, reported usage and field counts, never the token. If start times out before returning an ID, check recent runs in Console.

## Acceptance

- Actor completes and returns at least one linked product with numeric price.
- Open 3–5 result links: verify product relevance, usable destination and USD price meaning (not installment price).
- Note missing images, unavailable products, bundles, prices and shipping; do not infer stock or free shipping.
- Repeat with a second distinct public query if the first looks usable.
- Inspect latency and actual charges in Console. Then record go/no-go and pin the successful build for the production adapter.

An automated candidate pass only checks shape; it does not certify a purchasable USD listing. Do not mark this source verified until the manual checks pass.

## Boundaries

This standalone local tool is not the production research pipeline and does not write Convex listings. Production calls will run in Convex actions, use authoritative pending jobs, membership checks, deduplication and stale-job suppression. No shared contracts change in RC-002. Next task: normalize a real recorded response into ProductListing (RC-003).

API references:
- https://docs.apify.com/api/v2/actors-runs-post
- https://docs.apify.com/api/v2/actor-run-get

## Live results — October 24, 2026

- `pottery tools`: run `f5AxmAwXurYB2UWjz`, 6.495 seconds, 40 products; all 40 have titles, numeric prices, images and HTTP links.
- `ceramic coffee mug`: run `nTeqiyfQuvBuiDTyo`, 13.239 seconds, 40 products; all 40 have the same required discovery fields.
- Both used build `0.0.142` (`4UmpnMb480FJPsg3x`). Pin this verified build when implementing the production adapter.
- All returned product links in these runs point to Google Shopping, not direct merchant URLs. Web-fetch checks could not open the three sampled Google URLs; browser click-through verification is still needed. Do not label them direct checkout links.
- Independent merchant lookup confirmed that the Mudtools Do-All Trim Tool exists at The Ceramic Shop and its displayed $21.25 matched the search result: https://www.theceramicshop.com/product/14889/do-all-trim-tool/ . This is one corroborated example, not verification of all prices.
- Blick's matching product page existed, but the fetched page did not expose a usable current price. The independently found Michaels page redirected to its homepage. These do not count as successful price checks.
- US-targeted results displayed dollar prices; do not generalize currency handling to other countries. Availability and shipping remain unknown unless independently supported; conditional free-shipping text is not zero shipping cost.
- One mug result was a four-pack: preserve bundle/variant wording and do not treat a bundle price as a single-item price.
- Run-reported usage was $0.00001 for the first response and $0.04001 for the second. Final billed totals must be checked in Apify Console; an immediate run response is not a settled billing statement.
- Raw responses and reports stay ignored under `work/research-spike/`. Promote only a reviewed, minimal public-product fixture for RC-003; strip opaque Google page tokens and provider helper URLs.

Decision: proceed with RC-003 normalization using this Actor as a discovery source. Keep source attribution and observed-price labels. Direct merchant navigation, stock, shipping, tax and purchase confirmation are outside what this spike established.
