/**
 * Agent collaborator tables (Gift Twin first). Additive; included by
 * convex/schema.ts. See CONTRACTS.md § Agent collaborators.
 *
 * Privacy classes:
 *   public_room:  agentCollaborators (projected by collaboratorView: no
 *                 hashes, upload ids, or checked refs), agentCollaboratorPosts.
 *   server-only:  pairingCodeHash, deviceTokenHash, vaultUploadId,
 *                 checkedIdeaRefs, and every twinVaultChunks row.
 * twinVaultChunks hold raw messages the recipient sent, uploaded with their
 * one-time consent. No public query or device query returns them; only the
 * twin agent's internal functions read them. Deleted at vaultExpiresAt, on
 * forget, on disconnect, and on room purge.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const agentCollaboratorKind = v.union(v.literal("gift_twin"), v.literal("trend_scout"));
export const agentCollaboratorStatus = v.union(v.literal("pending_pairing"), v.literal("active"), v.literal("revoked"));
export const twinInsightCategory = v.union(
  v.literal("interest"), v.literal("wish"), v.literal("dislike"), v.literal("owns"), v.literal("style"),
);
export const twinConfidence = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));
export const twinVote = v.union(v.literal("up"), v.literal("down"));
export const agentPostKind = v.union(v.literal("insight"), v.literal("vote"));
export const agentPostStatus = v.union(v.literal("suggested"), v.literal("added"), v.literal("noted"), v.literal("dismissed"));
export const twinVaultStatus = v.union(v.literal("uploading"), v.literal("processing"), v.literal("ready"), v.literal("expired"));
export const vaultMessage = v.object({ text: v.string(), sentAt: v.number() });

export const giftTwinTables = {
  agentCollaborators: defineTable({
    roomId: v.id("rooms"),
    kind: agentCollaboratorKind,
    displayName: v.string(),
    status: agentCollaboratorStatus,
    createdBy: v.id("participants"),
    pairingCodeHash: v.optional(v.string()),
    pairingExpiresAt: v.optional(v.number()),
    deviceTokenHash: v.optional(v.string()),
    deviceLabel: v.optional(v.string()),
    pairedAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    /** When the recipient granted the one-time message upload. */
    consentedAt: v.optional(v.number()),
    /** Current upload; agent runs and scheduled expiry for an older upload see a mismatch and stop. */
    vaultUploadId: v.optional(v.string()),
    vaultStatus: v.optional(twinVaultStatus),
    vaultMessageCount: v.optional(v.number()),
    vaultChars: v.optional(v.number()),
    vaultExpiresAt: v.optional(v.number()),
    /** Room idea refs the twin already looked at, so the watch loop votes on each idea once. */
    checkedIdeaRefs: v.optional(v.array(v.string())),
    /** When the twin agent finished its first pass. */
    reportedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_pairing_code", ["pairingCodeHash"])
    .index("by_device_token", ["deviceTokenHash"]),

  agentCollaboratorPosts: defineTable({
    roomId: v.id("rooms"),
    collaboratorId: v.id("agentCollaborators"),
    kind: agentPostKind,
    category: v.optional(twinInsightCategory),
    text: v.string(),
    confidence: twinConfidence,
    evidenceCount: v.optional(v.number()),
    /** Votes: the room idea, resolved server-side, and the twin's vote on it. */
    ideaRef: v.optional(v.string()),
    ideaText: v.optional(v.string()),
    vote: v.optional(twinVote),
    dedupeKey: v.string(),
    status: agentPostStatus,
    publishedClueId: v.optional(v.id("publishedClues")),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_collaborator_dedupe", ["collaboratorId", "dedupeKey"])
    .index("by_collaborator_status", ["collaboratorId", "status"]),

  twinVaultChunks: defineTable({
    roomId: v.id("rooms"),
    collaboratorId: v.id("agentCollaborators"),
    uploadId: v.string(),
    messages: v.array(vaultMessage),
    chars: v.number(),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_collaborator", ["collaboratorId"]),
};
