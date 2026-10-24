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
