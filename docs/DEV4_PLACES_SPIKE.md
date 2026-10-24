# Dev 4 local activities (Google Maps places) experiment

Status: **conditional go for local-activity idea discovery; no-go as a direct priced-gift source.** One bounded live test of the Apify Google Maps scraper returned ten real, well-rated pottery-class studios for a synthetic public city, so the source can supply concrete "local activity" gift ideas. Every place lacked a price, so results cannot yet feed a contribution proposal, which requires an observed price. Local experiment only: no deployment, schema, contract, ranking or payment change. Production reliability is unverified from a single run.

Candidate: [Google Maps Scraper](https://apify.com/compass/crawler-google-places) (`compass/crawler-google-places`), build `0.14.775` as reported by the run (`build=latest` was requested; the actor pages show no public build number). Pay-per-result pricing: the "scraped place" event is $4.00 / 1,000 places on the Free plan (less on paid plans) plus $0.00005 per actor start, so 10 places cost about $0.04005. Every personal or paid add-on was disabled in the input: no reviews (`maxReviews: 0`), no reviewer personal data, no images or image authors, no place detail pages, no web results, no company contacts, business leads, email verification or social-media enrichment, no questions, no competitor analysis, and no closed-place filter (closed places are dropped locally so the "filter applied" add-on is never charged).

## Run

```bash
node --env-file-if-exists=.env.local scripts/apify-places-spike.mts "pottery studio"
# To poll the same run after interruption (no new paid start):
node --env-file-if-exists=.env.local scripts/apify-places-spike.mts --resume work/research-spike/places-<timestamp>
```

Reads server-only `APIFY_TOKEN` from ignored `.env.local`; the token is never printed, logged or saved. Saves a pending report before the single paid POST, never retries the POST, then records run ID, build, status, elapsed time and run-reported usage, and writes the raw dataset plus normalized output under ignored `work/research-spike/places-<timestamp>/`. Requests `timeout=180&memory=1024` and a hard per-run charge ceiling. Reported usage is not a settled invoice.

**Cap deviation, recorded honestly:** the platform rejected the intended `maxTotalChargeUsd=0.10` with `max-total-charge-usd-below-minimum` ("Maximum cost per run is less than the allowed minimum of $0.50"), so the smallest enforceable ceiling is $0.50 — the same value the TikTok spike already uses. The two rejected starts created no run and charged nothing (verified with a read-only run listing; the failed-attempt report is kept at `work/research-spike/places-2026-10-24T21-25-16.706Z`). The input still bounds expected spend to about $0.04 — at most 10 scraped places with every add-on off, which cannot exceed $0.10 by event pricing, so the place count was not reduced.

## Recorded result — October 24, 2026

- Run `Uhqy2vo2ejbjCdNSH`, build `0.14.775` (buildId `EH35UvIrsV0hnZG0Y`), dataset `OKApsozlq7yRHbP7v`: **SUCCEEDED** in 16.968s from local start to completion poll.
- Run-reported usage: **$0.04005** (not a settled invoice; matches 10 × $0.004 plus the $0.00005 start fee at the Free-plan rate).
- One search term `pottery studio` in `San Francisco, CA, USA`, language `en`: **10 places returned, 10 normalized, 10 usable, 0 closed.** All ten are categorized `Pottery classes` with ratings 4.4–5.0.
- Example places (all `priceLevel: unknown`):

| Place | Category | Rating | Reviews | Address |
| --- | --- | --- | --- | --- |
| Richmond Clay House | Pottery classes | 4.7 | 78 | 1017 Clement St, San Francisco |
| Dusted and Blue | Pottery classes | 4.9 | 19 | 1242 Mason St, San Francisco |
| Clayroom SoMa | Pottery classes | 4.7 | 58 | 375 9th St, San Francisco |
| Wheelhouse Clay Studio | Pottery classes | 4.7 | 54 | 2201 Sutter St, San Francisco |
| SMAart Gallery & Studio — Nob Hill | Pottery classes | 4.9 | 72 | 1045 Sutter St, San Francisco |

The remaining five (Brick and Mortar Studios, Mel Rice - STUDIO CERAMICA, Stone Gold Polk St, Studio Sumi, Stone Gold Fillmore St) are in the ignored `usable.json`. Two rows are two branches of the same business (Stone Gold) with different place IDs, so place-ID dedupe would not collapse them.

## What is missing

- **Price: `unknown` for all 10 places.** Google exposes price brackets mainly for restaurants and hotels; activity studios return none. This matters because contribution proposals require an observed price, currency, source URL and retrieval timestamp, and the project rules store the gap as `unknown` rather than guessing. A place row can therefore be an idea lead (name, category, address, rating, reviews count, website, Google Maps URL, retrievedAt) but not a priced gift without a separate price lookup — for example a human or companion step reading the studio's class-price page.
- No scheduling, availability, booking or session-length data; opening hours were not requested (no detail pages), and phone numbers were deliberately dropped from the normalized output.
- Relevance was high for this one term and city, but is unproven for other activity terms (for example climbing gyms) and other cities; a single run does not establish production reliability, and every further run costs money.

## Privacy

- Only an organizer-typed synthetic public city and one public activity phrase were sent — never a recipient's address, private imports or unpublished clues.
- Public business data only. Every personal-data add-on was disabled (reviews, reviewer identities, image authors, contact/lead/email enrichment, social profiles), and the normalized output keeps only the public business fields listed above plus `retrievedAt` and the run ID.
- The raw provider response stays in the gitignored local `work/research-spike/` directory; no fixture of this data is added to the repo.

## Gate / next steps

1. Treat results as room-visible experience ideas, not product listings; any price shown to users must come from a separate observed source with its own URL and timestamp.
2. No automatic fan-out to more terms or cities; each run costs money and needs its own budget decision.
3. Production integration would need a reviewed contract change (an activity/place observation type), job persistence, caching and membership checks in Convex, plus the team's OK. Nothing is wired into Convex today; this spike is undeployed and needs team approval before production.

## Follow-up: real prices from studio websites (2026-10-24)

Maps returns no class prices, so a second local spike (`scripts/apify-studio-prices-spike.mts`) reads each studio's **own public website** with `apify/website-content-crawler` (default build, run reported `0.3.101`) and keeps only literal dollar amounts that sit in the same sentence or line as an offer word (class, workshop, wheel, gift card, membership, private event). Fees, refunds, shipping, clay bags, scholarships and residency values are dropped. Every kept price carries its exact page URL, a short snippet and the retrieval time. Nothing is inferred; a studio with no visible price stays `unknown`.

```bash
node --env-file-if-exists=.env.local scripts/apify-studio-prices-spike.mts work/research-spike/places-<timestamp>
node --env-file-if-exists=.env.local scripts/apify-studio-prices-spike.mts --resume work/research-spike/studio-prices-<timestamp>
```

Bounded by depth 1 from each site root, 120 pages total, 1 GB x 180 s, robots.txt respected, no files/screenshots/HTML. Pages that never carry prices (careers, instructors, FAQs, policies, blog) are excluded so large sites do not use the whole budget.

Runs (run-reported usage, not a settled invoice; about $0.065 total):

| Run | Crawler | Pages | Usage | Result |
| --- | --- | --- | --- | --- |
| `MeopS1zGdedayt84W` | raw HTTP, 60 pages | 60 (partial) | $0.0126 | Found two false positives (a refund processing fee, a residency's included-value); two big sites used most of the page budget. Filters fixed. |
| `b0Z94dtyix2hbcahr` | browser (adaptive) | 8 in 300 s | $0.0390 | Far too slow for this; rejected. |
| `Xpvyd152AaI1fA5Kr` | raw HTTP, fixed filters | 87 (time limit) | $0.0133 | **4 of 9 studios priced**, all snippets verified against the page text. |

Verified prices from the final run:

- **SMAart Gallery & Studio**: $89 single 2-hour class (instruction, clay, glaze included); 4-week series $230 / Raku $260; 6-week $350 ([classinfo](https://www.smaartstudio.com/classinfo)).
- **Brick and Mortar Studios**: $95 one-time class, $375 six-week series, $275 membership, listed on their gift-certificates page ([source](https://www.brickandmortarstudios.com/gift-certificates)).
- **Mel Rice Studio Ceramica**: "One day - pottery wheel fun" $85–$90; 4-week wheel $225–$240. Some listed months (e.g. August) are past, so a date check is needed before quoting.
- **Wheelhouse Clay Studio**: group events $95/person (2-hour wheel) and $115/person (wheel + handbuilding) ([groupevents](https://www.wheelhouseclaysf.com/groupevents)). Individual class prices live in a booking widget and were not visible.

Unknown (5 of 9): Richmond Clay House and Stone Gold render only with JavaScript; Clayroom, Dusted and Blue and Studio Sumi show prices only inside booking widgets or not at all. These stay `unknown`; the honest fallback is a contributor typing a price with its link.

Verdict: **go as a local experience price source, with a manual fallback.** About half the studios publish a quotable price with a source link, which is enough for "pottery class at SMAart, $89, source" to become a real proposal amount. Not wired into Convex; production use needs the reviewed contract/job change and team OK. Prices are per person, USD, as listed; they say nothing about availability, tax or booking fees.
