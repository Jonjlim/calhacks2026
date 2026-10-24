import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  agentDecisionSchema,
  agentReplySchema,
  extractionResultSchema,
} from "../../lib/validation";
import type { AgentEvent, Result } from "../../lib/contracts";
import { err, ok } from "../lib/result";
import {
  fingerprint,
  validateDecision,
  type BuyerSnapshot,
  type ExtractionInput,
} from "./engine";
import { RECIPIENT_GUIDANCE } from "./recipientPolicy";
import { readCatalog } from "../research/catalog";
import { renderRecommendation, researchStatusMessage } from "./presentation";
import { agentModelUsage } from "../validators";

type AgentJob = Doc<"agentJobs">;
export async function recordEvent(
  ctx: MutationCtx,
  job: AgentJob,
  actor: AgentEvent["actor"],
  kind: AgentEvent["kind"],
  summary: string,
  citations?: Doc<"chatMessages">["citations"],
): Promise<void> {
  await ctx.db.insert("agentEvents", {
    roomId: job.roomId,
    jobId: job._id,
    actor,
    kind,
    summary,
    ...(job.kind === "extract"
      ? { participantId: job.actingParticipantId }
      : {}),
    createdAt: Date.now(),
    ...(citations ? { citations } : {}),
  });
}

export async function readBuyerSnapshot(
  ctx: QueryCtx,
  job: AgentJob,
): Promise<BuyerSnapshot | null> {
  const room = await ctx.db.get(job.roomId);
  const member = job.actingParticipantId
    ? await ctx.db.get(job.actingParticipantId)
    : null;
  if (!room || !member || member.roomId !== room._id) return null;
  const messages = await ctx.db
    .query("chatMessages")
    .withIndex("by_room", (q) => q.eq("roomId", room._id))
    .order("desc")
    .take(30);
  const catalog = await readCatalog(ctx, room);
  const askedSlots = await ctx.db
    .query("askedSlots")
    .withIndex("by_room_slot", (q) => q.eq("roomId", room._id))
    .take(50);
  const previous = await ctx.db
    .query("agentDecisions")
    .withIndex("by_room", (q) => q.eq("roomId", room._id))
    .filter((q) => q.eq(q.field("intent"), "recommend"))
    .order("desc")
    .first();
  const chronological = messages.reverse();
  return {
    roomId: room._id,
    jobId: job._id,
    recipientDisplayName: room.recipientDisplayName,
    occasion: room.occasion,
    budgetMinor: room.budgetMinor,
    deadlineAt: room.deadlineAt,
    knowledgeRevision: room.knowledgeRevision,
    latestMessageId: chronological
      .filter((m) => m.authorKind === "participant")
      .at(-1)?._id,
    mode: job.mode ?? "quiet",
    trigger: job.trigger ?? "human",
    ...(job.researchJobId ? { researchJobId: job.researchJobId } : {}),
    recipientAgentEnabled:
      !!room.recipientProfileId &&
      process.env.RECIPIENT_AGENT_DEMO_ENABLED === "true",
    recentMessages: chronological.map((m) => ({
      id: m._id,
      author: m.authorKind,
      text: m.body,
    })),
    publishedClues: catalog.clues.map((c) => ({
      id: c.id,
      kind: c.kind,
      text: c.text,
    })),
    askedSlots: askedSlots.map((s) => ({ slot: s.slot, status: s.status })),
    listings: catalog.listings.map((l) => ({
      id: l.id,
      title: l.title,
      ...(l.priceMinor !== undefined ? { priceMinor: l.priceMinor } : {}),
      sourceUrl: l.sourceUrl,
      retrievedAt: l.retrievedAt,
      priceStatus: l.priceStatus,
      availability: l.availability,
      shippingStatus: l.shippingStatus,
      ...(l.shippingMinor !== undefined
        ? { shippingMinor: l.shippingMinor }
        : {}),
    })),
    recommendations: catalog.recommendations.map((r) => ({
      listingId: r.listingId,
      publishedClueIds: r.publishedClueIds,
      explanation: r.explanation,
    })),
    researchRunning:
      !!catalog.latestRequest &&
      catalog.latestRequest.knowledgeRevision === room.knowledgeRevision &&
      ["pending", "running", "uncertain"].includes(
        catalog.latestRequest.status,
      ),
    ...(catalog.latestRequest
      ? {
          research: {
            jobId: catalog.latestRequest._id,
            status: catalog.latestRequest.status,
            ...(catalog.candidatePool
              ? {
                  poolJobId: catalog.candidatePool._id,
                  poolKnowledgeRevision:
                    catalog.candidatePool.knowledgeRevision,
                }
              : {}),
          },
        }
      : {}),
    excluded: catalog.excluded,
    previousRecommendationListingIds: previous?.citations?.listingIds ?? [],
  };
}

