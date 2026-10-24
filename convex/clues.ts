/**
 * Evidence imports, proposed clues, and published clues.
 * Owner: Dev 2 (BE-004, BE-005, BE-014). Producer of proposed clues: Dev 3.
 *
 * Privacy: evidence, private messages, and proposed clues are owner-only.
 * Published clues are room-visible. Publishing bumps room.knowledgeRevision.
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { notImplemented } from "./lib/result";
import * as V from "./validators";

// ---------- Evidence (contributor_private) ----------

export const importEvidence = mutation({
  args: {
    roomId: v.id("rooms"),
    kind: V.evidenceKind,
    label: v.string(),
    rawText: v.string(),
  },
  handler: async (_ctx, _args) =>
    notImplemented<{
      source: Doc<"evidenceSources">;
      messages: Doc<"privateMessages">[];
    }>("BE-004"),
});

/** Tombstones the source and marks dependent clues `source_withdrawn`. */
export const deleteEvidence = mutation({
  args: { sourceId: v.id("evidenceSources") },
  handler: async (_ctx, _args) => notImplemented<null>("BE-004"),
});

export const listMyEvidence = query({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) => notImplemented<Doc<"evidenceSources">[]>("BE-004"),
});

// ---------- Proposed clues (contributor_private) ----------

/** Mock: lib/mocks/queries.ts myProposedCluesQuery. */
export const listMyProposedClues = query({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) => notImplemented<Doc<"proposedClues">[]>("BE-005"),
});

/**
 * Write path for the extractor action (Dev 3). Must verify the job's acting
 * participant owns `sourceId` and that clues already passed Zod validation.
 */
export const insertProposedClues = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    sourceId: v.id("evidenceSources"),
    clues: v.array(
      v.object({
        kind: V.clueKind,
        text: v.string(),
        confidence: v.number(),
        sourceMessageIds: v.array(v.id("privateMessages")),
        speakerAssumption: V.speakerAssumption,
        contradictsClueIds: v.array(v.id("publishedClues")),
      }),
    ),
  },
  handler: async (_ctx, _args) => notImplemented<Id<"proposedClues">[]>("BE-005"),
});

// ---------- Published clues (public_room) ----------

/** Mock: lib/mocks/queries.ts publishedCluesQuery. */
export const listPublishedClues = query({
  args: { roomId: v.id("rooms") },
  handler: async (_ctx, _args) => notImplemented<Doc<"publishedClues">[]>("BE-005"),
});

export const publishClue = mutation({
  args: { proposedClueId: v.id("proposedClues"), excerpt: v.optional(v.string()) },
  handler: async (_ctx, _args) => notImplemented<Doc<"publishedClues">>("BE-005"),
});

export const withdrawClue = mutation({
  args: { publishedClueId: v.id("publishedClues") },
  handler: async (_ctx, _args) => notImplemented<Doc<"publishedClues">>("BE-005"),
});

/** Manual room clue without an import (`sourceKind: "manual"`). LLM-down fallback. */
export const upsertManualPreference = mutation({
  args: { roomId: v.id("rooms"), kind: V.clueKind, text: v.string() },
  handler: async (_ctx, _args) => notImplemented<Doc<"publishedClues">>("BE-014"),
});
