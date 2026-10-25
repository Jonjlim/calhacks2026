/**
 * Rooms and membership. Owner: Dev 2 (BE-002, BE-013).
 * Consumers: Dev 1 (create/join UI), Dev 3 (room snapshot).
 */
import { v } from "convex/values";
import type { Room, RoomView } from "../lib/contracts";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { refreshBudgetGuidance } from "./lib/budgets";
import { getMembership, getUserId, isLiveRoom, requireMember } from "./lib/auth";
import { purgeParticipantPrivateData } from "./lib/evidence";
import { cleanText, isMoney, LIMITS } from "./lib/input";
import { bumpKnowledgeRevision } from "./lib/knowledge";
import { recomputeProposal } from "./lib/proposalEngine";
import { err, memberError, ok } from "./lib/result";
import { purgeRoomStep } from "./lib/roomPurge";
import { toParticipant, toRoom } from "./lib/views";
import { FROZEN_STATUSES, isTerminalAttempt } from "./payments/stateMachine";

const OCCASION_MAX_CHARS = 80;
const INVITE_TOKEN_MAX_CHARS = 128;

/** Room codes are four easy-to-read characters: no 0/O, 1/I/L, so they can be said aloud. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function newInviteToken(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function joinPath(inviteToken: string): string {
  return `/join/${inviteToken}`;
}

/** Room document as returned to clients: the recipient profile link stays server-side. */
type ClientRoomDoc = Omit<Doc<"rooms">, "recipientProfileId">;

function clientRoomDoc(room: Doc<"rooms">): ClientRoomDoc {
  const { recipientProfileId: _recipientProfileId, ...rest } = room;
  return rest;
}

type RoomFields = Pick<Doc<"rooms">, "title" | "recipientDisplayName" | "occasion" | "deadlineAt" | "budgetMinor">;

/** Shared by createRoom and updateRoom. Budget is a hint only; it never enters allocation. */
function validateRoomFields(
  input: RoomFields,
): { ok: true; value: RoomFields } | { ok: false; message: string } {
  const title = cleanText(input.title, LIMITS.roomTitleMaxChars);
  const recipientDisplayName = cleanText(input.recipientDisplayName, LIMITS.displayNameMaxChars);
  const occasion = cleanText(input.occasion, OCCASION_MAX_CHARS);
  if (!title || !recipientDisplayName || !occasion) {
    return { ok: false, message: "Title, recipient, and occasion are required." };
  }
  if (input.budgetMinor !== undefined && (!isMoney(input.budgetMinor) || input.budgetMinor === 0)) {
    return { ok: false, message: "Budget must be a positive amount in cents." };
  }
  if (input.deadlineAt !== undefined && !(Number.isFinite(input.deadlineAt) && input.deadlineAt > 0)) {
    return { ok: false, message: "Deadline is invalid." };
  }
  return {
    ok: true,
    value: { title, recipientDisplayName, occasion, deadlineAt: input.deadlineAt, budgetMinor: input.budgetMinor },
  };
}

/** Contract: createRoom → { room, participant, inviteToken } */
export const createRoom = mutation({
  args: {
    title: v.string(),
    recipientDisplayName: v.string(),
    occasion: v.string(),
    deadlineAt: v.optional(v.number()),
    budgetMinor: v.optional(v.number()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    type Out = { room: ClientRoomDoc; participant: Doc<"participants">; inviteToken: string };
    const userId = await getUserId(ctx);
    if (!userId) return err<Out>("unauthorized", "Sign in to create a room.");

    const displayName = cleanText(args.displayName ?? "Organizer", LIMITS.displayNameMaxChars);
    if (!displayName) return err<Out>("validation_failed", "Title, recipient, occasion, and your name are required.");
    const checked = validateRoomFields(args);
    if (!checked.ok) return err<Out>("validation_failed", checked.message);
    const { title, recipientDisplayName, occasion } = checked.value;

    let inviteToken = newInviteToken();
    while (
      await ctx.db
        .query("rooms")
        .withIndex("by_invite_token", (q) => q.eq("inviteToken", inviteToken))
        .first()
    ) {
      inviteToken = newInviteToken();
    }

    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      title,
      recipientDisplayName,
      occasion,
      deadlineAt: args.deadlineAt,
      currency: "USD",
      budgetMinor: args.budgetMinor,
      knowledgeRevision: 0,
      inviteToken,
      createdBy: userId,
      createdAt: now,
    });
    const participantId = await ctx.db.insert("participants", {
      roomId,
      userId,
      displayName,
      role: "organizer",
      joinedAt: now,
    });
    const room = (await ctx.db.get(roomId))!;
    const participant = (await ctx.db.get(participantId))!;
    return ok<Out>({ room: clientRoomDoc(room), participant, inviteToken });
  },
});

