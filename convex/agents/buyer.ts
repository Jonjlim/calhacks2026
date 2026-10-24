/**
 * Buyer agent (in-room facilitator). Owner: Dev 3 (AI-003, AI-005, AI-007).
 *
 * Returns a validated AgentDecision and applies at most one effect.
 * Defaults to `listen`. Writes `stale` and applies nothing if the room's
 * latest message or knowledgeRevision moved since the job's inputHash.
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { notImplemented } from "../lib/result";

export const evaluateThread = internalAction({
  args: { jobId: v.id("agentJobs") },
  handler: async (_ctx, _args) => notImplemented<null>("AI-007"),
});
