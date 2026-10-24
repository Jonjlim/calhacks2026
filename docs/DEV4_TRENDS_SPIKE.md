# Dev 4 trend discovery experiment (RC-014)

Status: **conditional go for local category discovery** using the alternate Actor. Local experiment only; no deployment, database schema, ranking, or production provider changes. Production reliability remains unverified.

Candidates: [Apify-maintained scraper](https://apify.com/apify/google-trends-scraper), build `0.0.141` (timed out), and [Agenscrape scraper](https://apify.com/agenscrape/google-trends-scraper), build `1.0.21` (two successful tests). Use one public category, US, past three months. Related top searches are contextual search interest, not sales or product endorsements. Rising queries compare search growth with the preceding period. “Breakout” is a provider category, not an exact measured percentage. [Google definitions](https://support.google.com/trends/answer/4355000?hl=en).

## Run

```bash
node --env-file-if-exists=.env.local scripts/apify-trends-spike.mts --alternate "pottery tools"
# To poll the same run after interruption (no new paid start):
node --env-file-if-exists=.env.local scripts/apify-trends-spike.mts --resume work/research-spike/trends-TIMESTAMP
# Re-evaluate a saved response without any network or token:
node scripts/trends-replay.mts work/research-spike/trends-TIMESTAMP
```

Reads server-only `APIFY_TOKEN` from ignored `.env.local`. Saves a pending report before the paid request, followed by run ID, build, status, timestamps and raw dataset under ignored `work/research-spike/`. Requests a $0.20 Actor charge cap and 180-second server timeout; platform/proxy costs may be billed separately. Never retries POST. Inspect Console if a start times out without an ID. Reported usage is not a settled invoice.

Omit `--alternate` only to intentionally retest the slow original candidate. No automatic fallback or extra paid product search happens. Successful attempts also write `observations.json` and `discoveries.json`. A replay preserves the original retrieval timestamp and writes a separate `replay.json`; it does not make old evidence fresh.

## Gate

1. At least one real related query with clear source, geographic context and observation window.
2. Gift discovery candidates retain a literal category anchor and reject obvious local-service queries. This is a conservative lexical screen, not proof of gift suitability.
3. Candidate terms can feed our existing product search, but ownership/exclusion and budget checks still apply. No automatic paid fan-out or score changes in this experiment.
4. Keep only a minimal reviewed public fixture; tests never call Apify.

No raw conversations, photos, names or private clues are sent. Only public category phrases entered for this script are sent. Production job persistence, membership/consent checks, caching and reviewed ranking integration remain separate work.

## Recorded results — October 24, 2026

- Original Actor, `pottery`: run `xDctsTesRRtd86Efb`, timed out at 180s with zero completed pages. Log showed the related-query widget selector timing out. Run-reported platform usage: approximately $0.0253. Do not use this configuration interactively.
- Alternate Actor, `pottery`: run `fcmDezvjUt1peukFk`, 13.576s from local start to completion poll, 50 normalized related-query observations. Most rising queries concerned Pottery Barn. `Past 90 days` is its output label for requested `today 3-m`; the parser now explicitly accepts that label. Initial inspection rejected this unexpected label; offline replay recovered observations without another paid start. Run-reported usage: $0.025.
- Alternate Actor, `pottery tools`: run `zZmkrDtyr3159Dyj9`, 11.926s, 12 observations. After informational-query filtering, four candidate phrases: `dirty girls pottery tools`, `mkm pottery tools`, `pottery tools and supplies`, `xiem pottery tools`. MKM's related-search growth was reported as +300%, Dirty Girls +150%. These are term-level search trends, not SKU sales. Run-reported usage: $0.025.
- Manual handoff to existing shopping script, `mkm pottery tools`: run `1GPbd4koX44ifV9M9`, build `0.0.142`, 11.426s, 40 linked products with numeric prices and images. Run-reported usage: $0.04001. Raw observations remain ignored locally. No Convex calls occurred.
- One concrete result, **BHR-051 Big Hand Roller – Zig Zag Spiral**, was observed at $20.95. Its [manufacturer page](https://mkmpotterytools.com/product/bhr-051-big-handroller-zig-zag-spiral/) independently displayed the same price. This corroborates one product, not every listing, stock, shipping, tax or checkout total. Shopping links remain Google discovery links.

## Quality findings and next integration boundary

Broad categories can produce brand collisions. The candidate gate ignores the known Pottery Barn phrase before checking category tokens and rejects local/informational phrases. It deliberately requires every literal seed word, so it misses synonyms and some experience gifts. Suggestions still need review; lexical matching is not a gift-suitability model.

The shopping source returned **MKM Sticker** first and several listings from other brands. Query association alone must never become a per-product “trending” badge. Specific MKM tool titles also omit the word pottery; the existing title-based ranker correctly does not invent a personal clue match for them. Before production integration, design evidence-backed product/category matching that handles those cases without blindly trusting seller names or search position.

Follow-up: [reviewed catalog matching](DEV4_CATALOG_MATCHING.md) now supplies manufacturer-backed terms for two exact known model identities (BHR-051 and DD-10), fixing their recorded misses. Unreviewed titles remain literal-only. This does not turn the original trend observation into an item popularity score.

The useful demo is **published pottery interest → category discovery → sourced MKM query → observed tools**, while existing ownership, exclusions and money rules remain intact. The experiment demonstrates retrieval feasibility; it does not establish better end-to-end ranking yet.

## Fixtures and validation

- `lib/research/fixtures/google-trends.json`: minimal actual public query/metric samples, including negative Pottery Barn/local queries, with actor/build/run and original retrieval context.
- `lib/research/fixtures/trend-shopping.json`: five actual public products from the handoff, including the sticker, roller and an unrelated-brand result. Retains titles/prices/images/source links; excludes opaque helper payloads.
- `lib/research/trends.test.ts`: provenance/metric validation, exact alternate-window mapping, malformed payloads, duplicates, category matching and recorded-source regression.
- `convex/research/trend-discovery.test.ts`: recorded handoff through the existing normalizer/ranker; ownership exclusions remain active, term trends do not silently become product scores, and missing title evidence stays a documented limitation.

No new dependencies. Contracts were documented before adding exported types. Consumers outside the local experiment need no migration.
