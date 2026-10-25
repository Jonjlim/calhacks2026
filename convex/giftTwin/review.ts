/**
 * The gift agent reviews what the twin agent posted. New posts arrive
 * "suggested"; this decides, without a human step, what happens to each:
 *   - insights go through the interpretation layer (interpret.ts): garbled
 *     notes and repeats of room clues are dropped, notes about the same
 *     thing are merged into one stronger clue ("added"; the merged ones are
 *     hidden as "dismissed").
 *   - votes: a downvote ("friends say backpacking; she hates it") becomes a
 *     clue that corrects the idea, unless an added insight already says the
 *     same; an upvote is shown in the feed ("noted").
 * The gift agent sees screened sentences only, never the vaulted messages.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { bumpKnowledgeRevision } from "../lib/knowledge";
import { configuredModel } from "../agents/model";
import { clueKindForCategory, isShareableConfidence, screenSharedText, TWIN_LIMITS } from "../../lib/agentCollaborators/contracts";
import { interpretWithModel, isCoherentNote, noteKey, type NoteCandidate } from "./interpret";
import { modelConfigured } from "./lib";
import { twinConfidence, twinInsightCategory } from "./schema";

type PostId = Id<"agentCollaboratorPosts">;
type Category = NonNullable<Doc<"agentCollaboratorPosts">["category"]>;

export interface ReviewSnapshot {
  recipientName: string;
  occasion: string;
  roomClues: string[];
  /** Insights for interpretation. */
  candidates: Array<NoteCandidate<PostId>>;
  /** Downvotes: published as corrective clues without a relevance check, since they answer an idea already in the room. */
  downvotes: Array<{ postId: PostId; category: Category; text: string }>;
  /** Upvotes: shown, no new clue. */
  upvotes: PostId[];
  /** Posts that can never become a clue. */
  unaddable: PostId[];
}

/** Deterministic floor applied before any model sees a note. */
export function addable(post: Pick<Doc<"agentCollaboratorPosts">, "kind" | "category" | "confidence" | "vote">): boolean {
  if (!post.category || !isShareableConfidence(post.confidence)) return false;
  return post.kind === "insight" || post.vote === "down";
}

