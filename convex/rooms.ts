/**
 * Rooms and membership. Owner: Dev 2 (BE-002, BE-013).
 * Consumers: Dev 1 (create/join UI), Dev 3 (room snapshot).
 */
import { v } from "convex/values";
import type { RoomView } from "../lib/contracts";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { notImplemented } from "./lib/result";

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
  handler: async (_ctx, _args) =>
    notImplemented<{
      room: Doc<"rooms">;
      participant: Doc<"participants">;
      inviteToken: string;
    }>("BE-002"),
});

/** Contract: joinRoom → { room, participant }. The token never unlocks private rows. */
export const joinRoom = mutation({
  args: { inviteToken: v.string(), displayName: v.string() },
  handler: async (_ctx, _args) =>
    notImplemented<{ room: Doc<"rooms">; participant: Doc<"participants"> }>("BE-002"),
});

/** Room metadata + participants for members. Mock: lib/mocks/queries.ts roomQuery. */
export const getRoom = query({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) => notImplemented<RoomView>("BE-002"),
});