export function buyerInputVersion(snapshot: BuyerSnapshot): string {
  // Immutable chat/clue IDs replace message text so the indexed version token stays bounded.
  return fingerprint({
    roomId: snapshot.roomId,
    mode: snapshot.mode,
    trigger: snapshot.trigger ?? "human",
    researchJobId: snapshot.researchJobId,
    recipient: snapshot.recipientDisplayName,
    occasion: snapshot.occasion,
    budget: snapshot.budgetMinor,
    deadline: snapshot.deadlineAt,
    revision: snapshot.knowledgeRevision,
    messages: snapshot.recentMessages.map((m) => m.id),
    slots: snapshot.askedSlots,
    listings: snapshot.listings,
    recommendations: snapshot.recommendations.map((r) => [
      r.listingId,
      r.publishedClueIds,
    ]),
    researchRunning: snapshot.researchRunning,
    recipientEnabled: snapshot.recipientAgentEnabled,
    research: snapshot.research,
    excluded: snapshot.excluded,
  });
}

/** A bounded lookup key; compare the full inputVersion as well, so collisions cannot accept stale work. */
export function buyerInputHash(snapshot: BuyerSnapshot): string {
  const version = buyerInputVersion(snapshot);
  let first = 2166136261;
  let second = 3339675911;
  for (let i = 0; i < version.length; i++) {
    first = Math.imul(first ^ version.charCodeAt(i), 16777619);
    second = Math.imul(second ^ version.charCodeAt(i), 2246822519);
  }
  return `${first >>> 0}:${second >>> 0}`;
}

/** Dev 2 may call this after storing a human chat message in the same transaction. */
export async function enqueueBuyerTurn(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  participantId: Id<"participants">,
  mode: "quiet" | "auto" = "quiet",
  options: {
    trigger?: "human" | "research_completed" | "knowledge_changed";
    researchJobId?: Id<"researchJobs">;
    delayMs?: number;
  } = {},
): Promise<Result<{ jobId: Id<"agentJobs"> }>> {
  const room = await ctx.db.get(roomId);
  const member = await ctx.db.get(participantId);
  if (!room || !member || member.roomId !== roomId)
    return err("unauthorized", "Room membership required.");
  // Insert then read the exact permitted snapshot. Duplicate drafts are deleted in the same transaction.
  const jobId = await ctx.db.insert("agentJobs", {
    roomId,
    actingParticipantId: participantId,
    kind: "evaluate_thread",
    status: "pending",
    mode,
    trigger: options.trigger ?? "human",
    ...(options.researchJobId ? { researchJobId: options.researchJobId } : {}),
    attempt: 0,
    inputHash: "",
    idempotencyKey: "",
    createdAt: Date.now(),
  });
  const job = (await ctx.db.get(jobId))!;
  const snapshot = (await readBuyerSnapshot(ctx, job))!;
  const inputHash = buyerInputHash(snapshot);
  const inputVersion = buyerInputVersion(snapshot);
  const prior = await ctx.db
    .query("agentJobs")
    .withIndex("by_room_input_hash", (q) =>
      q.eq("roomId", roomId).eq("inputHash", inputHash),
    )
    .filter((q) => q.eq(q.field("inputVersion"), inputVersion))
    .first();
  if (prior) {
    await ctx.db.delete(jobId);
    return ok({ jobId: prior._id });
  }
  await ctx.db.patch(jobId, {
    inputHash,
    inputVersion,
    idempotencyKey: `buyer:${jobId}`,
    latestMessageId: snapshot.latestMessageId
      ? (ctx.db.normalizeId("chatMessages", snapshot.latestMessageId) ??
        undefined)
      : undefined,
    knowledgeRevision: room.knowledgeRevision,
  });
  await ctx.scheduler.runAfter(
    options.delayMs ?? 0,
    internal.agents.buyer.evaluateThread,
    {
      jobId,
    },
  );
  return ok({ jobId });
}

