/**
 * Buyer agent (in-room facilitator). Owner: Dev 3 (AI-003, AI-005, AI-007).
 *
 * Returns a validated AgentDecision and applies at most one effect.
 * Defaults to `listen`. Writes `stale` and applies nothing if the room's
 * latest message or knowledgeRevision moved since the job's inputHash.
 */
import { v } from "convex/values";
import { internalAction, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { Result } from "../../lib/contracts";
import { LIMITS, questionSlotSchema } from "../../lib/validation";
import { getMembership } from "../lib/auth";
import { err, ok } from "../lib/result";
import { enqueueBuyerTurn } from "./runtime";
import { decideBuyer } from "./engine";
import { configuredModel, AgentFailure } from "./model";
import type { RecipientResult } from "./recipient";

export const requestTurn = mutation({
  args: {
    roomId: v.id("rooms"),
    mode: v.optional(v.union(v.literal("quiet"), v.literal("auto"))),
  },
  handler: async (ctx, args): Promise<Result<{ jobId: Id<"agentJobs"> }>> => {
    const member = await getMembership(ctx, args.roomId);
    if (!member) return err("unauthorized", "Room membership required.");
    return enqueueBuyerTurn(ctx, args.roomId, member._id, args.mode ?? "quiet");
  },
});

export const answerQuestion = mutation({
  args: {
    roomId: v.id("rooms"),
    slot: v.string(),
    body: v.string(),
    clientIdempotencyKey: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Result<{ messageId: Id<"chatMessages">; jobId: Id<"agentJobs"> }>
  > => {
    const member = await getMembership(ctx, args.roomId);
    if (!member) return err("unauthorized", "Room membership required.");
    if (
      !questionSlotSchema.safeParse(args.slot).success ||
      !args.body.trim() ||
      args.body.length > LIMITS.chatBodyMaxChars ||
      !args.clientIdempotencyKey ||
      args.clientIdempotencyKey.length > 100
    )
      return err("validation_failed", "Invalid question answer.");
    const prior = await ctx.db
      .query("chatMessages")
      .withIndex("by_room_idempotency", (q) =>
        q
          .eq("roomId", args.roomId)
          .eq(
            "clientIdempotencyKey",
            `answer:${member._id}:${args.clientIdempotencyKey}`,
          ),
      )
      .first();
    if (prior) {
      const turn = await enqueueBuyerTurn(ctx, args.roomId, member._id, "auto");
      return turn.ok
        ? ok({ messageId: prior._id, jobId: turn.value.jobId })
        : turn;
    }
    const question = await ctx.db
      .query("askedSlots")
      .withIndex("by_room_slot", (q) =>
        q.eq("roomId", args.roomId).eq("slot", args.slot),
      )
      .first();
    if (!question || question.status !== "open")
      return err("invalid_revision", "This question is no longer open.");
    const messageId = await ctx.db.insert("chatMessages", {
      roomId: args.roomId,
      participantId: member._id,
      authorKind: "participant",
      body: args.body.trim(),
      createdAt: Date.now(),
      clientIdempotencyKey: `answer:${member._id}:${args.clientIdempotencyKey}`,
    });
    await ctx.db.patch(args.roomId, { latestMessageId: messageId });
    await ctx.db.patch(question._id, {
      status: "answered",
      answeredByMessageId: messageId,
    });
    const turn = await enqueueBuyerTurn(ctx, args.roomId, member._id, "auto");
    return turn.ok ? ok({ messageId, jobId: turn.value.jobId }) : turn;
  },
});

export const abandonQuestion = mutation({
  args: { roomId: v.id("rooms"), slot: v.string() },
  handler: async (ctx, args) => {
    const member = await getMembership(ctx, args.roomId);
    if (!member) return err("unauthorized", "Room membership required.");
    const question = await ctx.db
      .query("askedSlots")
      .withIndex("by_room_slot", (q) =>
        q.eq("roomId", args.roomId).eq("slot", args.slot),
      )
      .first();
    if (question?.status === "open")
      await ctx.db.patch(question._id, { status: "abandoned" });
    return ok(null);
  },
});

export const listActivity = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await getMembership(ctx, roomId);
    if (!member) return err("unauthorized", "Room membership required.");
    const events = await ctx.db
      .query("agentEvents")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .filter((q) =>
        q.or(
          q.eq(q.field("participantId"), undefined),
          q.eq(q.field("participantId"), member._id),
        ),
      )
      .order("desc")
      .take(50);
    const questions = await ctx.db
      .query("askedSlots")
      .withIndex("by_room_slot", (q) => q.eq("roomId", roomId))
      .filter((q) => q.eq(q.field("status"), "open"))
      .take(10);
    return ok({
      events: events
        .reverse()
        .map((e) => ({
          id: e._id,
          roomId: e.roomId,
          jobId: e.jobId,
          actor: e.actor,
          kind: e.kind,
          summary: e.summary,
          createdAt: e.createdAt,
        })),
      questions: questions.map((q) => ({
        slot: q.slot,
        messageId: q.messageId,
        status: q.status,
        askedAt: q.askedAt,
      })),
    });
  },
});

export const retryJob = mutation({
  args: { jobId: v.id("agentJobs") },
  handler: async (
    ctx,
    { jobId },
  ): Promise<Result<{ jobId: Id<"agentJobs"> }>> => {
    const job = await ctx.db.get(jobId);
    if (!job) return err("not_found", "Agent task not found.");
    const member = await getMembership(ctx, job.roomId);
    if (!member || job.actingParticipantId !== member._id)
      return err("unauthorized", "Only the task owner can retry.");
    if (
      !["failed", "uncertain"].includes(job.status) ||
      job.attempt >= 2 ||
      !["extract", "evaluate_thread"].includes(job.kind)
    )
      return err("invalid_revision", "This task cannot be retried.");
    await ctx.db.patch(jobId, {
      status: "pending",
      finishedAt: undefined,
      lastError: undefined,
    });
    if (job.kind === "extract")
      await ctx.scheduler.runAfter(0, internal.agents.extract.runExtraction, {
        jobId,
      });
    else
      await ctx.scheduler.runAfter(0, internal.agents.buyer.evaluateThread, {
        jobId,
      });
    return ok({ jobId });
  },
});

export const evaluateThread = internalAction({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }): Promise<null> => {
    const work = await ctx.runMutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "evaluate_thread",
    });
    if (!work?.snapshot) return null;
    try {
      const decision = await decideBuyer(work.snapshot, configuredModel());
      let recipientResult: RecipientResult | undefined;
      if (decision.intent === "query_recipient") {
        recipientResult = await ctx.runAction(
          internal.agents.recipient.queryRecipientAgent,
          {
            jobId,
            attempt: work.attempt,
            query: {
              id: `${jobId}:recipient`,
              roomId: work.job.roomId,
              askedByJobId: jobId,
              ...decision.recipientQuery,
            },
          },
        );
      }
      await ctx.runMutation(internal.agents.runtime.completeTurn, {
        jobId,
        attempt: work.attempt,
        decision,
        ...(recipientResult ? { recipientResult } : {}),
      });
    } catch (error) {
      await ctx.runMutation(internal.agents.runtime.failJob, {
        jobId,
        attempt: work.attempt,
        timedOut:
          error instanceof AgentFailure && error.code === "provider_timeout",
        code: error instanceof AgentFailure ? error.code : "unknown",
      });
    }
    return null;
  },
});
