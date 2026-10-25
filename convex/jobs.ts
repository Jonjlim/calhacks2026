/**
 * Job documents for agent and research work. Owner: Dev 2 (BE-012).
 * Writers: Dev 3 (agent jobs), Dev 4 (research jobs).
 *
 * External calls insert a `pending` job before the provider request. Timeouts
 * become `uncertain`, never assumed success. inputHash dedupes open jobs;
 * idempotencyKey dedupes client retries of startResearch.
 *
 * Helpers exported for other workstreams (call them inside your mutation):
 *   - enqueueAgentJob(ctx, ...)    → { jobId, created }
 *   - insertResearchJob(ctx, ...)  → { jobId, created }
 *   - agentInputHash(...)          → the evaluate_thread hash formula
 *   - isResearchJobCurrent(...)    → false once room.knowledgeRevision moved
 */
import { v } from "convex/values";
import type { JobStatus } from "../lib/contracts";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { err, memberError, ok } from "./lib/result";
import * as V from "./validators";

/** Automatic attempts per job (first run + two retries). */
export const MAX_JOB_ATTEMPTS = 3;

const OPEN_STATUSES: readonly JobStatus[] = ["pending", "running", "uncertain"];
const TERMINAL_STATUSES: readonly JobStatus[] = ["succeeded", "stale", "canceled"];

/**
 * Allowed transitions. `failed → running` is a retry and is capped by
 * MAX_JOB_ATTEMPTS. succeeded/stale/canceled are final.
 */
export function canTransition(from: JobStatus, to: JobStatus, attempt: number): boolean {
  if (from === to) return false;
  if (TERMINAL_STATUSES.includes(from)) return false;
  if (from === "failed") return to === "running" && attempt < MAX_JOB_ATTEMPTS;
  if (to === "pending") return false;
  if (to === "running") return from === "pending" || from === "uncertain";
  return true;
}

export function agentInputHash(
  roomId: Id<"rooms">,
  latestMessageId: Id<"chatMessages"> | undefined,
  knowledgeRevision: number,
): string {
  return `${roomId}:${latestMessageId ?? "none"}:${knowledgeRevision}`;
}

export async function enqueueAgentJob(
  ctx: MutationCtx,
  args: {
    roomId: Id<"rooms">;
    kind: Doc<"agentJobs">["kind"];
    inputHash: string;
    idempotencyKey: string;
    actingParticipantId?: Id<"participants">;
  },
): Promise<{ jobId: Id<"agentJobs">; created: boolean }> {
  const sameHash = await ctx.db
    .query("agentJobs")
    .withIndex("by_room_input_hash", (q) => q.eq("roomId", args.roomId).eq("inputHash", args.inputHash))
    .collect();
  const open = sameHash.find((j) => j.kind === args.kind && OPEN_STATUSES.includes(j.status));
  if (open) return { jobId: open._id, created: false };

  const jobId = await ctx.db.insert("agentJobs", {
    roomId: args.roomId,
    kind: args.kind,
    status: "pending",
    inputHash: args.inputHash,
    idempotencyKey: args.idempotencyKey,
    attempt: 0,
    actingParticipantId: args.actingParticipantId,
    createdAt: Date.now(),
  });
  return { jobId, created: true };
}

export async function insertResearchJob(
  ctx: MutationCtx,
  args: {
    roomId: Id<"rooms">;
    knowledgeRevision: number;
    publishedClueIds: Id<"publishedClues">[];
    brief?: Doc<"researchJobs">["brief"];
    inputHash: string;
    idempotencyKey: string;
    directionId?: Id<"mapDirections">;
  },
): Promise<{ jobId: Id<"researchJobs">; created: boolean }> {
  const existing = await ctx.db
    .query("researchJobs")
    .withIndex("by_room_idempotency", (q) =>
      q.eq("roomId", args.roomId).eq("idempotencyKey", args.idempotencyKey),
    )
    .first();
  if (existing) return { jobId: existing._id, created: false };

  const jobId = await ctx.db.insert("researchJobs", {
    roomId: args.roomId,
    knowledgeRevision: args.knowledgeRevision,
    publishedClueIds: args.publishedClueIds,
    brief: args.brief,
    status: "pending",
    inputHash: args.inputHash,
    idempotencyKey: args.idempotencyKey,
    attempt: 0,
    createdAt: Date.now(),
    ...(args.directionId ? { directionId: args.directionId } : {}),
  });
  return { jobId, created: true };
}

export function isResearchJobCurrent(job: Doc<"researchJobs">, room: Doc<"rooms">): boolean {
  return job.knowledgeRevision >= room.knowledgeRevision;
}

/** Room-visible job status for UI toasts (running / failed / stale). */
export const listRoomJobs = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<never>(member.code);
    const agentRows = await ctx.db
      .query("agentJobs")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .order("desc")
      .take(25);
    const researchRows = await ctx.db
      .query("researchJobs")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .order("desc")
      .take(10);
    // A newer completed search must not push unfinished work out of the UI window.
    const openResearchRows = await ctx.db.query("researchJobs")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .filter((q) => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "running"), q.eq(q.field("status"), "uncertain")))
      .order("desc")
      .take(25);
    const visibleResearch = [...new Map([...researchRows, ...openResearchRows].map((job) => [job._id, job])).values()]
      .sort((a, b) => b.createdAt - a.createdAt);
    return ok({
      // Extraction jobs reveal that someone imported evidence; only the owner sees theirs.
      agentJobs: agentRows
        .filter((j) => j.kind !== "extract" || j.actingParticipantId === member.me._id)
        .map((j) => ({ _id: j._id, kind: j.kind, status: j.status, createdAt: j.createdAt })),
      researchJobs: visibleResearch.map((j) => ({
        _id: j._id,
        status: j.status,
        createdAt: j.createdAt,
        knowledgeRevision: j.knowledgeRevision,
        directionId: j.directionId,
        lastError: j.lastError,
      })),
    });
  },
});

export const getAgentJob = internalQuery({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }) => await ctx.db.get(jobId),
});

export const getResearchJob = internalQuery({
  args: { jobId: v.id("researchJobs") },
  handler: async (ctx, { jobId }) => await ctx.db.get(jobId),
});

export const setAgentJobStatus = internalMutation({
  args: { jobId: v.id("agentJobs"), status: V.jobStatus, lastError: v.optional(v.string()) },
  handler: async (ctx, { jobId, status, lastError }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return err<null>("not_found", "Job not found.");
    if (!canTransition(job.status, status, job.attempt)) {
      return err<null>("stale_job", `Cannot move job from ${job.status} to ${status}.`);
    }
    await ctx.db.patch(jobId, {
      status,
      attempt: status === "running" ? job.attempt + 1 : job.attempt,
      lastError: lastError ?? job.lastError,
    });
    return ok(null);
  },
});

export const setResearchJobStatus = internalMutation({
  args: {
    jobId: v.id("researchJobs"),
    status: V.jobStatus,
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, status, lastError }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return err<null>("not_found", "Job not found.");
    if (!canTransition(job.status, status, job.attempt)) {
      return err<null>("stale_job", `Cannot move job from ${job.status} to ${status}.`);
    }
    await ctx.db.patch(jobId, {
      status,
      attempt: status === "running" ? job.attempt + 1 : job.attempt,
      lastError: lastError ?? job.lastError,
    });
    return ok(null);
  },
});
