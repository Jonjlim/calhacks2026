/**
 * Evidence imports, proposed clues, and published clues.
 * Owner: Dev 2 (BE-004, BE-005, BE-014). Producer of proposed clues: Dev 3.
 *
 * Privacy: evidence, private messages, and proposed clues are owner-only.
 * Published clues are room-visible. Publishing bumps room.knowledgeRevision.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { cleanText, LIMITS } from "./lib/input";
import { bumpKnowledgeRevision } from "./lib/knowledge";
import { err, memberError, ok } from "./lib/result";
import * as V from "./validators";

const EVIDENCE_LABEL_MAX_CHARS = 80;
const MAX_MESSAGES_PER_IMPORT = 500;
const SPEAKER_MAX_CHARS = 40;
// Optional "[timestamp]" prefix, then "Speaker: text".
const SPEAKER_LINE = /^(?:\[[^\]]*\]\s*)?([^:\n]{1,40}):\s+(.+)$/;

/** Splits pasted text into one private message per non-empty line. */
export function splitEvidence(rawText: string): Array<{ body: string; speakerHint?: string }> {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_MESSAGES_PER_IMPORT)
    .map((line) => {
      const match = SPEAKER_LINE.exec(line);
      const speaker = match?.[1]?.trim();
      const body = (match && speaker ? match[2]! : line).slice(0, LIMITS.chatBodyMaxChars);
      return speaker && speaker.length <= SPEAKER_MAX_CHARS ? { body, speakerHint: speaker } : { body };
    });
}

async function loadOwnedProposedClue(ctx: QueryCtx, proposedClueId: Id<"proposedClues">) {
  const clue = await ctx.db.get(proposedClueId);
  if (!clue) return { ok: false as const, code: "not_found" as const };
  const member = await requireMember(ctx, clue.roomId);
  // Non-owners get not_found so the row's existence does not leak.
  if (!member.ok || member.me._id !== clue.participantId) return { ok: false as const, code: "not_found" as const };
  return { ok: true as const, clue, member };
}

// ---------- Evidence (contributor_private) ----------

export const importEvidence = mutation({
  args: {
    roomId: v.id("rooms"),
    kind: V.evidenceKind,
    label: v.string(),
    rawText: v.string(),
  },
  handler: async (ctx, args) => {
    type Out = { source: Doc<"evidenceSources">; messages: Doc<"privateMessages">[] };
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return memberError<Out>(member.code);

    if (args.rawText.length > LIMITS.importRawTextMaxChars) {
      return err<Out>("validation_failed", "That paste is too long.");
    }
    const lines = splitEvidence(args.rawText);
    if (lines.length === 0) return err<Out>("validation_failed", "Paste at least one message.");
    const label = cleanText(args.label || "Pasted messages", EVIDENCE_LABEL_MAX_CHARS);
    if (!label) return err<Out>("validation_failed", "Label is too long.");

    const sourceId = await ctx.db.insert("evidenceSources", {
      roomId: args.roomId,
      participantId: member.me._id,
      kind: args.kind,
      label,
      sourceRevision: 1,
      createdAt: Date.now(),
    });
    const messages: Doc<"privateMessages">[] = [];
    for (const line of lines) {
      const id = await ctx.db.insert("privateMessages", {
        sourceId,
        participantId: member.me._id,
        body: line.body,
        speakerHint: line.speakerHint,
      });
      messages.push((await ctx.db.get(id))!);
    }
    return ok<Out>({ source: (await ctx.db.get(sourceId))!, messages });
  },
});

/**
 * Tombstones the source, hard-deletes its private messages, marks dependent
 * proposed clues `source_withdrawn`, and tombstones published clues that came
 * from it (dropping any attached excerpt).
 */
