/**
 * Room-member side of agent collaborators (Gift Twin first).
 *
 * The twin joins as a collaborator, not a Participant: it holds no
 * contribution share, its up/down votes are advisory and separate from
 * participant votes, and it cannot select or approve. Members only pair,
 * watch, and disconnect it; the gift agent reviews its posts (review.ts).
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalMutation, mutation, query } from "../_generated/server";
import { isLiveRoom, requireMember } from "../lib/auth";
import { err, memberError, ok } from "../lib/result";
import type { Result } from "../../lib/contracts";
import { PAIRING_CODE_ALPHABET, TWIN_LIMITS, type AgentCollaboratorFeed } from "../../lib/agentCollaborators/contracts";
import { collaboratorView, giftTwinEnabled, postView, revoke, sha256Hex } from "./lib";

const FEED_POSTS = 60;
const RECIPIENT_LABEL_MAX_CHARS = 40;

/** Rejection sampling keeps every alphabet character equally likely. */
function randomPairingCode(): string {
  const n = PAIRING_CODE_ALPHABET.length;
  const ceiling = 256 - (256 % n);
  let code = "";
  while (code.length < TWIN_LIMITS.pairingCodeLength) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < ceiling && code.length < TWIN_LIMITS.pairingCodeLength) code += PAIRING_CODE_ALPHABET[byte % n];
    }
  }
  return code;
}

interface PairingIssued {
  collaboratorId: Id<"agentCollaborators">;
  pairingCode: string;
  expiresAt: number;
}

/**
 * Organizer issues a short-lived, single-use pairing code for the recipient's
 * Mac. An action because codes need unseeded randomness; only the hash is stored.
 */
export const createPairing = action({
  args: { roomId: v.id("rooms"), recipientLabel: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Result<PairingIssued>> => {
    if (!giftTwinEnabled()) return err("refused", "Gift Twin is not enabled on this deployment.");
    const userId = await getAuthUserId(ctx);
    if (!userId) return err("unauthorized", "Sign in first.");
    const pairingCode = randomPairingCode();
    const expiresAt = Date.now() + TWIN_LIMITS.pairingCodeTtlMs;
    const recorded: Result<{ collaboratorId: Id<"agentCollaborators"> }> = await ctx.runMutation(
      internal.giftTwin.room.recordPairing,
      {
        roomId: args.roomId,
        userId,
        codeHash: await sha256Hex(pairingCode),
        expiresAt,
        ...(args.recipientLabel !== undefined ? { recipientLabel: args.recipientLabel } : {}),
      },
    );
    if (!recorded.ok) return recorded;
    return ok({ collaboratorId: recorded.value.collaboratorId, pairingCode, expiresAt });
  },
});

export const recordPairing = internalMutation({
  args: {
    roomId: v.id("rooms"),
    userId: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
    recipientLabel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Result<{ collaboratorId: Id<"agentCollaborators"> }>> => {
    const room = await ctx.db.get(args.roomId);
    if (!isLiveRoom(room)) return memberError("not_found");
    const me = await ctx.db
      .query("participants")
      .withIndex("by_room_user", (q) => q.eq("roomId", args.roomId).eq("userId", args.userId))
      .unique();
    if (!me) return memberError("unauthorized");
    if (me.role !== "organizer") return err("unauthorized", "Only the organizer can invite a Gift Twin.");
    const label = (args.recipientLabel ?? room.recipientDisplayName).trim().slice(0, RECIPIENT_LABEL_MAX_CHARS) || room.recipientDisplayName;

    const existing = (
      await ctx.db.query("agentCollaborators").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect()
    ).filter((c) => c.kind === "gift_twin" && c.status !== "revoked");
    if (existing.some((c) => c.status === "active"))
      return err("refused", "A Gift Twin is already connected. Disconnect it before pairing another Mac.");
    const pending = existing.find((c) => c.status === "pending_pairing");
    if (pending) {
      await ctx.db.patch(pending._id, { pairingCodeHash: args.codeHash, pairingExpiresAt: args.expiresAt, displayName: `${label}'s Gift Twin` });
      return ok({ collaboratorId: pending._id });
    }
    const collaboratorId = await ctx.db.insert("agentCollaborators", {
      roomId: args.roomId,
      kind: "gift_twin",
      displayName: `${label}'s Gift Twin`,
      status: "pending_pairing",
      createdBy: me._id,
      pairingCodeHash: args.codeHash,
      pairingExpiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
    return ok({ collaboratorId });
  },
});

/** Everything room members may see about agent collaborators. Never hashes or device secrets; skipped notes are hidden. */
export const getFeed = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args): Promise<Result<AgentCollaboratorFeed>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return memberError(member.code);
    const collaborators = await ctx.db.query("agentCollaborators").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect();
    const posts = await ctx.db.query("agentCollaboratorPosts").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).order("desc").take(FEED_POSTS);
    return ok({
      collaborators: collaborators.filter((c) => c.status !== "revoked").map(collaboratorView),
      posts: posts.reverse().filter((p) => p.status !== "dismissed").map(postView),
    });
  },
});

/** Organizer disconnects a twin. The device token stops working and its vaulted messages are deleted; posts stay as history. */
export const revokeCollaborator = mutation({
  args: { collaboratorId: v.id("agentCollaborators") },
  handler: async (ctx, args): Promise<Result<null>> => {
    const collaborator = await ctx.db.get(args.collaboratorId);
    if (!collaborator) return err("not_found", "That Gift Twin no longer exists.");
    const member = await requireMember(ctx, collaborator.roomId);
    if (!member.ok) return memberError(member.code);
    if (member.me.role !== "organizer") return err("unauthorized", "Only the organizer can disconnect a Gift Twin.");
    await revoke(ctx, collaborator);
    return ok(null);
  },
});
