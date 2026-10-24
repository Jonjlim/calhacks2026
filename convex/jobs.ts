/**
 * Job documents for agent and research work. Owner: Dev 2 (BE-012).
 * Writers: Dev 3 (agent jobs), Dev 4 (research jobs).
 *
 * External calls insert a `pending` job before the provider request. Timeouts
 * become `uncertain`, never assumed success. inputHash dedupes open jobs.
 */
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { notImplemented } from "./lib/result";
import * as V from "./validators";

/** Room-visible job status for UI toasts (running / failed / stale). */
export const listRoomJobs = query({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) =>
    notImplemented<{
      agentJobs: Array<Pick<Doc<"agentJobs">, "_id" | "kind" | "status" | "createdAt">>;
      researchJobs: Array<Pick<Doc<"researchJobs">, "_id" | "status" | "createdAt">>;
    }>("BE-012"),
});

export const setAgentJobStatus = internalMutation({
  args: { jobId: v.id("agentJobs"), status: V.jobStatus, lastError: v.optional(v.string()) },
  handler: async (_ctx, _args) => notImplemented<null>("BE-012"),
});

export const setResearchJobStatus = internalMutation({
  args: {
    jobId: v.id("researchJobs"),
    status: V.jobStatus,
    lastError: v.optional(v.string()),
  },
  handler: async (_ctx, _args) => notImplemented<null>("BE-012"),
});