export const deleteEvidence = mutation({
  args: { sourceId: v.id("evidenceSources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source) return err<null>("not_found", "Evidence not found.");
    const member = await requireMember(ctx, source.roomId);
    if (!member.ok || member.me._id !== source.participantId) return err<null>("not_found", "Evidence not found.");
    if (source.deletedAt !== undefined) return ok(null);

    const now = Date.now();
    await ctx.db.patch(sourceId, { deletedAt: now, sourceRevision: source.sourceRevision + 1 });

    const messages = await ctx.db
      .query("privateMessages")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);

    let publishedChanged = false;
    const proposed = await ctx.db
      .query("proposedClues")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();
    for (const clue of proposed) {
      if (clue.status !== "rejected") {
        await ctx.db.patch(clue._id, { status: "source_withdrawn", sourceMessageIds: [] });
      }
      const published = await ctx.db
        .query("publishedClues")
        .withIndex("by_proposed_clue", (q) => q.eq("proposedClueId", clue._id))
        .collect();
      for (const pub of published) {
        await ctx.db.patch(pub._id, {
          status: pub.status === "active" ? "source_withdrawn" : pub.status,
          excerpt: undefined,
          sourceMessageIds: [],
        });
        if (pub.status === "active") publishedChanged = true;
      }
    }
    if (publishedChanged) await bumpKnowledgeRevision(ctx, source.roomId);
    return ok(null);
  },
});

export const listMyEvidence = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Doc<"evidenceSources">[]>(member.code);
    const sources = await ctx.db
      .query("evidenceSources")
      .withIndex("by_room_participant", (q) => q.eq("roomId", roomId).eq("participantId", member.me._id))
      .collect();
    return ok(sources.filter((s) => s.deletedAt === undefined));
  },
});

/** Owner-only read of one source's private messages (for the review UI). */
export const getMyEvidenceMessages = query({
  args: { sourceId: v.id("evidenceSources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source || source.deletedAt !== undefined) {
      return err<Doc<"privateMessages">[]>("not_found", "Evidence not found.");
    }
    const member = await requireMember(ctx, source.roomId);
    if (!member.ok || member.me._id !== source.participantId) {
      return err<Doc<"privateMessages">[]>("not_found", "Evidence not found.");
    }
    const messages = await ctx.db
      .query("privateMessages")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();
    return ok(messages);
  },
});

/**
 * `getOwnEvidence` tool for the extractor action (Dev 3). Returns the source
 * only when the job is an open `extract` job acting as the source's owner.
 */
export const getOwnEvidenceForJob = internalQuery({
  args: { jobId: v.id("agentJobs"), sourceId: v.id("evidenceSources") },
  handler: async (ctx, { jobId, sourceId }) => {
    type Out = {
      source: Doc<"evidenceSources">;
      messages: Doc<"privateMessages">[];
      proposedClues: Doc<"proposedClues">[];
    };
    const job = await ctx.db.get(jobId);
    const source = await ctx.db.get(sourceId);
    if (!job || !source || source.deletedAt !== undefined) return err<Out>("not_found", "Evidence not found.");
    if (job.kind !== "extract" || job.roomId !== source.roomId || job.actingParticipantId !== source.participantId) {
      return err<Out>("unauthorized", "Job may not read this evidence.");
    }
    if (job.status !== "pending" && job.status !== "running") return err<Out>("stale_job", "Job is not open.");
    const messages = await ctx.db
      .query("privateMessages")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();
    const proposedClues = await ctx.db
      .query("proposedClues")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
      .collect();
    return ok<Out>({ source, messages, proposedClues });
  },
});

// ---------- Proposed clues (contributor_private) ----------

/** Mock: lib/mocks/queries.ts myProposedCluesQuery. Caller's own clues only. */
export const listMyProposedClues = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Doc<"proposedClues">[]>(member.code);
    const clues = await ctx.db
      .query("proposedClues")
      .withIndex("by_room_participant", (q) => q.eq("roomId", roomId).eq("participantId", member.me._id))
      .collect();
    return ok(clues);
  },
});