/**
 * Contract: joinRoom → { room, participant }. Idempotent for an existing
 * member. The token only creates membership; it never unlocks private rows.
 */
export const joinRoom = mutation({
  args: { inviteToken: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    type Out = { room: ClientRoomDoc; participant: Doc<"participants"> };
    const userId = await getUserId(ctx);
    if (!userId) return err<Out>("unauthorized", "Sign in to join a room.");

    const raw = args.inviteToken.trim();
    const token = raw.length <= 8 ? raw.toUpperCase() : raw;
    if (!token || token.length > INVITE_TOKEN_MAX_CHARS) {
      return err<Out>("not_found", "That invite link is not valid.");
    }
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", token))
      .first();
    if (!isLiveRoom(room)) return err<Out>("not_found", "That invite link is not valid.");

    const existing = await getMembership(ctx, room._id);
    if (existing) return ok<Out>({ room: clientRoomDoc(room), participant: existing });

    const displayName = cleanText(args.displayName, LIMITS.displayNameMaxChars);
    if (!displayName) return err<Out>("validation_failed", "Enter a display name.");

    const participantId = await ctx.db.insert("participants", {
      roomId: room._id,
      userId,
      displayName,
      role: "contributor",
      joinedAt: Date.now(),
    });
    await refreshBudgetGuidance(ctx, room._id);
    // A new participant changes the allocation inputs for any live proposal.
    await recomputeProposal(ctx, room._id);

    const participant = (await ctx.db.get(participantId))!;
    return ok<Out>({ room: clientRoomDoc((await ctx.db.get(room._id))!), participant });
  },
});

/** Room metadata + participants for members. Mock: lib/mocks/queries.ts roomQuery. */
export const getRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<RoomView>(member.code);
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    return ok<RoomView>({
      room: toRoom(member.room),
      participants: participants.map(toParticipant),
      me: toParticipant(member.me),
    });
  },
});

/** Rooms the caller belongs to, newest first. */
export const listMyRooms = query({
  args: {},
  handler: async (ctx) => {
    type Row = { roomId: Doc<"rooms">["_id"]; title: string; role: Doc<"participants">["role"] };
    const userId = await getUserId(ctx);
    if (!userId) return err<Row[]>("unauthorized", "Not signed in.");
    const memberships = await ctx.db
      .query("participants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const rows = [];
    for (const m of memberships) {
      const room = await ctx.db.get(m.roomId);
      if (isLiveRoom(room)) rows.push({ roomId: room._id, title: room.title, role: m.role, createdAt: room.createdAt });
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return ok<Row[]>(rows.map(({ roomId, title, role }) => ({ roomId, title, role })));
  },
});

/** BE-013: invite token + join path for the QR code. Members only. */
export const getInvite = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<{ inviteToken: string; joinPath: string }>(member.code);
    return ok({ inviteToken: member.room.inviteToken, joinPath: joinPath(member.room.inviteToken) });
  },
});

/**
 * Public-room preview for the join page. Reveals only what the invite itself
 * implies (title, recipient, occasion, headcount), never clues or caps.
 */
