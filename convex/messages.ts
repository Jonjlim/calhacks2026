/**
 * Room chat. Owner: Dev 2 (BE-003). Consumers: Dev 1, Dev 3.
 * sendMessage may enqueue an `evaluate_thread` AgentJob for the buyer agent.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { notImplemented } from "./lib/result";

export const sendMessage = mutation({
  args: {
    roomId: v.id("rooms"),
    body: v.string(),
    clientIdempotencyKey: v.string(),
  },
  handler: async (_ctx, _args) => notImplemented<Doc<"chatMessages">>("BE-003"),
});

/** Mock: lib/mocks/queries.ts chatQuery. */
export const listMessages = query({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) => notImplemented<Doc<"chatMessages">[]>("BE-003"),
});
