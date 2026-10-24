/**
 * Clue extraction. Owner: Dev 3 (AI-002, AI-004).
 *
 * The extractor sees only the caller's own evidence and may only write
 * ProposedClues for that caller (via internal.clues.insertProposedClues).
 * Model output is validated with Zod before any write. Extraction never publishes.
 */
import { v } from "convex/values";
import { internalAction, mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { Result } from "../../lib/contracts";
import { getMembership } from "../lib/auth";
import { err, ok } from "../lib/result";
import { extractEvidence, fingerprint } from "./engine";
import { configuredModel, AgentFailure, createUsageAccumulator } from "./model";

/** Contract: extractClues → { jobId }; results land on listMyProposedClues. */
export const extractClues = mutation({
  args: { sourceId: v.id("evidenceSources") },
  handler: async (
    ctx,
    { sourceId },
  ): Promise<Result<{ jobId: Id<"agentJobs"> }>> => {
    const source = await ctx.db.get(sourceId);
    if (!source || source.deletedAt !== undefined)
      return err("not_found", "Evidence source not found.");
    const member = await getMembership(ctx, source.roomId);
    if (!member || member._id !== source.participantId)
      return err(
        "unauthorized",
        "Only the contributor can analyze this evidence.",
      );
    const room = await ctx.db.get(source.roomId);
    if (!room) return err("not_found", "Room not found.");
    const inputHash = fingerprint({
      kind: "extract",
      sourceId,
      sourceRevision: source.sourceRevision,
    });
    const prior = await ctx.db
      .query("agentJobs")
      .withIndex("by_room_input_hash", (q) =>
        q.eq("roomId", source.roomId).eq("inputHash", inputHash),
      )
      .first();
    if (prior) return ok({ jobId: prior._id });
    const jobId = await ctx.db.insert("agentJobs", {
      roomId: source.roomId,
      actingParticipantId: member._id,
      kind: "extract",
      status: "pending",
      attempt: 0,
      sourceId,
      sourceRevision: source.sourceRevision,
      knowledgeRevision: room.knowledgeRevision,
      inputHash,
      idempotencyKey: `extract:${inputHash}`,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.agents.extract.runExtraction, {
      jobId,
    });
    return ok({ jobId });
  },
});

export const runExtraction = internalAction({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }): Promise<null> => {
    const work = await ctx.runMutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "extract",
    });
    if (!work?.extraction) return null;
    const usage = createUsageAccumulator();
    try {
      const result = await extractEvidence(
        work.extraction,
        configuredModel(usage.add),
      );
      await ctx.runMutation(internal.agents.runtime.completeExtraction, {
        jobId,
        attempt: work.attempt,
        result,
        modelUsage: usage.summary,
      });
    } catch (error) {
      await ctx.runMutation(internal.agents.runtime.failJob, {
        jobId,
        attempt: work.attempt,
        timedOut:
          error instanceof AgentFailure && error.code === "provider_timeout",
        code: error instanceof AgentFailure ? error.code : "unknown",
        modelUsage: usage.summary,
      });
    }
    return null;
  },
});
