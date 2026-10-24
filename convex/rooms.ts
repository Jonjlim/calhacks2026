/**
 * Rooms and membership. Owner: Dev 2 (BE-002, BE-013).
 * Consumers: Dev 1 (create/join UI), Dev 3 (room snapshot).
 */
import { v } from "convex/values";
import type { RoomView } from "../lib/contracts";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { getMembership, getUserId, requireMember } from "./lib/auth";
import { cleanText, isMoney, LIMITS } from "./lib/input";
import { recomputeProposal } from "./lib/proposalEngine";
import { err, memberError, ok } from "./lib/result";
import { toParticipant, toRoom } from "./lib/views";

const OCCASION_MAX_CHARS = 80;
const INVITE_TOKEN_MAX_CHARS = 128;

function newInviteToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function joinPath(inviteToken: string): string {
  return `/join/${inviteToken}`;
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
    type Out = { room: Doc<"rooms">; participant: Doc<"participants">; inviteToken: string };
    const userId = await getUserId(ctx);
    if (!userId) return err<Out>("unauthorized", "Sign in to create a room.");

    const title = cleanText(args.title, LIMITS.roomTitleMaxChars);
    const recipientDisplayName = cleanText(args.recipientDisplayName, LIMITS.displayNameMaxChars);
    const occasion = cleanText(args.occasion, OCCASION_MAX_CHARS);
    const displayName = cleanText(args.displayName ?? "Organizer", LIMITS.displayNameMaxChars);
    if (!title || !recipientDisplayName || !occasion || !displayName) {
      return err<Out>("validation_failed", "Title, recipient, occasion, and your name are required.");
    }
    if (args.budgetMinor !== undefined && (!isMoney(args.budgetMinor) || args.budgetMinor === 0)) {
      return err<Out>("validation_failed", "Budget must be a positive amount in cents.");
    }
    if (args.deadlineAt !== undefined && !(Number.isFinite(args.deadlineAt) && args.deadlineAt > 0)) {
      return err<Out>("validation_failed", "Deadline is invalid.");
    }

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
    return ok<Out>({ room, participant, inviteToken });
  },
});

/**
 * Contract: joinRoom → { room, participant }. Idempotent for an existing
 * member. The token only creates membership; it never unlocks private rows.
 */
export const joinRoom = mutation({
  args: { inviteToken: v.string(), displayName: v.string() },
  handler: async (ctx, args) => {
    type Out = { room: Doc<"rooms">; participant: Doc<"participants"> };
    const userId = await getUserId(ctx);
    if (!userId) return err<Out>("unauthorized", "Sign in to join a room.");

    const token = args.inviteToken.trim();
    if (!token || token.length > INVITE_TOKEN_MAX_CHARS) {
      return err<Out>("not_found", "That invite link is not valid.");
    }
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_invite_token", (q) => q.eq("inviteToken", token))
      .first();
    if (!room) return err<Out>("not_found", "That invite link is not valid.");

    const existing = await getMembership(ctx, room._id);
    if (existing) return ok<Out>({ room, participant: existing });

    const displayName = cleanText(args.displayName, LIMITS.displayNameMaxChars);
    if (!displayName) return err<Out>("validation_failed", "Enter a display name.");

    const participantId = await ctx.db.insert("participants", {
      roomId: room._id,
      userId,
      displayName,
      role: "contributor",
      joinedAt: Date.now(),
    });
    // A new participant changes the allocation inputs for any live proposal.
    await recomputeProposal(ctx, room._id);

    const participant = (await ctx.db.get(participantId))!;
    return ok<Out>({ room: (await ctx.db.get(room._id))!, participant });
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
      if (room) rows.push({ roomId: room._id, title: room.title, role: m.role, createdAt: room.createdAt });
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
  handler: async (ctx, { inviteToken }) => {
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
    if (!room) return err<Out>("not_found", "That invite link is not valid.");
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
