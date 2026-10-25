/**
 * Device side of the Gift Twin: the recipient's Mac companion calls these
 * with a bearer device token it generated locally. Only the token's SHA-256
 * is stored.
 *
 * The device can pair, upload the messages the recipient sent (after the
 * companion asks for one-time consent), delete them again, and disconnect.
 * It can never read anything back: no room ideas, chat, member names, caps,
 * prices, or its own uploaded messages.
 *
 * Expected failures return Result errors; nothing here throws for them.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { isLiveRoom } from "../lib/auth";
import { err, ok } from "../lib/result";
import type { Result } from "../../lib/contracts";
import {
  normalizePairingCode,
  TWIN_LIMITS,
  type DeviceSession,
  type UploadFinished,
  type UploadStarted,
} from "../../lib/agentCollaborators/contracts";
import { closeVault, deleteVaultChunks, giftTwinEnabled, isWellFormedDeviceToken, loadDevice, revoke, sha256Hex, vaultView } from "./lib";
import { vaultMessage } from "./schema";

const NOT_CONNECTED = "This Mac is not connected to a gift room. Pair it again with a new code.";
const NO_UPLOAD = "That upload is no longer open. Run share again.";

function sessionOf(collaborator: Doc<"agentCollaborators">, room: Doc<"rooms">): DeviceSession {
  const vault = vaultView(collaborator);
  return {
    collaboratorId: collaborator._id,
    recipientDisplayName: room.recipientDisplayName,
    occasion: room.occasion,
    status: collaborator.status,
    ...(vault ? { vault } : {}),
  };
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Exchanges a single-use pairing code for an active device binding. */
export const pair = mutation({
  args: { pairingCode: v.string(), deviceToken: v.string(), deviceLabel: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Result<DeviceSession>> => {
    if (!giftTwinEnabled()) return err("refused", "Gift Twin is not enabled on this deployment.");
    if (!isWellFormedDeviceToken(args.deviceToken)) return err("validation_failed", "Device token is malformed.");
    const code = normalizePairingCode(args.pairingCode);
    if (code.length !== TWIN_LIMITS.pairingCodeLength) return err("validation_failed", "Pairing codes are 8 characters.");
    const codeHash = await sha256Hex(code);
    const collaborator = await ctx.db
      .query("agentCollaborators")
      .withIndex("by_pairing_code", (q) => q.eq("pairingCodeHash", codeHash))
      .unique();
    const now = Date.now();
    if (!collaborator || collaborator.status !== "pending_pairing" || (collaborator.pairingExpiresAt ?? 0) < now)
      return err("not_found", "That pairing code is wrong or has expired. Ask the organizer for a new one.");
    const room = await ctx.db.get(collaborator.roomId);
    if (!isLiveRoom(room)) return err("not_found", "That gift room no longer exists.");
    const tokenHash = await sha256Hex(args.deviceToken);
    const clash = await ctx.db
      .query("agentCollaborators")
      .withIndex("by_device_token", (q) => q.eq("deviceTokenHash", tokenHash))
      .first();
    if (clash) return err("validation_failed", "Generate a fresh device token and try again.");
    const label = args.deviceLabel?.trim().slice(0, TWIN_LIMITS.deviceLabelMaxChars);
    await ctx.db.patch(collaborator._id, {
      status: "active",
      pairingCodeHash: undefined,
      pairingExpiresAt: undefined,
      deviceTokenHash: tokenHash,
      ...(label ? { deviceLabel: label } : {}),
      pairedAt: now,
      lastSeenAt: now,
    });
    return ok(sessionOf({ ...collaborator, status: "active" }, room));
  },
});

export const session = query({
  args: { deviceToken: v.string() },
  handler: async (ctx, args): Promise<Result<DeviceSession>> => {
    const device = await loadDevice(ctx, args.deviceToken);
    if (!device.ok) return err("unauthorized", NOT_CONNECTED);
    return ok(sessionOf(device.collaborator, device.room));
  },
});

/**
 * Opens a fresh vault. `consent` must be true: the companion only sends it
 * after the recipient agreed to a one-time upload of the messages they sent,
 * kept for TWIN_LIMITS.vaultTtlMs. Any earlier upload is deleted first.
 */
export const startUpload = mutation({
  args: { deviceToken: v.string(), consent: v.boolean() },
  handler: async (ctx, args): Promise<Result<UploadStarted>> => {
    if (!giftTwinEnabled()) return err("refused", "Gift Twin is not enabled on this deployment.");
    const device = await loadDevice(ctx, args.deviceToken);
    if (!device.ok) return err("unauthorized", NOT_CONNECTED);
    if (args.consent !== true) return err("refused", "The recipient has to agree before any messages are uploaded.");
    const { collaborator } = device;
    await deleteVaultChunks(ctx, collaborator._id);
    const now = Date.now();
    const uploadId = randomId();
    const expiresAt = now + TWIN_LIMITS.vaultTtlMs;
    await ctx.db.patch(collaborator._id, {
      consentedAt: now,
      lastSeenAt: now,
      vaultUploadId: uploadId,
      vaultStatus: "uploading",
      vaultMessageCount: 0,
      vaultChars: 0,
      vaultExpiresAt: expiresAt,
      checkedIdeaRefs: [],
    });
    // Scheduled now so an abandoned upload is deleted on time too.
    await ctx.scheduler.runAt(expiresAt, internal.giftTwin.agent.expireVault, { collaboratorId: collaborator._id, uploadId });
    return ok({ uploadId, expiresAt });
  },
});

/** One batch of the recipient's own messages. Limits are enforced here; the companion's batching is not trusted. */
export const uploadMessages = mutation({
  args: { deviceToken: v.string(), uploadId: v.string(), messages: v.array(vaultMessage) },
  handler: async (ctx, args): Promise<Result<{ messageCount: number }>> => {
    const device = await loadDevice(ctx, args.deviceToken);
    if (!device.ok) return err("unauthorized", NOT_CONNECTED);
    const { collaborator, room } = device;
    if (collaborator.vaultStatus !== "uploading" || collaborator.vaultUploadId !== args.uploadId) return err("stale_job", NO_UPLOAD);
    if (args.messages.length === 0 || args.messages.length > TWIN_LIMITS.uploadBatchMaxMessages)
      return err("validation_failed", `Send 1 to ${TWIN_LIMITS.uploadBatchMaxMessages} messages per batch.`);
    const messages: Array<{ text: string; sentAt: number }> = [];
    let chars = 0;
    for (const message of args.messages) {
      const text = message.text.trim();
      if (!text || text.length > TWIN_LIMITS.messageMaxChars || !Number.isFinite(message.sentAt) || message.sentAt < 0)
        return err("validation_failed", `Each message needs text (at most ${TWIN_LIMITS.messageMaxChars} characters) and a send time.`);
      messages.push({ text, sentAt: Math.round(message.sentAt) });
      chars += text.length;
    }
    if (chars > TWIN_LIMITS.uploadBatchMaxChars) return err("validation_failed", "That batch is too large.");
    const totalChars = (collaborator.vaultChars ?? 0) + chars;
    const chunkCount = (
      await ctx.db.query("twinVaultChunks").withIndex("by_collaborator", (q) => q.eq("collaboratorId", collaborator._id)).collect()
    ).length;
    if (totalChars > TWIN_LIMITS.vaultMaxChars || chunkCount >= TWIN_LIMITS.vaultMaxChunks)
      return err("validation_failed", "The upload is over the size limit. Send fewer messages (try --max-mb 2).");
    const now = Date.now();
    await ctx.db.insert("twinVaultChunks", {
      roomId: room._id,
      collaboratorId: collaborator._id,
      uploadId: args.uploadId,
      messages,
      chars,
      createdAt: now,
    });
    const messageCount = (collaborator.vaultMessageCount ?? 0) + messages.length;
    await ctx.db.patch(collaborator._id, { vaultMessageCount: messageCount, vaultChars: totalChars, lastSeenAt: now });
    return ok({ messageCount });
  },
});

/** Closes the upload and hands the vault to the twin agent. */
export const finishUpload = mutation({
  args: { deviceToken: v.string(), uploadId: v.string() },
  handler: async (ctx, args): Promise<Result<UploadFinished>> => {
    const device = await loadDevice(ctx, args.deviceToken);
    if (!device.ok) return err("unauthorized", NOT_CONNECTED);
    const { collaborator } = device;
    if (collaborator.vaultStatus !== "uploading" || collaborator.vaultUploadId !== args.uploadId || collaborator.vaultExpiresAt === undefined)
      return err("stale_job", NO_UPLOAD);
    await ctx.db.patch(collaborator._id, { vaultStatus: "processing", lastSeenAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.giftTwin.agent.processVault, { collaboratorId: collaborator._id, uploadId: args.uploadId });
    return ok({ messageCount: collaborator.vaultMessageCount ?? 0, expiresAt: collaborator.vaultExpiresAt });
  },
});

/** The recipient deletes their uploaded messages now. The twin stays connected; its notes stay in the room. */
export const forget = mutation({
  args: { deviceToken: v.string() },
  handler: async (ctx, args): Promise<Result<null>> => {
    const device = await loadDevice(ctx, args.deviceToken);
    if (!device.ok) return err("unauthorized", NOT_CONNECTED);
    await closeVault(ctx, device.collaborator);
    return ok(null);
  },
});

/** The recipient unplugs their twin from the Mac. Same effect as the organizer's revoke, including deleting the vault. */
export const disconnect = mutation({
  args: { deviceToken: v.string() },
  handler: async (ctx, args): Promise<Result<null>> => {
    const device = await loadDevice(ctx, args.deviceToken);
    if (!device.ok) return err("unauthorized", NOT_CONNECTED);
    await revoke(ctx, device.collaborator);
    return ok(null);
  },
});
