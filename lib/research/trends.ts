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

// News, events coverage and lookups: these are things people read about, not things you can give.
const NEWS_OR_INFO = /\b(deaths?|died|dies|dead|killed|kills?|fatal|accidents?|crash(?:es)?|injur(?:y|ies|ed)|missing|murder|shooting|attacks?|arrest(?:ed)?|lawsuit|recall(?:ed)?|scandal|news|today|tonight|yesterday|live|stream(?:ing)?|scores?|results?|schedule|standings|rankings?|bracket|draw|odds|predictions?|highlights|vs|weather|forecast|election|wiki(?:pedia)?|net worth|age|wife|husband|girlfriend|boyfriend|height|reddit|memes?|quiz|wordle|channel|tv|app|login|how to|what is|why|when|who|where|definition|meaning|history|jobs?|salary|hours|customer service|discount codes?|coupons?|promo codes?|near me|rules|winners?|names|types of|list of|facts|champions?|tournaments?|matches|season|draft|trade|injury report)\b/i;

// Something you can buy, wear, or book. A related search must name one to become an idea.
const PRODUCT = /\b(gifts?|ideas|kits?|sets?|tools?|gear|equipment|accessor(?:y|ies)|supplies|bags?|backpacks?|totes?|cases?|covers?|shoes|sneakers|boots|socks|shirts?|tees?|t shirts?|hoodies?|sweaters?|sweatshirts?|jackets?|coats?|dress(?:es)?|skirts?|shorts|pants|jeans|leggings|hats?|caps?|visors?|headbands?|wristbands?|jewelry|necklaces?|rings?|earrings|bracelets?|watch(?:es)?|sunglasses|glasses|bottles?|mugs?|cups?|tumblers?|bowls?|whisks?|powder|tea|blend|kettle|grinder|machine|maker|press|beans|books?|journals?|posters?|prints?|art|decor|lamps?|candles?|blankets?|pillows?|towels?|mats?|rackets?|racquets?|balls?|paddles?|grips?|strings?|nets?|clubs?|poles?|tents?|stoves?|records?|vinyls?|turntables?|speakers?|headphones?|cameras?|lens(?:es)?|film|puzzles?|games|cards|stickers?|pins?|patches?|figures?|plush(?:ies)?|toys?|bundle|box|subscription|merch|collection|edition|glazes?|clay|yarn|wool|fabric|beads|paints?|brush(?:es)?|pens?|markers?|ink|paper|wheel|kiln|seeds?|planters?|pots?)\b/i;
const STYLE = /\b(outfits?|aesthetic|style|looks?|fits?|core|fashion|wear|apparel|clothing|clothes|vintage|retro|y2k|streetwear|preppy|minimalist?)\b/i;
const EXPERIENCE = /\b(tickets?|class(?:es)?|lessons?|workshops?|camps?|clinics?|tours?|retreats?|experiences?|memberships?|passes|concerts?|festivals?|shows?|tastings?|ceremony|sessions?)\b/i;

/** A related search is worth showing only if it names a product, a style, or a bookable experience, and is not news or a lookup. */
export function isGiftShapedQuery(query: string): boolean {
  if (NEWS_OR_INFO.test(query)) return false;
  // Years usually mean news or schedules unless someone is buying a ticket.
  if (/\b(?:19|20)\d{2}\b/.test(query) && !EXPERIENCE.test(query)) return false;
  return PRODUCT.test(query) || STYLE.test(query) || EXPERIENCE.test(query);
}
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
      || key(observation.query) === key(observation.seedTerm) || !isGiftShapedQuery(observation.query)) continue;
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
