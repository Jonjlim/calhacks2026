/**
 * The shared gift map. Owner: Dev 3 (data and agent actions); the canvas belongs to Dev 1.
 *
 * Everything on the map is real room state: seeds are published clues, sprouts
 * are agent suggestions stored per seed, products are research listings. The
 * only map-specific state is presence (cursors) and layout (positions), which
 * never changes what the agents know. Decisions still go through the existing
 * clue, research and selection mutations.
 */
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { Result } from "../lib/contracts";
import { requireMember } from "./lib/auth";
import { cleanText, LIMITS } from "./lib/input";
import { bumpKnowledgeRevision } from "./lib/knowledge";
import { productCategory } from "./research/text";
import { logTrail } from "./lib/trail";
import { err, memberError, ok } from "./lib/result";
import { cleanIdeas, ideasFor } from "./agents/ideas";

/** Cursors older than this are treated as gone. */
export const CURSOR_TTL_MS = 8_000;
const COORD_LIMIT = 100_000;
const NODE_KEY = /^(seed|sprout|product|box|vibe):[A-Za-z0-9_-]{1,80}$/;
const MAX_SPROUTS_PER_SEED = 12;

const finite = (n: number) => Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT;

export const moveCursor = mutation({
  args: { roomId: v.id("rooms"), x: v.number(), y: v.number(), space: v.optional(v.union(v.literal("sky"), v.literal("diagram"), v.literal("rings"))) },
  handler: async (ctx, { roomId, x, y, space }) => {
    if (!finite(x) || !finite(y)) return err<null>("validation_failed", "Cursor is off the map.");
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<null>(member.code);
    const existing = await ctx.db
      .query("mapCursors")
      .withIndex("by_room_participant", (q) => q.eq("roomId", roomId).eq("participantId", member.me._id))
      .first();
    const row = { x, y, space: space ?? "diagram", updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("mapCursors", { roomId, participantId: member.me._id, ...row });
    return ok(null);
  },
});

export const listCursors = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    type Row = { participantId: Id<"participants">; displayName: string; x: number; y: number; space: "sky" | "diagram" | "rings"; updatedAt: number };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Row[]>(member.code);
    // Readers drop cursors older than CURSOR_TTL_MS themselves, so this query stays stable and reactive.
    const rows = await ctx.db
      .query("mapCursors")
      .withIndex("by_room_participant", (q) => q.eq("roomId", roomId))
      .take(50);
    const out: Row[] = [];
    for (const r of rows) {
      if (r.participantId === member.me._id) continue;
      const p = await ctx.db.get(r.participantId);
      if (p) out.push({ participantId: r.participantId, displayName: p.displayName, x: r.x, y: r.y, space: r.space ?? "diagram", updatedAt: r.updatedAt });
    }
    return ok(out);
  },
});

export const moveNode = mutation({
  args: { roomId: v.id("rooms"), nodeKey: v.string(), x: v.number(), y: v.number() },
  handler: async (ctx, { roomId, nodeKey, x, y }) => {
    if (!NODE_KEY.test(nodeKey) || !finite(x) || !finite(y)) return err<null>("validation_failed", "That spot isn't on the map.");
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<null>(member.code);
    const existing = await ctx.db
      .query("mapPositions")
      .withIndex("by_room_node", (q) => q.eq("roomId", roomId).eq("nodeKey", nodeKey))
      .first();
    const row = { x, y, movedBy: member.me._id, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("mapPositions", { roomId, nodeKey, ...row });
    return ok(null);
  },
});

export const getMapState = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    type Out = {
      positions: Array<{ nodeKey: string; x: number; y: number }>;
      sprouts: Array<Pick<Doc<"mapSprouts">, "_id" | "seedClueId" | "label" | "emoji" | "clue" | "source">>;
      feedback: Array<{ id: Id<"mapFeedback">; participantId: Id<"participants">; kind: "owned" | "price"; listing: Doc<"productListings"> }>;
    };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Out>(member.code);
    const positions = await ctx.db
      .query("mapPositions")
      .withIndex("by_room_node", (q) => q.eq("roomId", roomId))
      .take(400);
    const sprouts = await ctx.db
      .query("mapSprouts")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .take(300);
    const visibleSprouts: typeof sprouts = [];
    for (const sprout of sprouts) {
      const seed = await ctx.db.get(sprout.seedClueId);
      if (seed?.status === "active" && seed.roomId === roomId) visibleSprouts.push(sprout);
    }
    const reactions = await ctx.db.query("mapFeedback").withIndex("by_room", q => q.eq("roomId", roomId)).order("desc").take(200);
    const feedback: Out["feedback"] = [];
    for (const row of reactions) {
      if (!row.active) continue;
      if (row.publishedClueId && (await ctx.db.get(row.publishedClueId))?.status !== "active") continue;
      const listing = await ctx.db.get(row.listingId);
      if (listing?.roomId === roomId) feedback.push({ id: row._id, participantId: row.participantId, kind: row.kind, listing });
    }
    return ok<Out>({
      positions: positions.map((p) => ({ nodeKey: p.nodeKey, x: p.x, y: p.y })),
      sprouts: visibleSprouts.map((s) => ({ _id: s._id, seedClueId: s.seedClueId, label: s.label, emoji: s.emoji, clue: s.clue, source: s.source })),
      feedback,
    });
  },
});