/** Completion hook shared with Dev 4. Runs in the same transaction as research settlement. */
export async function enqueueResearchContinuation(
  ctx: MutationCtx,
  researchJobId: Id<"researchJobs">,
): Promise<Id<"agentJobs"> | null> {
  const research = await ctx.db.get(researchJobId);
  if (
    !research ||
    !["succeeded", "failed", "uncertain"].includes(research.status)
  )
    return null;
  if (research.continuationAgentJobId) return research.continuationAgentJobId;
  const room = await ctx.db.get(research.roomId);
  const latest = await ctx.db
    .query("researchJobs")
    .withIndex("by_room", (q) => q.eq("roomId", research.roomId))
    .order("desc")
    .first();
  if (
    !room ||
    latest?._id !== research._id ||
    room.knowledgeRevision !== research.knowledgeRevision ||
    room.latestMessageId !== research.latestMessageId ||
    !research.actingParticipantId
  )
    return null;
  const result = await enqueueBuyerTurn(
    ctx,
    room._id,
    research.actingParticipantId,
    "auto",
    { trigger: "research_completed", researchJobId },
  );
  if (!result.ok) return null;
  await ctx.db.patch(researchJobId, {
    continuationAgentJobId: result.value.jobId,
  });
  const job = (await ctx.db.get(result.value.jobId))!;
  await recordEvent(
    ctx,
    job,
    "research_planner",
    "handoff",
    research.status === "succeeded"
      ? "Product research returned; reviewing the sourced options."
      : "Product research needs attention; preparing an update.",
  );
  return result.value.jobId;
}

/** Cached replanning only. Rapid clue changes supersede earlier jobs before any model call. */
export async function enqueueKnowledgeTurn(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
): Promise<void> {
  const latestSuccess = await ctx.db
    .query("researchJobs")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .filter((q) => q.eq(q.field("status"), "succeeded"))
    .order("desc")
    .first();
  if (!latestSuccess) return;
  const room = await ctx.db.get(roomId);
  if (!room) return;
  // Prefer the person who requested the pool; never assume organizer authority for an agent.
  let participantId = latestSuccess.actingParticipantId;
  if (!participantId) {
    const last = room.latestMessageId
      ? await ctx.db.get(room.latestMessageId)
      : null;
    participantId = last?.participantId;
  }
  if (!participantId) return;
  await enqueueBuyerTurn(ctx, roomId, participantId, "auto", {
    trigger: "knowledge_changed",
    delayMs: 350,
  });
}

async function isCurrent(ctx: QueryCtx, job: AgentJob): Promise<boolean> {
  if (job.kind === "evaluate_thread") {
    const snapshot = await readBuyerSnapshot(ctx, job);
    return (
      !!snapshot &&
      (job.trigger !== "research_completed" ||
        snapshot.research?.jobId === job.researchJobId) &&
      buyerInputHash(snapshot) === job.inputHash &&
      buyerInputVersion(snapshot) === job.inputVersion
    );
  }
  if (job.kind !== "extract" || !job.sourceId || !job.actingParticipantId)
    return false;
  const source = await ctx.db.get(job.sourceId);
  const member = await ctx.db.get(job.actingParticipantId);
  const room = await ctx.db.get(job.roomId);
  return (
    !!source &&
    source.deletedAt === undefined &&
    !!member &&
    !!room &&
    member.roomId === job.roomId &&
    source.roomId === job.roomId &&
    source.participantId === member._id &&
    source.sourceRevision === job.sourceRevision
  );
}

