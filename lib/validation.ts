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

export const questionSlotSchema = z.enum([
  "budget",
  "exclusions",
  "occasion",
  "already_owns",
  "size",
  "timing",
  "direction",
]);
const ref = z.string().min(1).max(200);
const shortText = z.string().trim().min(1).max(LIMITS.clueTextMaxChars);
export const PHOTO_PLACE_TYPES = [
  "home",
  "kitchen",
  "office",
  "cafe",
  "restaurant",
  "trail",
  "beach",
  "water",
  "gym",
  "studio",
  "garden",
  "city",
  "vehicle",
  "stage",
  "other",
] as const;
/** What the vision model may return for one photo. mediaIndex is attached by the server, never the model. */
export const photoReadingSchema = z.strictObject({
  recipientActivity: z.string().trim().min(1).max(60).optional(),
  placeType: z.enum(PHOTO_PLACE_TYPES).optional(),
  styleTerms: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  visibleItems: z
    .array(
      // A bare string is a label with no ownership claim.
      z.preprocess(
        (item) => (typeof item === "string" ? { label: item, owned: "unknown" } : item),
        z.strictObject({
          label: z.string().trim().min(1).max(60),
          owned: z.enum(["likely", "possible", "unknown"]),
        }),
      ),
    )
    .max(8)
    .optional(),
  notes: z.string().trim().min(1).max(200).optional(),
});
export const photoObservationSchema = photoReadingSchema.extend({
  mediaIndex: z.number().int().min(0).max(2),
});
export type PhotoReading = z.infer<typeof photoReadingSchema>;
export type PhotoObservation = z.infer<typeof photoObservationSchema>;
export const searchBriefSchema = z.strictObject({
  roomId: ref,
  knowledgeRevision: z.number().int().nonnegative(),
  queryTerms: z.array(shortText).min(1).max(6),
  mustExclude: z.array(shortText).max(100),
  budgetMinor: minorAmountSchema.optional(),
  occasion: z.string().max(200).optional(),
  listingLimit: z.number().int().min(1).max(12),
});
export const recipientQuestionTypeSchema = z.enum([
  "suitability",
  "ownership",
  "constraint",
]);
export const recipientCategorySchema = z.enum([
  "interest",
  "dislike",
  "ownership",
  "size",
  "constraint",
]);
export const recipientQuestionSchema = z.strictObject({
  type: recipientQuestionTypeSchema,
  subject: z.strictObject({
    kind: z.enum(["category", "product"]),
    label: shortText,
    listingId: ref.optional(),
  }),
});
export const agentQuerySchema = recipientQuestionSchema.extend({
  id: ref,
  roomId: ref,
  askedByJobId: ref,
});
export const agentReplySchema = z
  .strictObject({
    queryId: ref,
    status: z.enum(["answered", "unknown", "refused"]),
    suitability: z.enum(["yes", "no", "mixed"]).optional(),
    guidance: shortText.optional(),
    usedPreferenceIds: z.array(ref).max(30),
    policy: z.strictObject({
      allowed: z.boolean(),
      reason: shortText.optional(),
    }),
  })
  .refine(
    (reply) =>
      reply.status !== "answered" ||
      (reply.policy.allowed && reply.suitability !== undefined),
    "Answered replies require a permitted verdict",
  );
export const recipientVerdictSchema = z.strictObject({
  suitability: z.enum(["yes", "no", "mixed", "unknown"]),
  usedPreferenceIds: z.array(ref).max(30),
});
export const proposedCluePayloadSchema = z.strictObject({
  kind: clueKindSchema,
  text: shortText,
  confidence: z.number().min(0).max(1),
  sourceMessageIds: z.array(ref).min(1).max(30),
  speakerAssumption: z.enum(["recipient", "other", "unknown"]),
  contradictsClueIds: z.array(ref).max(30),
});
export const extractionResultSchema = z.strictObject({
  sourceId: ref,
  clues: z.array(proposedCluePayloadSchema).max(20),
});
const decisionBase = { rationale: shortText, needsFollowup: z.literal(false) };
export const agentDecisionSchema = z.discriminatedUnion("intent", [
  z.strictObject({ ...decisionBase, intent: z.literal("listen") }),
  z.strictObject({ ...decisionBase, intent: z.literal("wait") }),
  z.strictObject({
    ...decisionBase,
    intent: z.literal("clarify"),
    clarifySlot: questionSlotSchema,
    chatMessage: shortText,
  }),
  z.strictObject({
    ...decisionBase,
    intent: z.literal("search"),
    searchBrief: searchBriefSchema,
  }),
  z.strictObject({
    ...decisionBase,
    intent: z.literal("recommend"),
    chatMessage: shortText,
    citations: z.strictObject({
      listingIds: z.array(ref).min(1).max(12),
      publishedClueIds: z.array(ref).min(1).max(100),
    }),
  }),
  z.strictObject({
    ...decisionBase,
    intent: z.literal("query_recipient"),
    recipientQuery: recipientQuestionSchema,
  }),
]);
export type ModelDecision = z.infer<typeof agentDecisionSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export const recipientProfileUpdateSchema = z
  .strictObject({
    preferences: z
      .array(
        z.strictObject({
          category: recipientCategorySchema,
          text: shortText,
          disclosable: z.boolean(),
          authorized: z.boolean(),
        }),
      )
      .max(50),
    grants: z
      .array(
        z.strictObject({
          category: recipientCategorySchema,
          allowedQuestionTypes: z.array(recipientQuestionTypeSchema).max(3),
        }),
      )
      .max(5),
  })
  .refine(
    (x) => new Set(x.grants.map((g) => g.category)).size === x.grants.length,
    "Duplicate category grant",
  );