/**
 * Write path for the extractor action (Dev 3). Verifies the job's acting
 * participant owns `sourceId`. Clues that reference messages outside the
 * source, unknown published clues, or fail basic shape checks are dropped.
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
  handler: async (ctx, { jobId, sourceId, clues }) => {
    type Out = { insertedIds: Id<"proposedClues">[]; dropped: number };
    const job = await ctx.db.get(jobId);
    const source = await ctx.db.get(sourceId);
    if (!job || !source || source.deletedAt !== undefined) return err<Out>("not_found", "Evidence not found.");
    if (job.kind !== "extract" || job.roomId !== source.roomId || job.actingParticipantId !== source.participantId) {
      return err<Out>("unauthorized", "Job may not write clues for this evidence.");
    }
    if (job.status !== "pending" && job.status !== "running") return err<Out>("stale_job", "Job is not open.");

    const messageIds = new Set(
      (
        await ctx.db
          .query("privateMessages")
          .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
          .collect()
      ).map((m) => m._id),
    );
    const insertedIds: Id<"proposedClues">[] = [];
    let dropped = 0;
    const now = Date.now();
    for (const clue of clues) {
      const text = cleanText(clue.text, LIMITS.clueTextMaxChars);
      const validConfidence = Number.isFinite(clue.confidence) && clue.confidence >= 0 && clue.confidence <= 1;
      const messagesOk = clue.sourceMessageIds.every((id) => messageIds.has(id));
      let contradictionsOk = true;
      for (const id of clue.contradictsClueIds) {
        const pub = await ctx.db.get(id);
        if (!pub || pub.roomId !== source.roomId) contradictionsOk = false;
      }
      if (!text || !validConfidence || !messagesOk || !contradictionsOk) {
        dropped += 1;
        continue;
      }
      insertedIds.push(
        await ctx.db.insert("proposedClues", {
          roomId: source.roomId,
          participantId: source.participantId,
          sourceId,
          sourceMessageIds: clue.sourceMessageIds,
          kind: clue.kind,
          text,
          confidence: clue.confidence,
          speakerAssumption: clue.speakerAssumption,
          contradictsClueIds: clue.contradictsClueIds,
          status: "proposed",
          createdAt: now,
        }),
      );
    }
    return ok<Out>({ insertedIds, dropped });
  },
});

/** Contributor corrects text, kind, or speaker before publishing. */
export const editProposedClue = mutation({
  args: {
    proposedClueId: v.id("proposedClues"),
    text: v.optional(v.string()),
    kind: v.optional(V.clueKind),
    speakerAssumption: v.optional(V.speakerAssumption),
  },
  handler: async (ctx, args) => {
    const loaded = await loadOwnedProposedClue(ctx, args.proposedClueId);
    if (!loaded.ok) return err<Doc<"proposedClues">>("not_found", "Clue not found.");
    const { clue } = loaded;
    if (clue.status !== "proposed" && clue.status !== "edited") {
      return err<Doc<"proposedClues">>("validation_failed", "Only unpublished clues can be edited.");
    }
    const text = args.text === undefined ? clue.text : cleanText(args.text, LIMITS.clueTextMaxChars);
    if (!text) return err<Doc<"proposedClues">>("validation_failed", "Clue text is empty or too long.");
    await ctx.db.patch(clue._id, {
      text,
      kind: args.kind ?? clue.kind,
      speakerAssumption: args.speakerAssumption ?? clue.speakerAssumption,
      status: "edited",
    });
    return ok((await ctx.db.get(clue._id))!);
  },
});

export const rejectProposedClue = mutation({
  args: { proposedClueId: v.id("proposedClues") },
  handler: async (ctx, { proposedClueId }) => {
    const loaded = await loadOwnedProposedClue(ctx, proposedClueId);
    if (!loaded.ok) return err<Doc<"proposedClues">>("not_found", "Clue not found.");
    const { clue } = loaded;
    if (clue.status === "rejected") return ok(clue);
    if (clue.status !== "proposed" && clue.status !== "edited") {
      return err<Doc<"proposedClues">>("validation_failed", "Only unpublished clues can be rejected.");
    }
    await ctx.db.patch(clue._id, { status: "rejected" });
    return ok((await ctx.db.get(clue._id))!);
  },
});

// ---------- Published clues (public_room) ----------

/**
 * Mock: lib/mocks/queries.ts publishedCluesQuery. Returns active clues and
 * `source_withdrawn` tombstones; withdrawn clues are hidden.
 */
export const listPublishedClues = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Doc<"publishedClues">[]>(member.code);
    const clues = await ctx.db
      .query("publishedClues")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    return ok(clues.filter((c) => c.status !== "withdrawn"));
  },
});

