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
