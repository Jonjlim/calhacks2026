/**
 * The cloud Gift Twin agent. It acts for the recipient (model role
 * "recipient") over the messages they uploaded with one-time consent:
 *
 *   processVault   first pass: insights from the messages, plus a vote on
 *                  every idea already in the room.
 *   watchTick      every TWIN_LIMITS.watchIntervalMs while the vault is open:
 *                  claims room ideas added since, then voteOnNewIdeas votes
 *                  on them.
 *   expireVault    deletes the messages at vaultExpiresAt.
 *
 * Only these internal functions read twinVaultChunks. What leaves the agent
 * is screened third-person sentences, re-validated in recordFindings before
 * insert; the gift agent (review.ts) then decides what becomes a clue.
 * Every write re-checks the collaborator and upload id, so a revoke, forget,
 * new upload, or room purge stops an in-flight run.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { configuredModel } from "../agents/model";
import {
  insightDedupeKey,
  isShareableConfidence,
  TWIN_LIMITS,
  twinInsightSchema,
  twinVoteSchema,
  voteDedupeKey,
  type RoomIdea,
  type TwinInsight,
  type TwinVoteCast,
  type VaultMessage,
} from "../../lib/agentCollaborators/contracts";
import { findInsights } from "./extract";
import { closeVault, loadUpload, modelConfigured, roomIdeas } from "./lib";
import { twinConfidence, twinInsightCategory, twinVote } from "./schema";
import { castVotes, reconcileVote } from "./vote";

const uploadArgs = { collaboratorId: v.id("agentCollaborators"), uploadId: v.string() };

interface AgentSnapshot {
  recipientName: string;
  ideas: RoomIdea[];
  chunkIds: Array<Id<"twinVaultChunks">>;
}

export const snapshot = internalQuery({
  args: { ...uploadArgs, refs: v.optional(v.array(v.string())) },
  handler: async (ctx, args): Promise<AgentSnapshot | null> => {
    const loaded = await loadUpload(ctx, args.collaboratorId, args.uploadId);
    if (!loaded) return null;
    const { collaborator, room } = loaded;
    if (collaborator.vaultStatus !== "processing" && collaborator.vaultStatus !== "ready") return null;
    const chunks = await ctx.db.query("twinVaultChunks").withIndex("by_collaborator", (q) => q.eq("collaboratorId", collaborator._id)).collect();
    const wanted = args.refs ? new Set(args.refs) : null;
    const ideas = (await roomIdeas(ctx, room, collaborator._id)).filter((idea) => !wanted || wanted.has(idea.ref));
    return {
      recipientName: room.recipientDisplayName,
      ideas,
      chunkIds: chunks.filter((c) => c.uploadId === args.uploadId).map((c) => c._id),
    };
  },
});

/** One stored chunk, loaded separately to keep each read small. */
export const chunk = internalQuery({
  args: { ...uploadArgs, chunkId: v.id("twinVaultChunks") },
  handler: async (ctx, args): Promise<VaultMessage[]> => {
    if (!(await loadUpload(ctx, args.collaboratorId, args.uploadId))) return [];
    const row = await ctx.db.get(args.chunkId);
    if (!row || row.collaboratorId !== args.collaboratorId || row.uploadId !== args.uploadId) return [];
    return row.messages;
  },
});

async function loadMessages(ctx: ActionCtx, args: { collaboratorId: Id<"agentCollaborators">; uploadId: string }, chunkIds: Array<Id<"twinVaultChunks">>) {
  const messages: VaultMessage[] = [];
  const { collaboratorId, uploadId } = args;
  for (const chunkId of chunkIds) messages.push(...(await ctx.runQuery(internal.giftTwin.agent.chunk, { collaboratorId, uploadId, chunkId })));
  return messages.sort((a, b) => a.sentAt - b.sentAt);
}

export const processVault = internalAction({
  args: uploadArgs,
  handler: async (ctx, args) => {
    let insights: TwinInsight[] = [];
    let votes: TwinVoteCast[] = [];
    let checkedRefs: string[] = [];
    try {
      const snap: AgentSnapshot | null = await ctx.runQuery(internal.giftTwin.agent.snapshot, args);
      if (!snap) return;
      const messages = await loadMessages(ctx, args, snap.chunkIds);
      const model = modelConfigured() ? configuredModel() : undefined;
      [insights, votes] = await Promise.all([
        findInsights(messages, snap.recipientName, model),
        castVotes(snap.ideas, messages, snap.recipientName, model),
      ]);
      checkedRefs = snap.ideas.map((idea) => idea.ref);
    } finally {
      // Always leave "processing", even after a failure, so the watch loop starts.
      await ctx.runMutation(internal.giftTwin.agent.recordFindings, { ...args, insights, votes, checkedRefs, firstPass: true });
    }
  },
});

export const voteOnNewIdeas = internalAction({
  args: { ...uploadArgs, refs: v.array(v.string()) },
  handler: async (ctx, args) => {
    const snap: AgentSnapshot | null = await ctx.runQuery(internal.giftTwin.agent.snapshot, args);
    if (!snap || snap.ideas.length === 0) return;
    const messages = await loadMessages(ctx, args, snap.chunkIds);
    const votes = await castVotes(snap.ideas, messages, snap.recipientName, modelConfigured() ? configuredModel() : undefined);
    if (votes.length === 0) return;
    await ctx.runMutation(internal.giftTwin.agent.recordFindings, {
      collaboratorId: args.collaboratorId,
      uploadId: args.uploadId,
      insights: [],
      votes,
      checkedRefs: [],
      firstPass: false,
    });
  },
});