export const publishClue = mutation({
  args: { proposedClueId: v.id("proposedClues"), excerpt: v.optional(v.string()) },
  handler: async (ctx, { proposedClueId, excerpt: rawExcerpt }) => {
    const loaded = await loadOwnedProposedClue(ctx, proposedClueId);
    if (!loaded.ok) return err<Doc<"publishedClues">>("not_found", "Clue not found.");
    const { clue, member } = loaded;

    if (clue.status === "published") {
      const existing = await ctx.db
        .query("publishedClues")
        .withIndex("by_proposed_clue", (q) => q.eq("proposedClueId", clue._id))
        .first();
      if (existing) return ok(existing);
    }
    if (clue.status !== "proposed" && clue.status !== "edited") {
      return err<Doc<"publishedClues">>("validation_failed", "This clue can no longer be published.");
    }
    const source = await ctx.db.get(clue.sourceId);
    if (!source || source.deletedAt !== undefined) {
      return err<Doc<"publishedClues">>("not_found", "The source for this clue was deleted.");
    }
    let excerpt: string | undefined;
    if (rawExcerpt !== undefined && rawExcerpt.trim() !== "") {
      excerpt = cleanText(rawExcerpt, LIMITS.excerptMaxChars) ?? undefined;
      if (!excerpt) return err<Doc<"publishedClues">>("validation_failed", "Excerpt is too long.");
    }

    const publishedId = await ctx.db.insert("publishedClues", {
      roomId: clue.roomId,
      proposedClueId: clue._id,
      publisherId: member.me._id,
      kind: clue.kind,
      text: clue.text,
      sourceKind: source.kind === "text_export" ? "import" : "paste",
      sourceMessageIds: clue.sourceMessageIds,
      excerpt,
      status: "active",
      publishedAt: Date.now(),
    });
    await ctx.db.patch(clue._id, { status: "published" });
    await bumpKnowledgeRevision(ctx, clue.roomId);
    return ok((await ctx.db.get(publishedId))!);
  },
});

export const withdrawClue = mutation({
  args: { publishedClueId: v.id("publishedClues") },
  handler: async (ctx, { publishedClueId }) => {
    const clue = await ctx.db.get(publishedClueId);
    if (!clue) return err<Doc<"publishedClues">>("not_found", "Clue not found.");
    const member = await requireMember(ctx, clue.roomId);
    if (!member.ok) return memberError<Doc<"publishedClues">>(member.code);
    if (member.me._id !== clue.publisherId) {
      return err<Doc<"publishedClues">>("unauthorized", "Only the publisher can withdraw this clue.");
    }
    if (clue.status === "withdrawn") return ok(clue);
    await ctx.db.patch(clue._id, { status: "withdrawn" });
    await bumpKnowledgeRevision(ctx, clue.roomId);
    return ok((await ctx.db.get(clue._id))!);
  },
});

/**
 * BE-014: manual room clue without an import (`sourceKind: "manual"`).
 * LLM-down fallback. Re-submitting the same kind + text returns the existing clue.
 */
export const upsertManualPreference = mutation({
  args: { roomId: v.id("rooms"), kind: V.clueKind, text: v.string() },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return memberError<Doc<"publishedClues">>(member.code);
    const text = cleanText(args.text, LIMITS.clueTextMaxChars);
    if (!text) return err<Doc<"publishedClues">>("validation_failed", "Clue text is empty or too long.");

    const roomClues = await ctx.db
      .query("publishedClues")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    const existing = roomClues.find(
      (c) =>
        c.status === "active" &&
        c.sourceKind === "manual" &&
        c.kind === args.kind &&
        c.text.toLowerCase() === text.toLowerCase(),
    );
    if (existing) return ok(existing);

    const id = await ctx.db.insert("publishedClues", {
      roomId: args.roomId,
      publisherId: member.me._id,
      kind: args.kind,
      text,
      sourceKind: "manual",
      sourceMessageIds: [],
      status: "active",
      publishedAt: Date.now(),
    });
    await bumpKnowledgeRevision(ctx, args.roomId);
    return ok((await ctx.db.get(id))!);
  },
});
