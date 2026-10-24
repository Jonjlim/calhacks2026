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
import { modelBudgetExceeded } from "./runtime";
import { extractEvidence, fingerprint } from "./engine";
import {
  configuredModel,
  AgentFailure,
  createUsageAccumulator,
  type ImageMediaType,
} from "./model";
import { observationBody, proposePhotoClues, readPhoto } from "./photo";
import { transcribeScreenshot } from "./screenshot";
import type { PhotoObservation } from "../../lib/validation";

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

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
    if (await modelBudgetExceeded(ctx, source.roomId))
      return err(
        "refused",
        "This room has used its agent budget for the hour. Try again later.",
      );
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
    if (!work?.extraction && !work?.media) return null;
    const usage = createUsageAccumulator();
    try {
      const model = configuredModel(usage.add);
      let extraction = work.extraction;
      if (work.media) {
        const media = work.media;
        const decoded = await Promise.all(
          media.items.map(async (item) => {
            const blob = await ctx.storage.get(item.storageId);
            if (!blob) throw new AgentFailure("not_found", "Uploaded file is missing.");
            return {
              item,
              image: {
                mediaType: item.contentType as ImageMediaType,
                base64: await blobToBase64(blob),
              },
            };
          }),
        );
        let rows: Array<{ mediaIndex: number; body: string; speakerHint?: string }>;
        let observations: PhotoObservation[] = [];
        if (media.kind === "photo") {
          observations = await Promise.all(
            decoded.map(({ item, image }) =>
              readPhoto({ mediaIndex: item.mediaIndex, image, marker: item.marker }, model),
            ),
          );
          rows = observations.map((obs) => ({
            mediaIndex: obs.mediaIndex,
            body: observationBody(obs),
          }));
        } else {
          const transcripts = await Promise.all(
            decoded.map(({ image }) => transcribeScreenshot(image, model)),
          );
          rows = transcripts.flatMap((lines, i) =>
            lines.map((line) => ({
              mediaIndex: decoded[i]!.item.mediaIndex,
              body: line.body,
              ...(line.speakerHint ? { speakerHint: line.speakerHint } : {}),
            })),
          );
        }
        // Writes the text rows and deletes the files in one transaction.
        const stored = await ctx.runMutation(
          internal.agents.mediaRuntime.storeMediaRows,
          { jobId, attempt: work.attempt, rows },
        );
        if (!stored) return null;
        if (media.kind === "photo") {
          const rowIds = new Map(
            stored.flatMap((s) => (s.id ? [[s.mediaIndex, s.id] as const] : [])),
          );
          const drafts = proposePhotoClues(observations);
          const result = {
            sourceId: media.sourceId,
            clues: drafts.flatMap((draft) => {
              const ids = [
                ...new Set(
                  draft.observationIndexes.flatMap((i) => {
                    const id = rowIds.get(observations[i]!.mediaIndex);
                    return id ? [String(id)] : [];
                  }),
                ),
              ];
              return ids.length
                ? [
                    {
                      kind: draft.kind,
                      text: draft.text,
                      confidence: draft.confidence,
                      sourceMessageIds: ids,
                      speakerAssumption: draft.speakerAssumption,
                      contradictsClueIds: [],
                    },
                  ]
                : [];
            }),
          };
          await ctx.runMutation(internal.agents.runtime.completeExtraction, {
            jobId,
            attempt: work.attempt,
            result,
            modelUsage: usage.summary,
          });
          return null;
        }
        extraction = {
          sourceId: media.sourceId,
          messages: rows.flatMap((row, i) => {
            const id = stored[i]?.id;
            return id
              ? [
                  {
                    id: String(id),
                    body: row.body,
                    ...(row.speakerHint ? { speakerHint: row.speakerHint } : {}),
                  },
                ]
              : [];
          }),
          publishedClues: media.publishedClues,
        };
      }
      const result = await extractEvidence(extraction!, model);
      await ctx.runMutation(internal.agents.runtime.completeExtraction, {
        jobId,
        attempt: work.attempt,
        result,
        modelUsage: usage.summary,
      });
    } catch (error) {
      // Read-once: a failed read still deletes the uploaded files.
      await ctx.runMutation(internal.agents.mediaRuntime.discardMedia, {
        jobId,
        attempt: work.attempt,
      });
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
