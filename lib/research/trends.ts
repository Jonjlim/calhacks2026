/** RC-014 pure, local-only discovery. Production ranking remains unchanged. */
import { z } from "zod";
import type { TrendContext, TrendObservation } from "../contracts";

const phrase = z.string().trim().min(1).max(160).refine(value => !/[\u0000-\u001f]/.test(value));
const contextSchema = z.object({
  seedTerm: phrase, geo: z.literal("US"), timeRange: z.literal("today 3-m"),
  retrievedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const rowSchema = z.object({ searchTerm: phrase,
  relatedQueries_top: z.array(z.unknown()).optional(),
  relatedQueries_rising: z.array(z.unknown()).optional(),
});
const querySchema = z.object({ query: phrase, value: z.unknown().optional(), formattedValue: z.unknown().optional(), hasData: z.unknown().optional() });
const alternateSchema = z.object({ keyword: phrase, geo: z.literal("US"), timeRange: z.enum(["today 3-m", "Past 90 days"]),
  relatedSearches: z.object({ top: z.array(z.unknown()).optional(), rising: z.array(z.unknown()).optional() }),
});
const key = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const tokens = (text: string) => key(text).match(/[\p{L}\p{N}]+/gu) ?? [];

/** Invalid/mismatched observations are dropped, never repaired using guessed data. */
export function normalizeTrendDataset(raw: unknown, input: TrendContext): TrendObservation[] {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success || !Array.isArray(raw)) return [];
  const context = parsed.data;
  const url = new URL("https://trends.google.com/trends/explore");
  url.search = new URLSearchParams({ q: context.seedTerm, geo: context.geo, date: context.timeRange }).toString();
  const observations = new Map<string, TrendObservation>();
  for (const value of raw) {
    // Explicit adapter for the second candidate; never substitute context on a mismatch.
    const alternate = alternateSchema.safeParse(value);
    const page = rowSchema.safeParse(alternate.success ? {
      searchTerm: alternate.data.keyword, relatedQueries_top: alternate.data.relatedSearches.top,
      relatedQueries_rising: alternate.data.relatedSearches.rising,
    } : value);
    if (!page.success || key(page.data.searchTerm) !== key(context.seedTerm)) continue;
    for (const kind of ["top", "rising"] as const) {
      for (const item of page.data[kind === "top" ? "relatedQueries_top" : "relatedQueries_rising"] ?? []) {
        const query = querySchema.safeParse(item);
        if (!query.success || query.data.hasData === false) continue;
        const base = { ...context, source: "google_trends" as const, sourceUrl: url.href, query: query.data.query };
        const metric = query.data.value;
        let observation: TrendObservation;
        if (kind === "top") {
          if (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0 || metric > 100) continue;
          observation = { ...base, kind: "top_search", popularityIndex: metric };
        } else if (typeof query.data.formattedValue === "string" && key(query.data.formattedValue) === "breakout") {
          observation = { ...base, kind: "breakout_search" };
        } else {
          if (typeof metric !== "number" || !Number.isFinite(metric) || metric <= 0) continue;
          observation = { ...base, kind: "rising_search", growthPercent: metric };
        }
        // First occurrence wins. Do not amplify duplicates or combine unrelated metrics.
        const id = `${kind}:${key(observation.query)}`;
        if (!observations.has(id)) observations.set(id, observation);
      }
    }
  }
  return [...observations.values()];
}

const NON_SHOPPING = /\b(near me|class(?:es)?|lessons?|studios?|museums?|hours|locations?|places?|jobs?|salary|definition|meaning|names|how to|tutorials?|history|tickets?|restaurants?|customer service|discount code)\b/i;
// Same known category/brand collision as production ranking; no fuzzy brand guesses.
const withoutCategoryBrand = (text: string) => text.replace(/\bpottery\s*barn\b/gi, " ");

/** Suggestions for a future shopping search, not new preference facts or ranked products. */
export function discoverShoppingQueries(observations: TrendObservation[], limit = 8): Array<{
  query: string;
  evidence: TrendObservation[];
}> {
  const candidates = new Map<string, { query: string; evidence: TrendObservation[] }>();
  for (const observation of observations) {
    if (observation.kind === "top_search" && observation.popularityIndex <= 0) continue;
    const seedTokens = tokens(observation.seedTerm);
    const queryTokens = new Set(tokens(withoutCategoryBrand(observation.query)));
    if (!seedTokens.length || !seedTokens.every(token => queryTokens.has(token))
      || key(observation.query) === key(observation.seedTerm) || NON_SHOPPING.test(observation.query)) continue;
    const id = key(observation.query);
    const candidate = candidates.get(id) ?? { query: observation.query, evidence: [] };
    candidate.evidence.push(observation);
    candidates.set(id, candidate);
  }
  // Discovery order only: rising/breakout evidence first, then deterministic phrase order.
  return [...candidates.values()].sort((a, b) =>
    Number(b.evidence.some(item => item.kind !== "top_search")) - Number(a.evidence.some(item => item.kind !== "top_search"))
    || a.query.localeCompare(b.query)).slice(0, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 8);
}