async function markStale(ctx: MutationCtx, job: AgentJob): Promise<void> {
  await ctx.db.patch(job._id, { status: "stale", finishedAt: Date.now() });
  await recordEvent(
    ctx,
    job,
    job.kind === "extract" ? "extractor" : "buyer",
    "stale",
    "New information replaced this agent task.",
  );
}

export type ClaimedWork = {
  attempt: number;
  job: AgentJob;
  snapshot?: BuyerSnapshot;
  extraction?: ExtractionInput;
};
export const claimJob = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    kind: v.union(v.literal("extract"), v.literal("evaluate_thread")),
  },
  handler: async (ctx, { jobId, kind }): Promise<ClaimedWork | null> => {
    const job = await ctx.db.get(jobId);
    if (
      !job ||
      job.kind !== kind ||
      job.status !== "pending" ||
      job.attempt >= 2
    )
      return null;
    if (!(await isCurrent(ctx, job))) {
      await markStale(ctx, job);
      return null;
    }
    const attempt = job.attempt + 1;
    await ctx.db.patch(jobId, {
      status: "running",
      attempt,
      startedAt: Date.now(),
      lastError: undefined,
      finishedAt: undefined,
    });
    await recordEvent(
      ctx,
      job,
      kind === "extract" ? "extractor" : "buyer",
      "started",
      kind === "extract"
        ? "Reading your selected evidence."
        : "Reviewing the group's gift brief.",
    );
    await ctx.scheduler.runAfter(90_000, internal.agents.runtime.expireJob, {
      jobId,
      attempt,
    });
    if (kind === "evaluate_thread")
      return { attempt, job, snapshot: (await readBuyerSnapshot(ctx, job))! };
    const rows = await ctx.db
      .query("privateMessages")
      .withIndex("by_source", (q) => q.eq("sourceId", job.sourceId!))
      .take(201);
    // No partial transcripts: an oversized import fails rather than silently dropping relevant exclusions.
    if (
      rows.length > 200 ||
      rows.reduce((n, row) => n + row.body.length, 0) > 20_000 ||
      rows.some((row) => row.participantId !== job.actingParticipantId)
    ) {
      await ctx.db.patch(jobId, {
        status: "failed",
        lastError: "Selected evidence exceeds the supported import limits.",
        finishedAt: Date.now(),
      });
      await recordEvent(
        ctx,
        job,
        "extractor",
        "failed",
        "Selected evidence could not be processed.",
      );
      return null;
    }
    const clues = await ctx.db
      .query("publishedClues")
      .withIndex("by_room", (q) => q.eq("roomId", job.roomId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .take(100);
    return {
      attempt,
      job,
      extraction: {
        sourceId: job.sourceId!,
        messages: rows.map((m) => ({
          id: m._id,
          body: m.body,
          ...(m.speakerHint ? { speakerHint: m.speakerHint } : {}),
        })),
        publishedClues: clues.map((c) => ({
          id: c._id,
          text: c.text,
          kind: c.kind,
        })),
      },
    };
  },
});

export const expireJob = internalMutation({
  args: { jobId: v.id("agentJobs"), attempt: v.number() },
  handler: async (ctx, { jobId, attempt }): Promise<null> => {
    const job = await ctx.db.get(jobId);
    if (job?.status === "running" && job.attempt === attempt) {
      await ctx.db.patch(jobId, {
        status: "uncertain",
        lastError: "Agent task did not finish in time. Retry is available.",
        finishedAt: Date.now(),
      });
      await recordEvent(
        ctx,
        job,
        job.kind === "extract" ? "extractor" : "buyer",
        "failed",
        "Agent task timed out; no result was applied.",
      );
    }
    return null;
  },
});