export const reviewSnapshot = internalQuery({
  args: { collaboratorId: v.id("agentCollaborators"), postIds: v.optional(v.array(v.id("agentCollaboratorPosts"))) },
  handler: async (ctx, args): Promise<ReviewSnapshot | null> => {
    const collaborator = await ctx.db.get(args.collaboratorId);
    if (!collaborator || collaborator.status === "revoked") return null;
    const room = await ctx.db.get(collaborator.roomId);
    if (!room || room.deletedAt !== undefined) return null;
    const pending = args.postIds
      ? (await Promise.all(args.postIds.slice(0, TWIN_LIMITS.insightsPerRun + TWIN_LIMITS.votesPerRun).map((id) => ctx.db.get(id))))
        .filter((post): post is Doc<"agentCollaboratorPosts"> => post !== null && post.collaboratorId === collaborator._id && post.status === "suggested")
      : await ctx.db
      .query("agentCollaboratorPosts")
      .withIndex("by_collaborator_status", (q) => q.eq("collaboratorId", collaborator._id).eq("status", "suggested"))
      .take(TWIN_LIMITS.insightsPerRun + TWIN_LIMITS.votesPerRun);
    if (pending.length === 0) return null;
    const clues = (await ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", room._id)).take(200))
      .filter((c) => c.status === "active")
      .slice(-40);
    const snapshot: ReviewSnapshot = {
      recipientName: room.recipientDisplayName,
      occasion: room.occasion,
      roomClues: clues.map((c) => c.text),
      candidates: [],
      downvotes: [],
      upvotes: [],
      unaddable: [],
    };
    for (const post of pending) {
      if (post.kind === "vote" && post.vote === "up" && isShareableConfidence(post.confidence)) snapshot.upvotes.push(post._id);
      else if (!addable(post) || !post.category) snapshot.unaddable.push(post._id);
      else if (post.kind === "vote") snapshot.downvotes.push({ postId: post._id, category: post.category, text: post.text });
      else
        snapshot.candidates.push({
          ref: post._id,
          category: post.category,
          text: post.text,
          confidence: post.confidence,
          ...(post.evidenceCount !== undefined ? { evidenceCount: post.evidenceCount } : {}),
        });
    }
    return snapshot;
  },
});

export const reviewPosts = internalAction({
  args: { collaboratorId: v.id("agentCollaborators"), deterministicReview: v.optional(v.boolean()), postIds: v.optional(v.array(v.id("agentCollaboratorPosts"))) },
  handler: async (ctx, args) => {
    if (args.deterministicReview && !args.postIds) return;
    const snapshot: ReviewSnapshot | null = await ctx.runQuery(internal.giftTwin.review.reviewSnapshot, {
      collaboratorId: args.collaboratorId, ...(args.postIds ? { postIds: args.postIds } : {}),
    });
    if (!snapshot) return;
    const name = snapshot.recipientName;
    const interpreted = await interpretWithModel(!args.deterministicReview && modelConfigured() ? configuredModel() : undefined, snapshot.candidates, {
      name,
      occasion: snapshot.occasion,
      roomClues: snapshot.roomClues,
    });
    // A downvote that says what an added note or a room clue already says is shown, not published twice.
    const said = new Set(
      [...interpreted.notes.map((n) => noteKey(n.category, n.text, name)), ...snapshot.roomClues.map((text) => noteKey("interest", text, name))].filter(
        (k): k is string => k !== null,
      ),
    );
    const publish: PostId[] = [];
    const note: PostId[] = [...snapshot.upvotes];
    for (const down of snapshot.downvotes) {
      const key = noteKey(down.category, down.text, name);
      if (key && said.has(key)) note.push(down.postId);
      else publish.push(down.postId);
      if (key) said.add(key);
    }
    await ctx.runMutation(internal.giftTwin.review.applyReview, {
      collaboratorId: args.collaboratorId,
      add: interpreted.notes.map((n) => ({
        postId: n.primary,
        merged: n.merged,
        category: n.category,
        text: n.text,
        confidence: n.confidence,
        evidenceCount: n.evidenceCount,
      })),
      publish,
      note,
      drop: [...snapshot.unaddable, ...interpreted.dropped],
    });
  },
});

async function publisherFor(ctx: MutationCtx, collaborator: Doc<"agentCollaborators">): Promise<Id<"participants"> | null> {
  const inviter = await ctx.db.get(collaborator.createdBy);
  if (inviter && inviter.roomId === collaborator.roomId) return inviter._id;
  const organizer = (await ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", collaborator.roomId)).collect()).find(
    (p) => p.role === "organizer",
  );
  return organizer?._id ?? null;
}

const interpretedNote = v.object({
  postId: v.id("agentCollaboratorPosts"),
  merged: v.array(v.id("agentCollaboratorPosts")),
  category: twinInsightCategory,
  text: v.string(),
  confidence: twinConfidence,
  evidenceCount: v.number(),
});

/**
 * Publishes accepted notes as clues. They are attributed to the member who
 * invited the twin (publishedClues needs a participant), so that member can
 * still edit or withdraw them like any other shared memory. Interpreted
 * text is screened again here; the action's output is not trusted.
 */
export const applyReview = internalMutation({
  args: {
    collaboratorId: v.id("agentCollaborators"),
    add: v.array(interpretedNote),
    publish: v.array(v.id("agentCollaboratorPosts")),
    note: v.array(v.id("agentCollaboratorPosts")),
    drop: v.array(v.id("agentCollaboratorPosts")),
  },
  handler: async (ctx, args) => {
    const collaborator = await ctx.db.get(args.collaboratorId);
    if (!collaborator || collaborator.status === "revoked") return;
    const publisherId = await publisherFor(ctx, collaborator);
    const pendingPost = async (postId: PostId) => {
      const post = await ctx.db.get(postId);
      return post && post.collaboratorId === collaborator._id && post.status === "suggested" ? post : null;
    };
    const clue = (post: Doc<"agentCollaboratorPosts">, category: Category, text: string) =>
      ctx.db.insert("publishedClues", {
        roomId: post.roomId,
        publisherId: publisherId!,
        kind: clueKindForCategory(category),
        text,
        sourceKind: "manual",
        sourceMessageIds: [],
        status: "active",
        publishedAt: Date.now(),
      });
    let published = 0;

    for (const item of args.add) {
      const post = await pendingPost(item.postId);
      if (!post) continue;
      const screened = screenSharedText(item.text);
      if (!publisherId || post.kind !== "insight" || !screened.ok || !isCoherentNote(screened.text) || !isShareableConfidence(item.confidence)) {
        await ctx.db.patch(post._id, { status: "dismissed" });
        continue;
      }
      const publishedClueId = await clue(post, item.category, screened.text);
      await ctx.db.patch(post._id, {
        status: "added",
        publishedClueId,
        category: item.category,
        text: screened.text,
        confidence: item.confidence,
        evidenceCount: Math.min(999, Math.max(1, Math.round(item.evidenceCount))),
      });
      published += 1;
      for (const mergedId of item.merged) {
        const merged = await pendingPost(mergedId);
        if (merged?.kind === "insight") await ctx.db.patch(merged._id, { status: "dismissed" });
      }
    }

    for (const postId of args.publish) {
      const post = await pendingPost(postId);
      if (!post) continue;
      if (!publisherId || !addable(post) || !post.category || post.kind !== "vote" || !isCoherentNote(post.text)) {
        await ctx.db.patch(post._id, { status: post.kind === "vote" ? "noted" : "dismissed" });
        continue;
      }
      const publishedClueId = await clue(post, post.category, post.text);
      await ctx.db.patch(post._id, { status: "added", publishedClueId });
      published += 1;
    }

    for (const [ids, status] of [[args.note, "noted"], [args.drop, "dismissed"]] as const) {
      for (const postId of ids) {
        const post = await pendingPost(postId);
        if (post) await ctx.db.patch(post._id, { status });
      }
    }
    if (published > 0) await bumpKnowledgeRevision(ctx, collaborator.roomId);
  },
});
