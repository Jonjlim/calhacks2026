import { z } from "zod";

/**
 * Shared Zod schemas and input limits. Schemas here validate untrusted input
 * (user text, model output, provider payloads) before it reaches Convex writes.
 *
 * Owners add their schemas in this file:
 *   - Dev 3 (AI-001): AgentDecision, ExtractionResult, AgentQuery/AgentReply
 *   - Dev 4 (RC-001): ProductListing normalization
 */

export const LIMITS = {
  chatBodyMaxChars: 2_000,
  importRawTextMaxChars: 20_000,
  clueTextMaxChars: 280,
  excerptMaxChars: 280,
  displayNameMaxChars: 40,
  roomTitleMaxChars: 80,
} as const;

export const appErrorCodeSchema = z.enum([
  "unauthorized",
  "not_found",
  "invalid_revision",
  "infeasible",
  "stale_job",
  "provider_timeout",
  "validation_failed",
  "refused",
  "unknown",
]);

export const clueKindSchema = z.enum([
  "interest",
  "explicit_wish",
  "exclusion",
  "ownership",
  "timing",
  "uncertain",
]);

export const minorAmountSchema = z.number().int().nonnegative();

export const currencySchema = z.literal("USD");

/** Dev 4: outbound observations must be public HTTP(S) URLs, without credentials. */
export const publicHttpUrlSchema = z.string().trim().url().refine((value) => {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  const host = url.hostname.toLowerCase();
  return ["http:", "https:"].includes(url.protocol)
    && !url.username && !url.password
    && host.includes(".") && host !== "localhost"
    && !host.endsWith(".localhost") && !host.endsWith(".local")
    && !/^\d+\.\d+\.\d+\.\d+$/.test(host)
    && !host.includes(":");
}, "Expected a public HTTP(S) URL without credentials");

/** Stored listing fields before Convex assigns IDs/status; excludes all provider extras. */
export const normalizedListingSchema = z.object({
  source: z.literal("apify"),
  sourceUrl: publicHttpUrlSchema,
  title: z.string().trim().min(1),
  variant: z.string().trim().min(1).optional(),
  currency: currencySchema,
  priceMinor: minorAmountSchema.refine(Number.isSafeInteger).optional(),
  priceStatus: z.enum(["observed", "unknown"]),
  availability: z.enum(["in_stock", "limited", "unavailable", "unknown"]),
  shippingMinor: minorAmountSchema.refine(Number.isSafeInteger).optional(),
  shippingStatus: z.enum(["observed", "unresolved", "unknown"]),
  imageUrl: publicHttpUrlSchema.optional(),
  sellerName: z.string().trim().min(1).optional(),
  retrievedAt: z.number().int().positive().refine(Number.isSafeInteger),
}).strict().refine(
  (row) => (row.priceStatus === "observed") === (row.priceMinor !== undefined),
  "Observed price status requires an amount; unknown price must omit it",
).refine(
  (row) => (row.shippingStatus === "observed") === (row.shippingMinor !== undefined),
  "Observed shipping requires an amount; unknown/unresolved shipping must omit it",
);