const insightArg = v.object({ category: twinInsightCategory, text: v.string(), confidence: twinConfidence, evidenceCount: v.number() });
const voteArg = v.object({
  ideaRef: v.string(),
  vote: twinVote,
  text: v.string(),
  category: v.optional(twinInsightCategory),
  confidence: twinConfidence,
  evidenceCount: v.number(),
});

function mergeRefs(existing: string[] | undefined, added: string[]): string[] {
  return [...new Set([...(existing ?? []), ...added])].slice(-TWIN_LIMITS.checkedRefsMax);
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Re-validates agent output (model output is untrusted), stores it as posts, and hands it to the gift agent. */
export const recordFindings = internalMutation({
  args: {
    ...uploadArgs,
    insights: v.array(insightArg),
    votes: v.array(voteArg),
    checkedRefs: v.array(v.string()),
    firstPass: v.boolean(),
  },
  handler: async (ctx, args) => {
    const loaded = await loadUpload(ctx, args.collaboratorId, args.uploadId);
    if (!loaded) return;
    const { collaborator, room } = loaded;
    if (collaborator.vaultStatus !== (args.firstPass ? "processing" : "ready")) return;
    const now = Date.now();
    const seen = async (dedupeKey: string) =>
      (await ctx.db
        .query("agentCollaboratorPosts")
        .withIndex("by_collaborator_dedupe", (q) => q.eq("collaboratorId", collaborator._id).eq("dedupeKey", dedupeKey))
        .first()) !== null;
    let inserted = 0;

    for (const raw of args.insights.slice(0, TWIN_LIMITS.insightsPerRun)) {
      const parsed = twinInsightSchema.safeParse(raw);
      if (!parsed.success || !isShareableConfidence(parsed.data.confidence)) continue;
      const insight = parsed.data;
      const dedupeKey = insightDedupeKey(insight.category, insight.text);
      if (await seen(dedupeKey)) continue;
      await ctx.db.insert("agentCollaboratorPosts", {
        roomId: room._id,
        collaboratorId: collaborator._id,
        kind: "insight",
        category: insight.category,
        text: clean(insight.text),
        confidence: insight.confidence,
        evidenceCount: insight.evidenceCount,
        dedupeKey,
        status: "suggested",
        createdAt: now,
      });
      inserted += 1;
    }

    // Idea text comes from the room as it is now, never from the agent's output.
    const ideas = new Map((await roomIdeas(ctx, room, collaborator._id)).map((idea) => [idea.ref, idea]));
    for (const raw of args.votes.slice(0, TWIN_LIMITS.votesPerRun)) {
      const parsed = twinVoteSchema.safeParse(raw);
      const idea = parsed.success ? ideas.get(parsed.data.ideaRef) : undefined;
      if (!parsed.success || !idea || !isShareableConfidence(parsed.data.confidence)) continue;
      // The vote must agree with its own evidence and the idea's wording as stored now.
      const cast = reconcileVote(parsed.data, idea);
      if (!cast) continue;
      const ideaText = idea.text;
      const dedupeKey = voteDedupeKey(cast.ideaRef);
      if (await seen(dedupeKey)) continue;
      await ctx.db.insert("agentCollaboratorPosts", {
        roomId: room._id,
        collaboratorId: collaborator._id,
        kind: "vote",
        ...(cast.category ? { category: cast.category } : {}),
        text: clean(cast.text),
        confidence: cast.confidence,
        evidenceCount: cast.evidenceCount,
        ideaRef: cast.ideaRef,
        ideaText,
        vote: cast.vote,
        dedupeKey,
        status: "suggested",
        createdAt: now,
      });
      inserted += 1;
    }

    if (args.firstPass) {
      await ctx.db.patch(collaborator._id, {
        vaultStatus: "ready",
        reportedAt: now,
        checkedIdeaRefs: mergeRefs(collaborator.checkedIdeaRefs, args.checkedRefs),
      });
      await ctx.scheduler.runAfter(TWIN_LIMITS.watchIntervalMs, internal.giftTwin.agent.watchTick, {
        collaboratorId: collaborator._id,
        uploadId: args.uploadId,
      });
    }
    if (inserted > 0) await ctx.scheduler.runAfter(0, internal.giftTwin.review.reviewPosts, { collaboratorId: collaborator._id });
  },
});

/**
 * Claims room ideas the twin has not looked at, then reschedules itself.
 * Claiming before voting means a failed vote run loses only those votes and
 * never stops the loop.
 */
export const watchTick = internalMutation({
  args: uploadArgs,
  handler: async (ctx, args) => {
    const loaded = await loadUpload(ctx, args.collaboratorId, args.uploadId);
    if (!loaded) return;
    const { collaborator, room } = loaded;
    if (collaborator.vaultStatus !== "ready" || (collaborator.vaultExpiresAt ?? 0) <= Date.now()) return;
    const checked = new Set(collaborator.checkedIdeaRefs ?? []);
    const fresh = (await roomIdeas(ctx, room, collaborator._id)).filter((idea) => !checked.has(idea.ref)).map((idea) => idea.ref);
    if (fresh.length > 0) {
      await ctx.db.patch(collaborator._id, { checkedIdeaRefs: mergeRefs(collaborator.checkedIdeaRefs, fresh) });
      await ctx.scheduler.runAfter(0, internal.giftTwin.agent.voteOnNewIdeas, { ...args, refs: fresh });
    }
    await ctx.scheduler.runAfter(TWIN_LIMITS.watchIntervalMs, internal.giftTwin.agent.watchTick, args);
  },
});

export const expireVault = internalMutation({
  args: uploadArgs,
  handler: async (ctx, args) => {
    const collaborator = await ctx.db.get(args.collaboratorId);
    if (!collaborator || collaborator.vaultUploadId !== args.uploadId) return;
    await closeVault(ctx, collaborator);
  },
});
