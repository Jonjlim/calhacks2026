/**
 * Persistence for media reads. Owner: Dev 3 (AI-018, AI-016).
 *
 * The action reads each stored file once, then calls storeMediaRows, which
 * writes the text rows and deletes the files in one transaction. After that
 * the pixels are gone; only the reviewable text rows remain, owner-only.
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { LIMITS } from "../lib/input";
import { discardSourceMedia } from "../media";

export interface MediaWork {
  sourceId: Id<"evidenceSources">;
  kind: "photo" | "screenshot";
  items: Array<{
    mediaIndex: number;
    storageId: Id<"_storage">;
    contentType: string;
    marker?: { x: number; y: number };
  }>;
  publishedClues: Array<{ id: string; kind: string; text: string }>;
}

const MAX_MEDIA_ROWS = 90;

async function ownedRunningJob(
  ctx: { db: { get: (id: Id<"agentJobs">) => Promise<Doc<"agentJobs"> | null> } },
  jobId: Id<"agentJobs">,
  attempt: number,
) {
  const job = await ctx.db.get(jobId);
  return job && job.kind === "extract" && job.status === "running" && job.attempt === attempt && job.sourceId
    ? job
    : null;
}

export const storeMediaRows = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    attempt: v.number(),
    rows: v.array(
      v.object({
        mediaIndex: v.number(),
        body: v.string(),
        speakerHint: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Array<{ id: Id<"privateMessages"> | null; mediaIndex: number }> | null> => {
    const job = await ownedRunningJob(ctx, args.jobId, args.attempt);
    if (!job) return null;
    const source = await ctx.db.get(job.sourceId!);
    if (
      !source ||
      source.deletedAt !== undefined ||
      source.participantId !== job.actingParticipantId ||
      source.sourceRevision !== job.sourceRevision
    ) {
      // Withdrawn or replaced mid-read: drop the files and write nothing.
      if (source) await discardSourceMedia(ctx, source._id, "deleted");
      return null;
    }
    /** Aligned with args.rows; null where a row was empty or over the cap. */
    const stored: Array<{ id: Id<"privateMessages"> | null; mediaIndex: number }> = [];
    for (const [i, row] of args.rows.entries()) {
      const body = row.body.trim().slice(0, LIMITS.chatBodyMaxChars);
      if (!body || i >= MAX_MEDIA_ROWS) {
        stored.push({ id: null, mediaIndex: row.mediaIndex });
        continue;
      }
      const id = await ctx.db.insert("privateMessages", {
        sourceId: source._id,
        participantId: source.participantId,
        body,
        mediaIndex: row.mediaIndex,
        ...(row.speakerHint ? { speakerHint: row.speakerHint.slice(0, 40) } : {}),
      });
      stored.push({ id, mediaIndex: row.mediaIndex });
    }
    await discardSourceMedia(ctx, source._id, "read");
    return stored;
  },
});

/** Failure path: delete the files and mark the source failed. Writes no rows. */
export const discardMedia = internalMutation({
  args: { jobId: v.id("agentJobs"), attempt: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const job = await ownedRunningJob(ctx, args.jobId, args.attempt);
    if (job) await discardSourceMedia(ctx, job.sourceId!, "failed");
    return null;
  },
});
