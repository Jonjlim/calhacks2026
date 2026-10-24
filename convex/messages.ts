/**
 * Room chat. Owner: Dev 2 (BE-003). Consumers: Dev 1, Dev 3.
 * sendMessage enqueues an `evaluate_thread` AgentJob for the buyer agent and
 * schedules Dev 3's evaluateThread action through enqueueBuyerTurn. The agent
 * commits its message, question/research effect, and completion atomically.
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { cleanText, IDEMPOTENCY_KEY_MAX_CHARS, LIMITS } from "./lib/input";
import { err, memberError, ok } from "./lib/result";
import { enqueueBuyerTurn } from "./agents/runtime";
import { questionSlotSchema } from "../lib/validation";

const TRANSCRIPT_WINDOW = 200;

export const sendMessage = mutation({
  args: {
    roomId: v.id("rooms"),
    body: v.string(),
    clientIdempotencyKey: v.string(),
    replyToSlot: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return memberError<Doc<"chatMessages">>(member.code);

    const body = cleanText(args.body, LIMITS.chatBodyMaxChars);
    if (!body) return err<Doc<"chatMessages">>("validation_failed", "Message is empty or too long.");
    const key = args.clientIdempotencyKey.trim();
    if (!key || key.length > IDEMPOTENCY_KEY_MAX_CHARS) {
      return err<Doc<"chatMessages">>("validation_failed", "Missing idempotency key.");
    }

    const duplicate = await ctx.db
      .query("chatMessages")
      .withIndex("by_room_idempotency", (q) => q.eq("roomId", args.roomId).eq("clientIdempotencyKey", key))
      .first();
    if (duplicate) {
      if (duplicate.participantId !== member.me._id) {
        return err<Doc<"chatMessages">>("validation_failed", "Idempotency key already used.");
      }
      return ok(duplicate);
    }

    if (args.replyToSlot !== undefined && !questionSlotSchema.safeParse(args.replyToSlot).success) return err<Doc<"chatMessages">>("validation_failed", "Unknown question slot.");
    const question = args.replyToSlot === undefined ? null : await ctx.db.query("askedSlots")
      .withIndex("by_room_slot", q => q.eq("roomId", args.roomId).eq("slot", args.replyToSlot!)).first();
    if (args.replyToSlot !== undefined && question?.status !== "open") {
      return err<Doc<"chatMessages">>("invalid_revision", "This question is no longer open.");
    }

    const messageId = await ctx.db.insert("chatMessages", {
      roomId: args.roomId,
      authorKind: "participant",
      participantId: member.me._id,
      body,
      createdAt: Date.now(),
      clientIdempotencyKey: key,
      ...(args.replyToSlot ? { replyToSlot: args.replyToSlot } : {}),
    });
    await ctx.db.patch(args.roomId, { latestMessageId: messageId });
    if (question) await ctx.db.patch(question._id, { status: "answered", answeredByMessageId: messageId });

    const turn = await enqueueBuyerTurn(ctx, args.roomId, member.me._id, question ? "auto" : "quiet");
    if (turn.ok) await ctx.db.patch(messageId, { responseAgentJobId: turn.value.jobId });

    return ok((await ctx.db.get(messageId))!);
  },
});

/** Mock: lib/mocks/queries.ts chatQuery. Oldest first, last 200 messages. */
export const listMessages = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Doc<"chatMessages">[]>(member.code);
    const recent = await ctx.db
      .query("chatMessages")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .order("desc")
      .take(TRANSCRIPT_WINDOW);
    return ok(recent.reverse().map((msg) => (msg.deletedAt === undefined ? msg : { ...msg, body: "" })));
  },
});

/**
 * Author deletes their own message. The row stays as a tombstone (body
 * overwritten with "", `deletedAt` set) so agent job fences, answered
 * questions, and room.latestMessageId keep pointing at a real row, and the
 * buyer-agent snapshot (which reads chatMessages directly) never sees the
 * old text. Buyer-agent messages cannot be deleted by anyone, organizer
 * included. Deleting does not enqueue an agent turn.
 */
export const deleteMessage = mutation({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message) return err<Doc<"chatMessages">>("not_found", "Message not found.");
    const member = await requireMember(ctx, message.roomId);
    if (!member.ok) return memberError<Doc<"chatMessages">>(member.code);
    if (message.authorKind !== "participant") {
      return err<Doc<"chatMessages">>("refused", "Assistant messages can't be deleted.");
    }
    if (message.participantId !== member.me._id) {
      return err<Doc<"chatMessages">>("unauthorized", "You can only delete your own messages.");
    }
    if (message.deletedAt === undefined) {
      await ctx.db.patch(messageId, { body: "", deletedAt: Date.now() });
    }
    return ok((await ctx.db.get(messageId))!);
  },
});

/**
 * Write path for the buyer agent (Dev 3). One chat message per job; a retry
 * with the same job returns the existing message.
 */
export const postAgentMessage = internalMutation({
  args: { jobId: v.id("agentJobs"), body: v.string() },
  handler: async (ctx, { jobId, body: rawBody }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return err<Doc<"chatMessages">>("not_found", "Job not found.");
    if (job.kind !== "evaluate_thread") {
      return err<Doc<"chatMessages">>("refused", "Only evaluate_thread jobs may speak in chat.");
    }
    if (job.status === "stale" || job.status === "canceled") {
      return err<Doc<"chatMessages">>("stale_job", "Job is no longer current.");
    }
    const body = cleanText(rawBody, LIMITS.chatBodyMaxChars);
    if (!body) return err<Doc<"chatMessages">>("validation_failed", "Agent message is empty or too long.");

    const key = `agent:${jobId}`;
    const existing = await ctx.db
      .query("chatMessages")
      .withIndex("by_room_idempotency", (q) => q.eq("roomId", job.roomId).eq("clientIdempotencyKey", key))
      .first();
    if (existing) return ok(existing);

    const messageId = await ctx.db.insert("chatMessages", {
      roomId: job.roomId,
      authorKind: "buyer_agent",
      body,
      createdAt: Date.now(),
      clientIdempotencyKey: key,
    });
    return ok((await ctx.db.get(messageId))!);
  },
});
