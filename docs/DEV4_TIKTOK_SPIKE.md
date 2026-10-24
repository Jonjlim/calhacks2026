# Dev 4 public fashion discovery spike

Status: **conditional go for local caption-based inspiration**, standalone only. Production reliability remains unverified. Original Actor: [Clockworks TikTok scraper](https://apify.com/clockworks/tiktok-scraper), pinned build `0.0.620` (timed out). Alternate: [GoFetch TikTok search scraper](https://apify.com/xmolodtsov/tiktok-search-scraper), build `0.1.39` (one successful run).

Test one public style query (`vintage denim outfit`), request 20 video search results with the past-month date filter, then independently check publication dates locally. Do not fetch any recipient's account, followers, comments, private data or media. No additional AI provider is used; initial garment discovery uses bounded caption/hashtag matching.

The Actor's metadata currently requires a minimum run charge limit of $0.50. That is a cap, not a quoted charge. Its documented result, date-filter and optional sorting fees may apply. Record reported usage separately from settled account billing. Persist a pending local report and run ID; never retry a paid start automatically. Resume polls the same run.

Recent posts can support “seen in these sampled posts,” not “growing across TikTok.” View counts are lifetime snapshots on those posts, not views gained during the sample window. Require more than one distinct known creator before presenting a recurring garment suggestion. Unknown or explicit ad signals must remain visible in observations; do not claim an organic or representative sample.

## Run and replay

```bash
# One bounded paid start; alternate has no provider-side date guarantee:
node --env-file-if-exists=.env.local scripts/apify-tiktok-spike.mts --alternate "vintage denim outfit"
# Continue polling the same run after interruption:
node --env-file-if-exists=.env.local scripts/apify-tiktok-spike.mts --resume work/research-spike/tiktok-TIMESTAMP
# Analyze the recorded sample with no network, token or new charges:
node scripts/tiktok-replay.mts work/research-spike/tiktok-TIMESTAMP
```

Server-only token comes from ignored `.env.local`. Raw provider responses/reports stay under ignored `work/research-spike/`; raw responses can contain default public author/media metadata, which is stripped from normalized observations and checked-in fixtures. No profile, comment, subtitle or media URLs are followed. Replay preserves original retrieval/window timestamps and writes separate `posts.json`, `discoveries.json` and `replay.json`.

The alternate Actor applies `DATE_POSTED` sorting to retrieved search hits rather than guaranteeing a recent complete sample. We enforce a fixed 30-day publication window independently. Although it accepts a location field, its documentation says this does not establish a per-country result set: region remains unknown. Zero engagement counts from this Actor are ambiguous defaults and are omitted by the adapter.

## Recorded results — October 24, 2026

- Clockworks run `EZ6ex944QJcbEdREd`: timed out at 180s, zero results. Logs showed repeated device-registration failures, not a completed search with no fashion matches. Reported usage $0.001; do not interpret the failure as evidence no relevant posts exist.
- Alternate run `4L8Jxjsie44FQmDf7`: `vintage denim outfit`, 11.322s, 19 results. Six posts from six creators were published in the requested 30-day window; 13 were older and excluded. A single provider-reported usage snapshot was zero; no claim of free or settled billing.
- Three recent posts explicitly mentioned loose jeans/loose-fit denim/loose-leg denim. Result: one `vintage loose fit jeans` candidate, labeled **Mentioned in 3 sampled recent posts**. All advertising statuses were unknown, not verified organic. Source links are retained in the replay and fixture. The hoped-for three garment discoveries were **not** established by this sample.
- Existing shopping Actor run `Ls3NBfPgxENwdXbXp`, query `vintage loose fit jeans`, build `0.0.142`: 32.583s, 40 linked results with numeric prices and images. Reported usage $0.04002, not a settled invoice. Normalization retains USD observations; stock, shipping, available sizes and final totals remain unknown. Source links are Google discovery links, not verified checkout URLs.
- Shopping results include new vintage-style clothing, mixed departments and various fits. The query does not authenticate garment age, establish recipient sizing or prove every returned product matches the style. No item gets a “viral” badge merely because it appeared in search.

## Implementation and limits

`FashionSampleContext`, `TikTokFashionPost` and `FashionDiscovery` are additive local-only contracts. `lib/research/tiktok.ts` validates dates/URLs/counters, rejects private-account flags, deduplicates post IDs, drops conflicting copies regardless of input order, strips unrelated metadata and separates ad flags from unknown status. Caption/hashtag patterns identify a bounded English denim vocabulary; no model or image recognition is involved.

This lexical approach misses garments only visible in a video, combined hashtags outside its patterns, other languages and subtle descriptions. Caption mentions do not establish endorsement or accurately measure total popularity. A `vintage` word match is not proof the garment is genuinely old. Suggestions are source-backed shopping directions for review, not new recipient preferences or ownership facts. Existing production ranking and `trendSignal` are unchanged.

Fixtures `lib/research/fixtures/tiktok-fashion.json` and `tiktok-shopping.json` are small real public subsets with run/build/query/time provenance. The fashion subset contains three supporting recent posts, a vague recent caption and an older post. It is not the full 19-post sample. Tests are offline and include intentionally synthetic edge cases separately.

## Remaining Dev 4 work

1. **Product/category relevance:** fix the established ranking gap for valid hobby/style items whose titles omit the clue terms. Use verified listing facts; seller or query association alone is insufficient. Add budget/ownership regressions.
2. **RC-014 production integration:** after review, add bounded jobs/cache/provenance and a source-backed discovery view. Use current published preferences only; social text remains untrusted context. Do not turn sample counts into growth or product popularity scores. Coordinate schema/job changes with Dev 2 and source-card UI with Dev 1.
3. **RC-017 photo integration:** existing confirmed-style matching/tests are present, but exercise actual AI-018 published outputs once Alan's photo pipeline is ready. Uncertain observations stay out of research; photos never establish ownership automatically in Dev 4 code.
4. **Research acceptance with Dev 1:** verify actual images/placeholders, price freshness labels, unknown price/stock states, ownership filtering, invalid-listing selection clearing, and failed/stale job states in the wired room. Deployment is outside this local experiment.
5. **Demo preparation:** warm the chosen queries, keep recorded fallbacks honestly labeled, and rehearse one recipient story. Our text-research core is implemented; these experiments are not yet live features. RC-009 remains a proposed no-pay demo decision awaiting team confirmation; RC-010–013 are optional paired payment work, not silently added scope.

Duplicate evidence follow-up: conflicting valid copies (including a disagreement on advertising status) are omitted during normalization and again at the discovery boundary. Counter-only updates do not change caption evidence. Regression tests cover both duplicate orders; this remains a local experiment, not a deployed discovery feature.