export const seedForGrowth = internalQuery({
  args: { clueId: v.id("publishedClues"), userId: v.string() },
  handler: async (ctx, { clueId, userId }) => {
    const clue = await ctx.db.get(clueId);
    if (!clue || clue.status !== "active") return null;
    const member = await ctx.db
      .query("participants")
      .withIndex("by_room_user", (q) => q.eq("roomId", clue.roomId).eq("userId", userId))
      .first();
    if (!member) return null;
    const existing = await ctx.db
      .query("mapSprouts")
      .withIndex("by_seed", (q) => q.eq("seedClueId", clueId))
      .collect();
    return { roomId: clue.roomId, kind: clue.kind, text: clue.text, participantId: member._id, existing: existing.map((s) => s.label.toLowerCase()) };
  },
});

export const storeSprouts = internalMutation({
  args: {
    roomId: v.id("rooms"),
    seedClueId: v.id("publishedClues"),
    grownBy: v.id("participants"),
    source: v.union(v.literal("agent"), v.literal("preset")),
    expectedText: v.optional(v.string()),
    sprouts: v.array(v.object({ label: v.string(), emoji: v.string(), clue: v.string() })),
  },
  handler: async (ctx, args) => {
    const seed = await ctx.db.get(args.seedClueId);
    const member = await ctx.db.get(args.grownBy);
    if (!seed || seed.roomId !== args.roomId || seed.status !== "active" || !member || member.roomId !== args.roomId || (args.expectedText !== undefined && seed.text !== args.expectedText)) return 0;
    const existing = await ctx.db
      .query("mapSprouts")
      .withIndex("by_seed", (q) => q.eq("seedClueId", args.seedClueId))
      .collect();
    const room = MAX_SPROUTS_PER_SEED - existing.length;
    const known = new Set(existing.map(s => s.label.toLowerCase()));
    const fresh = cleanIdeas(args.sprouts, existing.map(s => s.clue)).filter(s => !known.has(s.label.toLowerCase()));
    const now = Date.now();
    for (const s of fresh.slice(0, Math.max(0, room)))
      await ctx.db.insert("mapSprouts", { roomId: args.roomId, seedClueId: args.seedClueId, grownBy: args.grownBy, source: args.source, createdAt: now, ...s });
    return Math.max(0, Math.min(room, fresh.length));
  },
});

/** Tap a memory: the agent grows branches one level more specific, visible to everyone in the room. */
export const growSeed = action({
  args: { clueId: v.id("publishedClues") },
  handler: async (ctx, { clueId }): Promise<Result<{ grown: number; source: "agent" | "preset" }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return err("unauthorized", "Sign in first.");
    const seed = await ctx.runQuery(internal.map.seedForGrowth, { clueId, userId });
    if (!seed) return err("not_found", "That memory isn't on this map.");
    const board = await ideasFor(ctx, userId, {
      roomId: seed.roomId,
      kind: seed.kind,
      picked: [{ label: seed.text.slice(0, 40), clue: seed.text }],
    });
    if (!board.ok) return board;
    const fresh = board.value.options.filter((o) => !seed.existing.includes(o.label.toLowerCase()));
    const grown = await ctx.runMutation(internal.map.storeSprouts, {
      roomId: seed.roomId,
      seedClueId: clueId,
      grownBy: seed.participantId,
      source: board.value.source,
      expectedText: seed.text,
      sprouts: fresh,
    });
    return ok({ grown, source: board.value.source });
  },
});

/** Planting a sprout is the friend's choice: it publishes the idea as a memory and removes the suggestion, in one step. */
export const plantSprout = mutation({
  args: { sproutId: v.id("mapSprouts") },
  handler: async (ctx, { sproutId }) => {
    type Out = Doc<"publishedClues">;
    const sprout = await ctx.db.get(sproutId);
    if (!sprout) return err<Out>("not_found", "That idea is gone.");
    const member = await requireMember(ctx, sprout.roomId);
    if (!member.ok) return memberError<Out>(member.code);
    const seed = await ctx.db.get(sprout.seedClueId);
    if (!seed || seed.roomId !== sprout.roomId || seed.status !== "active") return err<Out>("stale_job", "The original memory changed. Grow a new branch.");
    const text = cleanText(sprout.clue, LIMITS.clueTextMaxChars);
    if (!text) return err<Out>("validation_failed", "That idea is too long to save.");
    const id = await ctx.db.insert("publishedClues", {
      roomId: sprout.roomId,
      publisherId: member.me._id,
      kind: seed?.kind ?? "interest",
      text,
      sourceKind: "manual",
      sourceMessageIds: [],
      status: "active",
      publishedAt: Date.now(),
    });
    await ctx.db.delete(sproutId);
    // Same path as any new memory: the shortlist re-evaluates against it.
    // Trends are looked up when someone asks for directions, not per memory (D23 trial).
    await bumpKnowledgeRevision(ctx, sprout.roomId);
    return ok<Out>((await ctx.db.get(id))!);
  },
});

