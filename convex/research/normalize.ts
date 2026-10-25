/**
 * Google Shopping payloads → shared ProductListing fields (recorded and documented shapes).
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
 * automation-lab Google Shopping row (D24): one product per dataset item, with
 * the store's own link. Only an exact USD amount that agrees with the shown
 * price counts as observed; ranges, "from", other currencies and missing links
 * make the price unknown or drop the row, exactly as for the earlier source.
 */
const shoppingRowSchema = z.object({
  title: z.string().trim().min(1),
  productUrl: publicHttpUrlSchema,
  price: z.unknown().optional(),
  priceNumeric: z.unknown().optional(),
  currency: z.unknown().optional(),
  merchant: z.unknown().optional(),
  imageUrl: z.unknown().optional(),
});

export function normalizeShoppingRow(raw: unknown, retrievedAt: number): NormalizedListing | null {
  if (!Number.isSafeInteger(retrievedAt) || retrievedAt <= 0) return null;
  const parsed = shoppingRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  // The row must say USD; a bare "$" alone is not trusted to mean US dollars.
  if (typeof row.currency !== "string" || row.currency.trim().toUpperCase() !== "USD") return null;
  const priceMinor = observedMinor(row.price, row.priceNumeric);
  const image = publicHttpUrlSchema.safeParse(row.imageUrl);
  const sellerName = typeof row.merchant === "string" ? row.merchant.trim() : "";
  const candidate = {
    source: "apify",
    sourceUrl: row.productUrl,
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

/** D25: keep the Google product URL paired with its observed card price/store.
 * A separately resolved store offer may differ and must not borrow this price.
 */
export function normalizeScrapewiseRow(raw: unknown, retrievedAt: number): NormalizedListing | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (row.errorCode !== undefined && row.errorCode !== null && row.errorCode !== "") return null;
  if (row.country !== "us") return null;
  return normalizeShoppingRow({
    title: row.title, productUrl: row.productUrl, currency: row.currency,
    price: row.priceText, priceNumeric: row.price, merchant: row.store, imageUrl: row.imageUrl,
  }, retrievedAt);
}

/**
 * Text a source returned instead of products, such as a usage-limit notice, so a
 * search that found nothing can say why. Never a product or price fact.
 */
export function providerNotice(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    for (const value of Object.values(item as Record<string, unknown>)) {
      if (typeof value === "string" && /allowance|limit|upgrade|quota|blocked|captcha/i.test(value)) {
        return value.replace(/\s+/g, " ").trim().slice(0, 160);
      }
    }
  }
  // A successful Actor status is not proof of usable product data. The live
  // automation-lab response contained titles/prices but empty links on every row.
  const products = raw.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === "object" && "productUrl" in item && "title" in item &&
    typeof item.title === "string" && item.title.trim().length > 0);
  if (products.length && products.every(item => !publicHttpUrlSchema.safeParse(item.productUrl).success)) {
    return `Returned ${products.length} products without usable product links. Check the shopping actor before retrying.`;
  }
  return null;
}

/**
 * Use the actual dataset envelope to establish US localization.
 * Invalid rows/pages are dropped independently; input shape errors yield no listings.
 * Dedupe within this observation only; do not merge sellers or historical observations.
 * Reads both the current source's product rows (D24) and the earlier SerpApi-style pages,
 * so recorded fixtures and stored observations keep working.
 */
export function normalizeDataset(raw: unknown, retrievedAt: number): NormalizedListing[] {
  if (!Array.isArray(raw)) return [];
  if (!raw.some((item) => pageSchema.safeParse(item).success)) {
    const rows: NormalizedListing[] = [];
    const seenRows = new Set<string>();
    for (const item of raw) {
      const isScrapewise = !!item && typeof item === "object" && ("priceText" in item || "searchQuery" in item || "store" in item);
      const listing = isScrapewise ? normalizeScrapewiseRow(item, retrievedAt) : normalizeShoppingRow(item, retrievedAt);
      if (!listing) continue;
      const key = JSON.stringify([listing.sourceUrl, listing.sellerName ?? "", listing.title]);
      if (seenRows.has(key)) continue;
      seenRows.add(key);
      rows.push(listing);
    }
    return rows;
  }
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