export const failJob = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    attempt: v.number(),
    timedOut: v.boolean(),
    code: v.string(),
    modelUsage: v.optional(agentModelUsage),
  },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "running" || job.attempt !== args.attempt)
      return null;
    // Never persist raw exception messages; errors can contain prompts, secrets, or provider payloads.
    await ctx.db.patch(job._id, {
      status: args.timedOut ? "uncertain" : "failed",
      lastError:
        args.code === "validation_failed"
          ? "Agent output could not be validated."
          : "Agent task could not finish. Check provider configuration or retry.",
      finishedAt: Date.now(),
      ...(args.modelUsage ? { modelUsage: args.modelUsage } : {}),
    });
    await recordEvent(
      ctx,
      job,
      job.kind === "extract" ? "extractor" : "buyer",
      "failed",
      "Agent task could not finish; no result was applied.",
    );
    return null;
  },
});

export const completeExtraction = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    attempt: v.number(),
    result: v.any(),
    modelUsage: v.optional(agentModelUsage),
  },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.kind !== "extract" ||
      job.status !== "running" ||
      job.attempt !== args.attempt
    )
      return null;
    if (args.modelUsage)
      await ctx.db.patch(job._id, { modelUsage: args.modelUsage });
    if (!(await isCurrent(ctx, job))) {
      await markStale(ctx, job);
      return null;
    }
    const result = extractionResultSchema.parse(args.result as unknown);
    if (result.sourceId !== job.sourceId)
      throw new Error("Extraction source mismatch");
    const rows = await ctx.db
      .query("privateMessages")
      .withIndex("by_source", (q) => q.eq("sourceId", job.sourceId!))
      .take(200);
    const byId = new Map(rows.map((m) => [String(m._id), m]));
    for (const clue of result.clues) {
      const messageIds: Id<"privateMessages">[] = [];
      for (const id of clue.sourceMessageIds) {
        const row = byId.get(id);
        if (!row || row.participantId !== job.actingParticipantId)
          throw new Error("Extraction citation mismatch");
        messageIds.push(row._id);
      }
      const contradictsClueIds: Id<"publishedClues">[] = [];
      for (const id of clue.contradictsClueIds) {
        const typed = ctx.db.normalizeId("publishedClues", id);
        const published = typed ? await ctx.db.get(typed) : null;
        if (
          !published ||
          published.roomId !== job.roomId ||
          published.status !== "active"
        )
          throw new Error("Contradiction citation mismatch");
        contradictsClueIds.push(published._id);
      }
      await ctx.db.insert("proposedClues", {
        ...clue,
        sourceMessageIds: messageIds,
        contradictsClueIds,
        sourceId: job.sourceId!,
        participantId: job.actingParticipantId!,
        roomId: job.roomId,
        status: "proposed",
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(job._id, {
      status: "succeeded",
      finishedAt: Date.now(),
    });
    await recordEvent(
      ctx,
      job,
      "extractor",
      "completed",
      "Proposed clues are ready for your review. Nothing was published.",
    );
    return null;
  },
});

