/** Server helpers for agent collaborators. Exports no Convex functions. */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isLiveRoom } from "../lib/auth";
import { internal } from "../_generated/api";
import {
  TWIN_LIMITS,
  type AgentCollaboratorPostView,
  type AgentCollaboratorView,
  type RoomIdea,
  type TwinVaultView,
} from "../../lib/agentCollaborators/contracts";

/** Demo gate for anything that connects a device or accepts messages. Existing rows stay readable when it is off. */
export function giftTwinEnabled(): boolean {
  return process.env.GIFT_TWIN_DEMO_ENABLED === "true";
}

export function modelConfigured(): boolean {
  return Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
}

export function mossConfigured(): boolean {
  return process.env.GIFT_TWIN_MOSS_ENABLED === "true" &&
    Boolean(process.env.MOSS_PROJECT_ID && process.env.MOSS_PROJECT_KEY);
}

/** Wake without creating another polling loop. The claim mutation dedupes bursts. */
export async function enqueueTwinCheck(ctx: MutationCtx, roomId: Id<"rooms">) {
  const twins = await ctx.db.query("agentCollaborators").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(20);
  for (const twin of twins) {
    if (twin.kind !== "gift_twin" || twin.status !== "active" || twin.vaultStatus !== "ready" ||
      !twin.vaultUploadId || (twin.vaultExpiresAt ?? 0) <= Date.now()) continue;
    await ctx.scheduler.runAfter(200, internal.giftTwin.agent.checkIdeas, {
      collaboratorId: twin._id, uploadId: twin.vaultUploadId,
    });
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isWellFormedDeviceToken(token: string): boolean {
  return (
    token.length >= TWIN_LIMITS.deviceTokenMinChars &&
    token.length <= TWIN_LIMITS.deviceTokenMaxChars &&
    TOKEN_PATTERN.test(token)
  );
}

export type DeviceContext =
  | { ok: true; collaborator: Doc<"agentCollaborators">; room: Doc<"rooms"> }
  | { ok: false };

/** Resolves a device bearer token to its active collaborator in a live room. */
export async function loadDevice(ctx: QueryCtx, deviceToken: string): Promise<DeviceContext> {
  if (!isWellFormedDeviceToken(deviceToken)) return { ok: false };
  const hash = await sha256Hex(deviceToken);
  const collaborator = await ctx.db
    .query("agentCollaborators")
    .withIndex("by_device_token", (q) => q.eq("deviceTokenHash", hash))
    .unique();
  if (!collaborator || collaborator.status !== "active") return { ok: false };
  const room = await ctx.db.get(collaborator.roomId);
  if (!isLiveRoom(room)) return { ok: false };
  return { ok: true, collaborator, room };
}

/** The collaborator if it is active, in a live room, and still on this upload. */
export async function loadUpload(
  ctx: QueryCtx,
  collaboratorId: Id<"agentCollaborators">,
  uploadId: string,
): Promise<{ collaborator: Doc<"agentCollaborators">; room: Doc<"rooms"> } | null> {
  const collaborator = await ctx.db.get(collaboratorId);
  if (!collaborator || collaborator.status !== "active" || collaborator.vaultUploadId !== uploadId ||
    (collaborator.vaultExpiresAt ?? 0) <= Date.now()) return null;
  const room = await ctx.db.get(collaborator.roomId);
  if (!isLiveRoom(room)) return null;
  return { collaborator, room };
}

function clip(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, TWIN_LIMITS.ideaTextMaxChars);
}

/**
 * The room's current ideas, as the twin may see them: clue, idea-branch, and
 * listing text only. Clues the twin itself produced are left out so it never
 * votes on its own notes.
 */
export async function roomIdeas(ctx: QueryCtx, room: Doc<"rooms">, collaboratorId: Id<"agentCollaborators">): Promise<RoomIdea[]> {
  const own = new Set(
    (await ctx.db.query("agentCollaboratorPosts").withIndex("by_room", (q) => q.eq("roomId", room._id)).take(200))
      .filter((p) => p.collaboratorId === collaboratorId && p.publishedClueId)
      .map((p) => p.publishedClueId as string),
  );
  const clues = (await ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", room._id)).take(200))
    .filter((c) => c.status === "active" && !own.has(c._id))
    .slice(-15)
    .map((c): RoomIdea => ({ ref: `clue:${c._id}`, kind: "clue", text: clip(c.text), clueKind: c.kind }));
  const sprouts = (await ctx.db.query("mapSprouts").withIndex("by_room", (q) => q.eq("roomId", room._id)).order("desc").take(10)).map(
    (s): RoomIdea => ({ ref: `idea:${s._id}`, kind: "idea", text: clip(s.label) }),
  );
  const listings = (await ctx.db.query("productListings").withIndex("by_room", (q) => q.eq("roomId", room._id)).order("desc").take(30))
    .filter((l) => l.status === "active")
    .slice(0, 8)
    .map((l): RoomIdea => ({ ref: `listing:${l._id}`, kind: "listing", text: clip(l.title) }));
  return [...clues, ...sprouts, ...listings].slice(0, TWIN_LIMITS.contextIdeasMax);
}

export function vaultView(doc: Doc<"agentCollaborators">): TwinVaultView | undefined {
  if (!doc.vaultStatus) return undefined;
  return {
    status: doc.vaultStatus,
    messageCount: doc.vaultMessageCount ?? 0,
    ...(doc.vaultStatus !== "expired" && doc.vaultExpiresAt !== undefined ? { expiresAt: doc.vaultExpiresAt } : {}),
  };
}

export function collaboratorView(doc: Doc<"agentCollaborators">): AgentCollaboratorView {
  const vault = vaultView(doc);
  return {
    id: doc._id,
    roomId: doc.roomId,
    kind: doc.kind,
    displayName: doc.displayName,
    status: doc.status,
    ...(doc.deviceLabel !== undefined ? { deviceLabel: doc.deviceLabel } : {}),
    ...(doc.status === "pending_pairing" && doc.pairingExpiresAt !== undefined ? { pairingExpiresAt: doc.pairingExpiresAt } : {}),
    ...(doc.consentedAt !== undefined ? { consentedAt: doc.consentedAt } : {}),
    ...(doc.reportedAt !== undefined ? { reportedAt: doc.reportedAt } : {}),
    ...(vault ? { vault } : {}),
    createdAt: doc.createdAt,
  };
}

export function postView(doc: Doc<"agentCollaboratorPosts">): AgentCollaboratorPostView {
  return {
    id: doc._id,
    collaboratorId: doc.collaboratorId,
    kind: doc.kind,
    ...(doc.category !== undefined ? { category: doc.category } : {}),
    text: doc.text,
    confidence: doc.confidence,
    ...(doc.evidenceCount !== undefined ? { evidenceCount: doc.evidenceCount } : {}),
    ...(doc.ideaRef !== undefined ? { ideaRef: doc.ideaRef } : {}),
    ...(doc.ideaText !== undefined ? { ideaText: doc.ideaText } : {}),
    ...(doc.vote !== undefined ? { vote: doc.vote } : {}),
    status: doc.status,
    ...(doc.publishedClueId !== undefined ? { publishedClueId: doc.publishedClueId } : {}),
    createdAt: doc.createdAt,
  };
}

/** Deletes every vaulted message for a collaborator. Bounded by vaultMaxChunks per upload. */
export async function deleteVaultChunks(ctx: MutationCtx, collaboratorId: Id<"agentCollaborators">) {
  const chunks = await ctx.db.query("twinVaultChunks").withIndex("by_collaborator", (q) => q.eq("collaboratorId", collaboratorId)).collect();
  for (const chunk of chunks) await ctx.db.delete(chunk._id);
}

/** Deletes the vault and stops the twin's watch loop. Posts stay as history. */
export async function closeVault(ctx: MutationCtx, collaborator: Doc<"agentCollaborators">) {
  await deleteVaultChunks(ctx, collaborator._id);
  if (!collaborator.vaultStatus) return;
  await ctx.db.patch(collaborator._id, {
    vaultStatus: "expired",
    vaultUploadId: undefined,
    vaultChars: undefined,
    vaultExpiresAt: undefined,
    checkedIdeaRefs: undefined,
  });
}

/** Stops a device token and deletes its vault. Posts stay as history. */
export async function revoke(ctx: MutationCtx, collaborator: Doc<"agentCollaborators">) {
  if (collaborator.status === "revoked") return;
  await closeVault(ctx, collaborator);
  await ctx.db.patch(collaborator._id, {
    status: "revoked",
    revokedAt: Date.now(),
    pairingCodeHash: undefined,
    pairingExpiresAt: undefined,
    deviceTokenHash: undefined,
  });
}
