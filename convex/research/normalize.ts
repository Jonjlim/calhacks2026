/**
 * Verified johnvc Google Shopping payload → shared ProductListing fields.
 * Owner: Dev 4 (RC-001, RC-003). No network calls or database writes.
 */
import { z } from "zod";
import type { ProductListing } from "../../lib/contracts";
import { parseMajorToMinor } from "../../lib/money";
import { normalizedListingSchema, publicHttpUrlSchema } from "../../lib/validation";

export type NormalizedListing = Omit<ProductListing, "id" | "roomId" | "jobId" | "status">;

const productSchema = z.object({
  title: z.string().trim().min(1),
  product_link: publicHttpUrlSchema,
  product_id: z.unknown().optional(),
  currency: z.unknown().optional(),
  price: z.unknown().optional(),
  extracted_price: z.unknown().optional(),
  thumbnail: z.unknown().optional(),
  source: z.unknown().optional(),
});
const pageSchema = z.object({
  search_parameters: z.object({ gl: z.literal("us") }),
  shopping_results: z.array(z.unknown()),
});

/** Accept exact decimal observations only, never ranges, monthly payments or "from". */
function observedMinor(price: unknown, numeric: unknown): number | null {
  const numericMinor = typeof numeric === "number" && Number.isFinite(numeric)
    ? parseMajorToMinor(String(numeric)) : null;
  if (price === undefined || price === null || price === "") return numericMinor;
  if (typeof price !== "string") return null;
  const amount = /^(?:US\$|USD\s*|\$)?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*USD)?$/i.exec(price.trim());
  if (!amount?.[1]) return null;
  const formattedMinor = parseMajorToMinor(amount[1].replaceAll(",", ""));
  if (formattedMinor === null) return null;
  // Conflicting or invalid numeric observations must not silently override displayed prices.
  if (numeric !== undefined && numeric !== null && numericMinor !== formattedMinor) return null;
  return formattedMinor;
}

export function normalizeListing(
  raw: unknown,
  retrievedAt: number,
  context?: { country: "us" },
): NormalizedListing | null {
  if (!Number.isSafeInteger(retrievedAt) || retrievedAt <= 0) return null;
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  // A bare "$" or number does not establish currency without trusted US query context.
  const explicitCurrency = typeof row.currency === "string" ? row.currency.trim().toUpperCase() : undefined;
  if (row.currency !== undefined && explicitCurrency !== "USD") return null;
  const priceText = typeof row.price === "string" ? row.price.trim() : "";
  if (/(?:€|£|¥|₹|₩|CAD|AUD|NZD|EUR|GBP|JPY|CNY|INR|CHF|HKD|SGD|MXN|BRL|C\$|CA\$|A\$|AU\$)/i.test(priceText)) return null;
  const hasUsdLabel = /^(?:US\$|USD\b)/i.test(priceText) || /\bUSD$/i.test(priceText);
  if (explicitCurrency !== "USD" && !hasUsdLabel && context?.country !== "us") return null;

  const priceMinor = observedMinor(row.price, row.extracted_price);
  const image = publicHttpUrlSchema.safeParse(row.thumbnail);
  const sellerName = typeof row.source === "string" ? row.source.trim() : "";
  const candidate = {
    source: "apify",
    sourceUrl: row.product_link,
    title: row.title, // Keep pack counts, sizes and variant wording exactly as observed.
    currency: "USD",
    ...(priceMinor === null ? {} : { priceMinor }),
    priceStatus: priceMinor === null ? "unknown" : "observed",
    availability: "unknown",
    shippingStatus: "unknown",
    ...(image.success ? { imageUrl: image.data } : {}),
    ...(sellerName ? { sellerName } : {}),
    retrievedAt,
  };
  const validated = normalizedListingSchema.safeParse(candidate);
  return validated.success ? validated.data : null;
}

/**
 * Use the actual dataset envelope to establish US localization.
 * Invalid rows/pages are dropped independently; input shape errors yield no listings.
 * Dedupe within this observation only; do not merge sellers or historical observations.
 */
export function normalizeDataset(raw: unknown, retrievedAt: number): NormalizedListing[] {
  if (!Array.isArray(raw)) return [];
  const listings: NormalizedListing[] = [];
  const seen = new Set<string>();
  for (const page of raw) {
    const parsed = pageSchema.safeParse(page);
    if (!parsed.success) continue;
    for (const product of parsed.data.shopping_results) {
      const listing = normalizeListing(product, retrievedAt, { country: "us" });
      if (!listing) continue;
      const row = productSchema.parse(product);
      const productId = typeof row.product_id === "string" && row.product_id.trim()
        ? row.product_id.trim() : listing.sourceUrl;
      const key = JSON.stringify([productId, listing.sellerName ?? "", listing.title]);
      if (seen.has(key)) continue;
      seen.add(key);
      listings.push(listing);
    }
  }
  return listings;
}
