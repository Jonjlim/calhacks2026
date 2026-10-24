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
import { notImplemented } from "../lib/result";

/** Contract: extractClues → { jobId }; results land on listMyProposedClues. */
export const extractClues = mutation({
  args: { sourceId: v.id("evidenceSources") },
  handler: async (_ctx, _args) => notImplemented<{ jobId: Id<"agentJobs"> }>("AI-004"),
});

export const runExtraction = internalAction({
  args: { jobId: v.id("agentJobs") },
  handler: async (_ctx, _args) => notImplemented<null>("AI-002"),
});