/** Explicit human reaction: ownership is shared knowledge; price is a personal opinion. */
export const setFeedback = mutation({
  args: { roomId: v.id("rooms"), listingId: v.id("productListings"), kind: v.union(v.literal("owned"), v.literal("price")) },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return memberError<{ feedbackId: Id<"mapFeedback"> }>(member.code);
    const listing = await ctx.db.get(args.listingId);
    if (!listing || listing.roomId !== args.roomId || listing.status !== "active") return err("not_found", "This gift is not available in this room.");
    const prior = await ctx.db.query("mapFeedback").withIndex("by_member_listing", q => q.eq("roomId", args.roomId).eq("participantId", member.me._id).eq("listingId", args.listingId)).collect();
    const duplicate = prior.find(r => r.active && r.kind === args.kind);
    if (duplicate && (!duplicate.publishedClueId || (await ctx.db.get(duplicate.publishedClueId))?.status === "active")) return ok({ feedbackId: duplicate._id });
    let publishedClueId: Id<"publishedClues"> | undefined;
    if (args.kind === "owned") {
      // The kind of thing, not the listing title: it filters similar gifts and keeps the memory ring readable (D23 trial).
      const text = cleanText(`Already owns ${productCategory(listing.title)}`, LIMITS.clueTextMaxChars);
      if (!text) return err("validation_failed", "This listing title is too long to confirm as ownership.");
      publishedClueId = await ctx.db.insert("publishedClues", { roomId: args.roomId, publisherId: member.me._id, kind: "ownership", text, sourceKind: "manual", sourceMessageIds: [], status: "active", publishedAt: Date.now() });
      await bumpKnowledgeRevision(ctx, args.roomId);
      await logTrail(ctx, args.roomId, { stage: "steering", actor: "person", participantId: member.me._id, outcome: "rejected", listingId: args.listingId, clueIds: [publishedClueId],
        text: `${member.me.displayName || "A friend"} said she already has ${productCategory(listing.title)}, so gifts like that are filtered out.` });
    }
    const feedbackId = await ctx.db.insert("mapFeedback", { roomId: args.roomId, listingId: args.listingId, participantId: member.me._id, kind: args.kind, publishedClueId, active: true, createdAt: Date.now() });
    return ok({ feedbackId });
  },
});

export const undoFeedback = mutation({
  args: { feedbackId: v.id("mapFeedback") },
  handler: async (ctx, { feedbackId }) => {
    const row = await ctx.db.get(feedbackId);
    if (!row) return err("not_found", "Reaction not found.");
    const member = await requireMember(ctx, row.roomId);
    if (!member.ok) return memberError<null>(member.code);
    if (row.participantId !== member.me._id) return err("unauthorized", "Only the friend who added this reaction can undo it.");
    if (!row.active) return ok(null);
    await ctx.db.patch(row._id, { active: false });
    const clue = row.publishedClueId ? await ctx.db.get(row.publishedClueId) : null;
    if (clue?.status === "active" && clue.publisherId === member.me._id) {
      await ctx.db.patch(clue._id, { status: "withdrawn" });
      await bumpKnowledgeRevision(ctx, row.roomId);
    }
    return ok(null);
  },
});

export const editMemory = mutation({
  args: { clueId: v.id("publishedClues"), expectedText: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const clue = await ctx.db.get(args.clueId);
    if (!clue) return err("not_found", "Memory not found.");
    const member = await requireMember(ctx, clue.roomId);
    if (!member.ok) return memberError<null>(member.code);
    if (clue.publisherId !== member.me._id || clue.sourceKind !== "manual") return err("unauthorized", "Only your own manually shared memories can be edited here.");
    if (clue.status !== "active" || clue.text !== args.expectedText) return err("stale_job", "This memory changed. Read its latest text before saving.");
    const text = cleanText(args.text, LIMITS.clueTextMaxChars);
    if (!text) return err("validation_failed", "Memory is empty or too long.");
    if (text === clue.text) return ok(null);
    await ctx.db.patch(clue._id, { text });
    const sprouts = await ctx.db.query("mapSprouts").withIndex("by_seed", q => q.eq("seedClueId", clue._id)).collect();
    for (const sprout of sprouts) await ctx.db.delete(sprout._id);
    await bumpKnowledgeRevision(ctx, clue.roomId);
    return ok(null);
  },
});
