/**
 * Convex validators for the enums in docs/CONTRACTS.md. Reuse these in
 * schema.ts and function args so the two never drift.
 */
import { v } from "convex/values";

export const currency = v.literal("USD");
export const agentCitations = v.object({
  listingIds: v.array(v.id("productListings")), publishedClueIds: v.array(v.id("publishedClues")), researchJobId: v.optional(v.id("researchJobs")),
});
export const agentTrigger = v.union(v.literal("human"), v.literal("research_completed"), v.literal("knowledge_changed"));
export const agentModelUsage = v.object({ calls: v.number(), reportedCalls: v.number(), inputTokens: v.number(), outputTokens: v.number(), cachedInputTokens: v.number(), reasoningTokens: v.number() });
export const recipientCategory = v.union(v.literal("interest"), v.literal("dislike"), v.literal("ownership"), v.literal("size"), v.literal("constraint"));
export const recipientQuestionType = v.union(v.literal("suitability"), v.literal("ownership"), v.literal("constraint"));

export const participantRole = v.union(v.literal("organizer"), v.literal("contributor"));

export const chatAuthorKind = v.union(v.literal("participant"), v.literal("buyer_agent"));

export const evidenceKind = v.union(
  v.literal("paste"),
  v.literal("text_export"),
  v.literal("photo"),
  v.literal("screenshot"),
);

/** Media sources only. The uploaded files are deleted once read. */
export const mediaStatus = v.union(
  v.literal("uploaded"),
  v.literal("read"),
  v.literal("failed"),
  v.literal("deleted"),
);

export const clueKind = v.union(
  v.literal("interest"),
  v.literal("explicit_wish"),
  v.literal("exclusion"),
  v.literal("ownership"),
  v.literal("timing"),
  v.literal("uncertain"),
);

export const speakerAssumption = v.union(
  v.literal("recipient"),
  v.literal("other"),
  v.literal("unknown"),
);

export const proposedClueStatus = v.union(
  v.literal("proposed"),
  v.literal("edited"),
  v.literal("rejected"),
  v.literal("published"),
  v.literal("source_withdrawn"),
);

export const clueSourceKind = v.union(
  v.literal("paste"),
  v.literal("import"),
  v.literal("chat"),
  v.literal("manual"),
  v.literal("photo"),
  v.literal("screenshot"),
);

export const publishedClueStatus = v.union(
  v.literal("active"),
  v.literal("withdrawn"),
  v.literal("source_withdrawn"),
);

export const agentIntent = v.union(
  v.literal("listen"),
  v.literal("clarify"),
  v.literal("extract"),
  v.literal("search"),
  v.literal("recommend"),
  v.literal("query_recipient"),
  v.literal("wait"),
  v.literal("reply"),
);

export const agentChatMode = v.union(v.literal("quiet"), v.literal("chatty"));

export const listingSource = v.union(
  v.literal("apify"),
  v.literal("shopping_api"),
  v.literal("manual_fixture"),
);

export const priceStatus = v.union(v.literal("observed"), v.literal("unknown"));

export const availability = v.union(
  v.literal("in_stock"),
  v.literal("limited"),
  v.literal("unavailable"),
  v.literal("unknown"),
);

export const shippingStatus = v.union(
  v.literal("observed"),
  v.literal("unresolved"),
  v.literal("unknown"),
);

export const listingStatus = v.union(
  v.literal("active"),
  v.literal("invalid"),
  v.literal("stale"),
);

export const budgetBand = v.union(
  v.literal("under_25"),
  v.literal("25_50"),
  v.literal("50_100"),
  v.literal("100_plus"),
  v.literal("unknown"),
);

export const selectionStatus = v.union(v.literal("active"), v.literal("cleared"));

export const allocationShare = v.object({
  participantId: v.id("participants"),
  amountMinor: v.number(),
});

export const proposalStatus = v.union(
  v.literal("draft"),
  v.literal("awaiting_approval"),
  v.literal("approved_pledged"),
  v.literal("infeasible"),
  v.literal("superseded"),
  // P1-B only:
  v.literal("authorizing"),
  v.literal("ready_to_capture"),
  v.literal("capturing"),
  v.literal("test_funded"),
  v.literal("blocked"),
  v.literal("recovery_pending"),
  v.literal("canceled"),
);

export const approvalStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("invalidated"),
  v.literal("withdrawn"),
);

export const voteValue = v.union(
  v.literal("up"),
  v.literal("down"),
  v.literal("flag_duplicate"),
);

export const jobStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("stale"),
  v.literal("canceled"),
  v.literal("uncertain"),
);

export const agentJobKind = v.union(
  v.literal("evaluate_thread"),
  v.literal("extract"),
  v.literal("recipient_query"),
);

export const askedSlotStatus = v.union(
  v.literal("open"),
  v.literal("answered"),
  v.literal("abandoned"),
);

export const searchBrief = v.object({
  knowledgeRevision: v.number(),
  queryTerms: v.array(v.string()),
  mustExclude: v.array(v.string()),
  budgetMinor: v.optional(v.number()),
  occasion: v.optional(v.string()),
  listingLimit: v.number(),
});