export const previewInvite = query({
  args: { inviteToken: v.string() },
  handler: async (ctx, { inviteToken: rawToken }) => {
    const inviteToken = rawToken.trim().length <= 8 ? rawToken.trim().toUpperCase() : rawToken.trim();
    type Out = {
      roomId: Doc<"rooms">["_id"];
      title: string;
      recipientDisplayName: string;
      occasion: string;
      participantCount: number;
      alreadyMember: boolean;
    };
    const token = inviteToken.trim();
    if (!token || token.length > INVITE_TOKEN_MAX_CHARS) return err<Out>("not_found", "That invite link is not valid.");
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", token))
      .first();
    if (!isLiveRoom(room)) return err<Out>("not_found", "That invite link is not valid.");
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    const me = await getMembership(ctx, room._id);
    return ok<Out>({
      roomId: room._id,
      title: room.title,
      recipientDisplayName: room.recipientDisplayName,
      occasion: room.occasion,
      participantCount: participants.length,
      alreadyMember: me !== null,
    });
  },
});

// ---------- Room lifecycle (BE-017) ----------

function isOpenJob(status: Doc<"agentJobs">["status"]): boolean {
  return status === "pending" || status === "running" || status === "uncertain";
}
const PURGE_BATCH_SIZE = 256;

async function currentRevision(ctx: QueryCtx, room: Doc<"rooms">) {
  return room.currentRevisionId ? await ctx.db.get(room.currentRevisionId) : null;
}

async function isFrozenForPayment(ctx: QueryCtx, room: Doc<"rooms">): Promise<boolean> {
  const current = await currentRevision(ctx, room);
  return current !== null && FROZEN_STATUSES.includes(current.status);
}

/** True while any attempt in the room still has a live provider object to cancel or refund. */
async function hasUnsettledPayments(ctx: QueryCtx, roomId: Id<"rooms">): Promise<boolean> {
  const revisions = await ctx.db
    .query("proposalRevisions")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const revision of revisions) {
    const attempts = await ctx.db
      .query("paymentAttempts")
      .withIndex("by_revision", (q) => q.eq("revisionId", revision._id))
      .collect();
    if (attempts.some((a) => a.status !== "not_started" && !isTerminalAttempt(a.status))) return true;
  }
  return false;
}

/**
 * Organizer edits room metadata. Omitted fields are unchanged; `null` clears
 * the optional `deadlineAt` / `budgetMinor`. Budget is a research hint only,
 * so this never touches caps, allocation, or the proposal revision.
 */
export const updateRoom = mutation({
  args: {
    roomId: v.id("rooms"),
    title: v.optional(v.string()),
    recipientDisplayName: v.optional(v.string()),
    occasion: v.optional(v.string()),
    deadlineAt: v.optional(v.union(v.number(), v.null())),
    budgetMinor: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return memberError<Room>(member.code);
    if (member.me.role !== "organizer") return err<Room>("unauthorized", "Only the organizer can edit the room.");

    const room = member.room;
    const checked = validateRoomFields({
      title: args.title ?? room.title,
      recipientDisplayName: args.recipientDisplayName ?? room.recipientDisplayName,
      occasion: args.occasion ?? room.occasion,
      deadlineAt: args.deadlineAt === undefined ? room.deadlineAt : (args.deadlineAt ?? undefined),
      budgetMinor: args.budgetMinor === undefined ? room.budgetMinor : (args.budgetMinor ?? undefined),
    });
    if (!checked.ok) return err<Room>("validation_failed", checked.message);

    await ctx.db.patch(room._id, checked.value);
    return ok<Room>(toRoom((await ctx.db.get(room._id))!));
  },
});

/**
 * A contributor leaves. Their participant row, cap, and votes are deleted and
 * the proposal is recomputed so they no longer hold a share (which mints a
 * new revision and invalidates prior approvals). Their published clues and
 * chat stay room-visible because they consented to that. With
 * `deletePrivateData`, their evidence, private messages, stored files, and
 * proposed clues are deleted too, and published clues derived from that
 * evidence become `source_withdrawn` tombstones. The organizer cannot leave;
 * they delete the room instead.
 */