export const completeTurn = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    attempt: v.number(),
    decision: v.any(),
    recipientResult: v.optional(v.any()),
    modelUsage: v.optional(agentModelUsage),
  },
  handler: async (ctx, args): Promise<null> => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.kind !== "evaluate_thread" ||
      job.status !== "running" ||
      job.attempt !== args.attempt
    )
      return null;
    if (args.modelUsage)
      await ctx.db.patch(job._id, { modelUsage: args.modelUsage });
    if (!(await isCurrent(ctx, job))) {
      await markStale(ctx, job);
      return null;
    }
    const snapshot = (await readBuyerSnapshot(ctx, job))!;
    const decision = validateDecision(
      agentDecisionSchema.parse(args.decision as unknown),
      snapshot,
    );
    // This payload is passed only by the internal buyer action, never directly by a browser/model.
    const recipient = args.recipientResult as
      import("./recipient").RecipientResult | undefined;
    if (decision.intent === "query_recipient" && recipient?.profileId) {
      const profile = await ctx.db.get(recipient.profileId);
      const room = await ctx.db.get(job.roomId);
      if (
        !profile ||
        room?.recipientProfileId !== profile._id ||
        profile.roomId !== job.roomId ||
        profile.revision !== recipient.profileRevision
      ) {
        await markStale(ctx, job);
        return null;
      }
    }
    const searchBrief =
      decision.intent === "search" ? decision.searchBrief : undefined;
    const rendered =
      decision.intent === "recommend"
        ? renderRecommendation(decision, snapshot)
        : null;
    const citations: Doc<"chatMessages">["citations"] = rendered
      ? {
          listingIds: rendered.citations.listingIds.map((id) =>
            ctx.db.normalizeId("productListings", id)!,
          ),
          publishedClueIds: rendered.citations.publishedClueIds.map((id) =>
            ctx.db.normalizeId("publishedClues", id)!,
          ),
          ...(rendered.citations.researchJobId
            ? {
                researchJobId: ctx.db.normalizeId(
                  "researchJobs",
                  rendered.citations.researchJobId,
                )!,
              }
            : {}),
        }
      : undefined;
    const stored = {
      intent: decision.intent,
      rationale: decision.rationale,
      needsFollowup: false,
      ...("chatMessage" in decision
        ? { chatMessage: rendered?.body ?? decision.chatMessage }
        : {}),
      ...("clarifySlot" in decision
        ? { clarifySlot: decision.clarifySlot }
        : {}),
      ...("recipientQuery" in decision
        ? { recipientQuery: decision.recipientQuery }
        : {}),
      ...("citations" in decision ? { citations: decision.citations } : {}),
    };
    // Drop undefined values from serialized objects passed to Convex.
    await ctx.db.insert("agentDecisions", {
      ...stored,
      ...(searchBrief
        ? {
            searchBrief: {
              knowledgeRevision: searchBrief.knowledgeRevision,
              queryTerms: searchBrief.queryTerms,
              mustExclude: searchBrief.mustExclude,
              ...(searchBrief.budgetMinor !== undefined
                ? { budgetMinor: searchBrief.budgetMinor }
                : {}),
              ...(searchBrief.occasion
                ? { occasion: searchBrief.occasion }
                : {}),
              listingLimit: searchBrief.listingLimit,
            },
          }
        : {}),
      jobId: job._id,
      roomId: job.roomId,
      createdAt: Date.now(),
    });
    if (decision.intent === "clarify" || decision.intent === "recommend") {
      const messageId = await ctx.db.insert("chatMessages", {
        roomId: job.roomId,
        authorKind: "buyer_agent",
        agentJobId: job._id,
        ...(citations ? { citations } : {}),
        body: rendered?.body ?? decision.chatMessage,
        clientIdempotencyKey: `agent:${job._id}`,
        createdAt: Date.now(),
      });
      if (decision.intent === "clarify") {
        const previous = await ctx.db
          .query("askedSlots")
          .withIndex("by_room_slot", (q) =>
            q.eq("roomId", job.roomId).eq("slot", decision.clarifySlot),
          )
          .first();
        const fields = {
          messageId,
          status: "open" as const,
          askedAt: Date.now(),
          answeredByMessageId: undefined,
        };
        if (previous) await ctx.db.patch(previous._id, fields);
        else
          await ctx.db.insert("askedSlots", {
            roomId: job.roomId,
            slot: decision.clarifySlot,
            messageId,
            status: "open",
            askedAt: Date.now(),
          });
        await recordEvent(
          ctx,
          job,
          "buyer",
          "question",
          "A friend can answer a question to improve the gift search.",
        );
      }
    }
    if (decision.intent === "search") {
      const brief = decision.searchBrief;
      const researchJobId = await ctx.db.insert("researchJobs", {
        roomId: job.roomId,
        knowledgeRevision: snapshot.knowledgeRevision,
        actingParticipantId: job.actingParticipantId,
        originatingAgentJobId: job._id,
        latestMessageId: job.latestMessageId,
        publishedClueIds: snapshot.publishedClues.map((c) =>
          ctx.db.normalizeId("publishedClues", c.id)!,
        ),
        brief: {
          knowledgeRevision: snapshot.knowledgeRevision,
          queryTerms: brief.queryTerms,
          mustExclude: brief.mustExclude,
          ...(snapshot.budgetMinor !== undefined
            ? { budgetMinor: snapshot.budgetMinor }
            : {}),
          occasion: snapshot.occasion,
          listingLimit: brief.listingLimit,
        },
        status: "pending",
        attempt: 0,
        inputHash: fingerprint({
          knowledgeRevision: snapshot.knowledgeRevision,
          brief,
        }),
        idempotencyKey: `agent-research:${job._id}`,
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.research.research.runResearch, {
        jobId: researchJobId,
      });
      await recordEvent(
        ctx,
        job,
        "research_planner",
        "handoff",
        "Sent the confirmed gift brief to product research.",
      );
    }
    if (decision.intent === "query_recipient") {
      if (!recipient || recipient.reply.queryId !== `${job._id}:recipient`)
        throw new Error("Recipient reply mismatch");
      const reply = agentReplySchema.parse(recipient.reply);
      if (reply.status === "answered" && !recipient.profileId)
        throw new Error("Recipient profile required");
      await recordEvent(
        ctx,
        job,
        "buyer",
        "handoff",
        "Asked the recipient agent about a gift direction.",
      );
      const guidance =
        reply.status === "answered"
          ? RECIPIENT_GUIDANCE[reply.suitability!]
          : reply.status === "unknown"
            ? "The recipient agent has no approved information for this question."
            : "The recipient agent could not answer within its sharing permissions.";
      const text = `Regarding “${decision.recipientQuery.subject.label}”: ${guidance}`;
      await ctx.db.insert("chatMessages", {
        roomId: job.roomId,
        authorKind: "buyer_agent",
        body: text,
        agentJobId: job._id,
        clientIdempotencyKey: `agent:${job._id}`,
        createdAt: Date.now(),
      });
      await recordEvent(ctx, job, "recipient", "completed", text);
    }
    const statusMessage = researchStatusMessage(snapshot);
    if (statusMessage) {
      await ctx.db.insert("chatMessages", {
        roomId: job.roomId,
        authorKind: "buyer_agent",
        agentJobId: job._id,
        body: statusMessage,
        clientIdempotencyKey: `agent:${job._id}`,
        createdAt: Date.now(),
      });
      await recordEvent(ctx, job, "research_planner", "failed", statusMessage);
    }
    if (job.trigger === "knowledge_changed") {
      const affected =
        snapshot.excluded?.filter((row) =>
          snapshot.previousRecommendationListingIds?.includes(row.listingId),
        ) ?? [];
      if (affected.length)
        await recordEvent(
          ctx,
          job,
          "buyer",
          "completed",
          "An earlier recommendation no longer fits the current clues or availability.",
          {
            listingIds: affected.map((row) =>
              ctx.db.normalizeId("productListings", row.listingId)!,
            ),
            publishedClueIds: [
              ...new Set(
                affected.flatMap((row) =>
                  row.clueId
                    ? [ctx.db.normalizeId("publishedClues", row.clueId)!]
                    : [],
                ),
              ),
            ],
            ...(snapshot.research?.poolJobId
              ? {
                  researchJobId: ctx.db.normalizeId(
                    "researchJobs",
                    snapshot.research.poolJobId,
                  )!,
                }
              : {}),
          },
        );
    }
    await ctx.db.patch(job._id, {
      status: "succeeded",
      finishedAt: Date.now(),
    });
    await recordEvent(
      ctx,
      job,
      "buyer",
      "completed",
      rendered
        ? "Shared sourced options with their supporting clues."
        : decision.intent === "listen" || decision.intent === "wait"
          ? "Listening while the group decides."
          : "Agent turn completed.",
      citations,
    );
    return null;
  },
});
