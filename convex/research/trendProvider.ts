/** Google Trends related searches via Apify. Public category phrases only. */
import type { ProviderResult } from "./provider";
import { createApifyRunClient, type ApifyRun } from "./apifyRun";
import { isSafeTrendSeed } from "./trendPolicy";

export const TREND_ACTOR = "agenscrape~google-trends-scraper";
export const TREND_BUILD = "1.0.21";
export const TREND_DEADLINE_MS = 210_000;
export const TREND_GEO = "US" as const;
export const TREND_TIME_RANGE = "today 3-m" as const;
export const TREND_MAX_ROWS = 10;

export function createTrendProvider(token: string, fetcher: typeof fetch = fetch) {
  const client = createApifyRunClient(token, "Trend source", fetcher);
  return {
    start(seedTerm: string): Promise<ProviderResult<ApifyRun>> {
      if (!isSafeTrendSeed(seedTerm)) return Promise.resolve({ kind: "failed", message: "Only short public category phrases can be trend-searched." });
      return client.startRun(`acts/${TREND_ACTOR}/runs?build=${TREND_BUILD}&timeout=180&memory=1024&maxTotalChargeUsd=0.20`, {
        keywords: [seedTerm], geo: TREND_GEO, timeRange: TREND_TIME_RANGE, category: 0,
        includeRelatedSearches: true, includeRelatedTopics: false, useBrowserForTopics: false,
        includeGeoData: false, includeInterestOverTime: false,
      });
    },
    getRun: (id: string) => client.getRun(id),
    getDataset: (id: string) => client.getDataset(id, TREND_MAX_ROWS),
  };
}