export const leaveRoom = mutation({
  args: { roomId: v.id("rooms"), deletePrivateData: v.optional(v.boolean()) },
  handler: async (ctx, { roomId, deletePrivateData }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<null>(member.code);
    const { me, room } = member;
    if (me.role === "organizer") {
      return err<null>("refused", "The organizer can't leave. Delete the room instead.");
    }
    if (await isFrozenForPayment(ctx, room)) {
      return err<null>("invalid_revision", "The current proposal is locked for payment.");
    }

    const limit = await ctx.db
      .query("contributionLimits")
      .withIndex("by_room_participant", (q) => q.eq("roomId", roomId).eq("participantId", me._id))
      .unique();
    if (limit) await ctx.db.delete(limit._id);

    const votes = await ctx.db
      .query("votes")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    for (const vote of votes) if (vote.participantId === me._id) await ctx.db.delete(vote._id);

    // Open jobs acting as the leaver must not commit on their behalf.
    const jobs = await ctx.db
      .query("agentJobs")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    const now = Date.now();
    for (const job of jobs) {
      if (job.actingParticipantId === me._id && isOpenJob(job.status)) {
        await ctx.db.patch(job._id, { status: "canceled", finishedAt: now });
      }
    }

    let publishedChanged = false;
    if (deletePrivateData) {
      publishedChanged = (await purgeParticipantPrivateData(ctx, roomId, me._id)).publishedChanged;
      const events = await ctx.db
        .query("agentEvents")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .collect();
      for (const event of events) if (event.participantId === me._id) await ctx.db.delete(event._id);
    }

    const budgetRange = await ctx.db.query("budgetRanges").withIndex("by_room_participant", q => q.eq("roomId", roomId).eq("participantId", me._id)).unique();
    if (budgetRange) await ctx.db.delete(budgetRange._id);
    await ctx.db.delete(me._id);
    await refreshBudgetGuidance(ctx, roomId);
    await recomputeProposal(ctx, roomId);
    if (publishedChanged) await bumpKnowledgeRevision(ctx, roomId);
    return ok(null);
  },
});

/**
 * BE-017. Organizer deletes the room. Access ends in this transaction
 * (`deletedAt` makes requireMember/getMembership treat it as missing), open
 * jobs are canceled, and purgeRoomBatch removes every room-scoped row and
 * stored file in bounded batches. Refused while payment is frozen or any
 * payment attempt still needs a provider cancel/refund.
 */
export const deleteRoom = mutation({
  args: { roomId: v.id("rooms"), confirmTitle: v.string() },
  handler: async (ctx, { roomId, confirmTitle }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<null>(member.code);
    const { me, room } = member;
    if (me.role !== "organizer") return err<null>("unauthorized", "Only the organizer can delete the room.");
    if (confirmTitle.trim() !== room.title) {
      return err<null>("validation_failed", "Type the room title exactly to confirm deletion.");
    }
    if (await isFrozenForPayment(ctx, room)) {
      return err<null>("invalid_revision", "The current proposal is locked for payment.");
    }
    if (await hasUnsettledPayments(ctx, roomId)) {
      return err<null>("invalid_revision", "Payments are still settling. Cancel or wait for them to finish first.");
    }

    const now = Date.now();
    await ctx.db.patch(roomId, { deletedAt: now });
    for (const table of ["agentJobs", "researchJobs", "fashionJobs", "trendJobs"] as const) {
      const jobs = await ctx.db
        .query(table)
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .collect();
      for (const job of jobs) {
        if (isOpenJob(job.status)) await ctx.db.patch(job._id, { status: "canceled" });
      }
    }
    await ctx.scheduler.runAfter(0, internal.rooms.purgeRoomBatch, { roomId });
    return ok(null);
  },
});

/** Deletes one bounded batch of a deleted room's rows and reschedules itself until the room is gone. */
export const purgeRoomBatch = internalMutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    // Only a room already marked by deleteRoom may be purged.
    if (!room || room.deletedAt === undefined) return { deleted: 0, done: true };
    const step = await purgeRoomStep(ctx, roomId, PURGE_BATCH_SIZE);
    if (!step.done) await ctx.scheduler.runAfter(0, internal.rooms.purgeRoomBatch, { roomId });
    return step;
  },
});
