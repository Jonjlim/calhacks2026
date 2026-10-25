/** Fixed public-style Apify source. No recipient/account/profile queries. */
import type { ProviderResult } from "./provider";
import { createApifyRunClient, type ApifyRun } from "./apifyRun";
import { STYLE_SEED_TERMS } from "../../lib/research/styleCategories";

export const FASHION_ACTOR = "xmolodtsov~tiktok-search-scraper";
export const FASHION_BUILD = "0.1.39";
export const FASHION_DEADLINE_MS = 210_000;
export type FashionRun = ApifyRun;

export function createFashionProvider(token: string, fetcher: typeof fetch = fetch) {
  const client = createApifyRunClient(token, "Fashion source", fetcher);
  return {
    start(seedTerm: string): Promise<ProviderResult<FashionRun>> {
      if (!STYLE_SEED_TERMS.has(seedTerm)) return Promise.resolve({ kind: "failed", message: "Only reviewed public style searches are enabled." });
      return client.startRun(`acts/${FASHION_ACTOR}/runs?build=${FASHION_BUILD}&timeout=180&memory=1024&maxTotalChargeUsd=0.50`, {
        keywords: [seedTerm], maxItems: 20, maxItemsPerKeyword: 20, sortType: "DATE_POSTED",
        uniqueAuthors: true, expansion: [], commentsPerPost: 0, includeAuthorProfile: false,
      });
    },
    /**
     * TikTok inspiration for one trend cloud (D23 trial). `query` must already be a sourced,
     * screened Google Trends suggestion; the caller checks that. Same actor and cap, fewer posts.
     */
    startInspiration(query: string): Promise<ProviderResult<FashionRun>> {
      return client.startRun(`acts/${FASHION_ACTOR}/runs?build=${FASHION_BUILD}&timeout=180&memory=1024&maxTotalChargeUsd=0.50`, {
        keywords: [query], maxItems: 12, maxItemsPerKeyword: 12, sortType: "DATE_POSTED",
        uniqueAuthors: true, expansion: [], commentsPerPost: 0, includeAuthorProfile: false,
      });
    },
    getRun: (id: string) => client.getRun(id),
    getDataset: (id: string) => client.getDataset(id, 20),
  };
}
