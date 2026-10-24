# Reviewed product/category matching

Dev 4. Implemented on the research read path; no deployment performed by this change.

## Problem and behavior

The recorded `mkm pottery tools` search returned an MKM sticker, named pottery tools, and SKU-based titles such as **BHR-051 Big Hand Roller – Zig Zag Spiral** and **DD-10 MKM Decorating Disk - 10 inch (25.4 cm) diameter**. Neither of those two tool titles says pottery, so literal ranking gave both zero hobby relevance. The shopping payload supplies no category or description. Its seller and search query are not sufficient product evidence: the same merchant sells the sticker.

`convex/research/catalogEvidence.ts` now contains **two reviewed model records**. Exact complete normalized titles identify them; case, punctuation and model-code spacing can vary. Unknown variants, truncated names, other model codes, appended merchandise/accessory names and unknown stamps remain unmatched. This is intentionally a small reviewed catalog, not broad automatic classification or an AI-generated taxonomy.

The records add only manufacturer/category/tool terms, never price, availability, shipping, genuine-vintage status, garment size or popularity. Existing literal matching handles the rest of the catalog.

## Sources reviewed October 24, 2026

- [MKM BHR-051](https://mkmpotterytools.com/product/bhr-051-big-handroller-zig-zag-spiral/): the manufacturer identifies the SKU and describes rolling its patterns into clay and thrown pots.
- [MKM DD-10](https://mkmpotterytools.com/product/dd-10-mkm-decorating-disk-10-inch-25-4-cm-diameter/): the manufacturer identifies the model and describes dividing/marking plates, jars and bowls during pottery work.

These are identity/category observations, not authentication of the third-party seller or verification that every offered listing is the genuine item. No merchant requests occur in application code. New model records require independent source review and a regression test; never generate them from an LLM assertion or the search term alone.

## Ranking and exclusions

The existing ranker combines literal title/variant tokens with reviewed terms for positive preferences. Same thresholds, clue weights, repeated-preference deduplication and budget arithmetic apply. A reviewed tool counts as hands-on in the existing tie-break; it receives no extra numeric bonus. When reviewed terms affect a match, the explanation includes the manufacturer basis, checked date and source URL. The current public recommendation shape stays unchanged.

Ownership remains literal: owning a starter kit does not hide separate tools, and broad ownership of “pottery tools” is not evidence of owning every named model. An exact named-item ownership clue still hides that title.

Explicit exclusions can use verified manufacturer/category terms as well as literal text. Otherwise “No more pottery” would fail to hide these now-recognized pottery tools. Bare “No MKM” is also recognized as an exclusion framing. Withdrawn/tentative constraints are still ignored. This is the deliberate extension to the prior literal-only exclusion rule, documented for the next team integration checkpoint.

No product listing, schema, money, permission, source adapter or agent files change. Dev 1 receives the explanatory text through the existing query. Dev 3's catalog reads inherit the matching through the same ranker. Dev 2 needs no migration; all consumers should review the matching/exclusion behavior before merging.

## Validation

- Recorded-source regression: both known tools cite the pottery clue and a manufacturer source; the MKM sticker and unreviewed stamp receive no new relevance.
- Unknown variants/codes/accessories/truncated names do not inherit catalog facts; typography alone can vary.
- Preference wishes are not invented: a pottery wheel, starter kit or vintage-denim preference does not become a match for these tools.
- Unknown price stays unknown; over-budget/observed shipping still affect ordering; unavailable/invalid items stay excluded.
- Exact ownership, starter-kit ownership, category/manufacturer exclusions, withdrawn/tentative clues, deterministic ties and trend=0 remain covered.
- Convex test: an authenticated room reads the new evidence through `listRecommendations`, then publishing “No more pottery” removes both known tools immediately without creating a second research job or calling a provider.

## What remains

This fixes the two verified misses from the recorded source, not arbitrary unseen items or clothing semantics. Broader automatic classification needs a source-backed product-details/category path, coordinated with Alan's gift planning and the team contracts. Social discovery remains a local experiment; neither TikTok counts nor search growth become per-product scores. The existing photo-clue integration and browser/demo verification work remain separate.
