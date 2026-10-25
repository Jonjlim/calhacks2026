/**
 * The gift story (D26). Owner: Dev 4.
 *
 * `summary` is the reveal card for room members: what the council read, kept
 * and threw out, how much was searched, and how the group voted. The gift tag
 * is an opt-in, revocable link the organizer gives the recipient. Anyone with
 * its token reads `byToken`: published, positive memories (no authors), the
 * chosen gift without prices, the friends' first names and the same numbers.
 * Never private imports, unpublished clues, caps, prices or payment state.
 */
import { v } from "convex/values";
import type { Result } from "../lib/contracts";
import { topWords, type StoryWord } from "../lib/story/words";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { isLiveRoom, requireMember } from "./lib/auth";
import { err, memberError, ok } from "./lib/result";

const GIFT_IDEA_PREFIX = "Gift idea: ";
/** Kinds that read well to her. Exclusions, things she owns and guesses stay in the room. */
const STORY_KINDS = new Set<Doc<"publishedClues">["kind"]>(["interest", "explicit_wish", "timing"]);
const MAX_MEMORIES = 24;
const MAX_PHOTOS = 12;
const SCAN = 500;

export interface StoryStats {
  memories: number;
  friends: number;
  photos: number;
  themes: number;
  directions: number;
  thrownOut: number;
  searches: number;
  products: number;
  votes: number;
}

export interface GiftStory {
  recipientName: string;
  occasion: string;
  /** First names of everyone in the room. */
  friends: string[];
  gifts: { title: string; imageUrl?: string }[];
  memories: string[];
  words: StoryWord[];
  themes: string[];
  directions: { label: string; why: string }[];
  photos: string[];
  stats: StoryStats;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "A friend";

async function buildStory(ctx: QueryCtx, room: Doc<"rooms">, includePhotos: boolean): Promise<GiftStory> {
  const roomId = room._id;
  const [people, clues, themes, directions, searches, listings, votes, signals, trail] = await Promise.all([
    ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN),
    ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN),
    ctx.db.query("mapThemes").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN),
    ctx.db.query("mapDirections").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN),
    ctx.db.query("researchJobs").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN),
    ctx.db.query("productListings").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN),
    ctx.db.query("votes").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN),
    ctx.db.query("mapSignals").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN),
    ctx.db.query("roomTrail").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN),
  ]);
  const photoRows = await ctx.db.query("roomPhotos").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(SCAN);

  const active = clues.filter((c) => c.status === "active");
  const lovely = active.filter((c) => STORY_KINDS.has(c.kind) && !c.text.startsWith(GIFT_IDEA_PREFIX));
  const selection = room.currentSelectionId ? await ctx.db.get(room.currentSelectionId) : null;
  const gifts = selection?.status === "active"
    ? (selection.items ?? [{ listingSnapshot: { title: selection.listingSnapshot.title, imageUrl: (await ctx.db.get(selection.listingId))?.imageUrl } }])
      .map((i) => ({ title: i.listingSnapshot.title, ...(i.listingSnapshot.imageUrl ? { imageUrl: i.listingSnapshot.imageUrl } : {}) }))
    : [];
  const photos: string[] = [];
  if (includePhotos) {
    for (const row of photoRows.slice(-MAX_PHOTOS)) {
      const url = await ctx.storage.getUrl(row.storageId);
      if (url) photos.push(url);
    }
  }
  const kept = directions.filter((d) => d.retiredAt === undefined);
  return {
    recipientName: firstName(room.recipientDisplayName),
    occasion: room.occasion,
    friends: people.map((p) => firstName(p.displayName)),
    gifts,
    memories: lovely.slice(0, MAX_MEMORIES).map((c) => c.text.slice(0, 160)),
    words: topWords(lovely.map((c) => c.text), { exclude: [room.recipientDisplayName] }),
    themes: themes.map((t) => t.label),
    directions: kept.slice(0, 4).map((d) => ({ label: d.label, why: d.why })),
    photos,
    stats: {
      memories: active.length,
      friends: people.length,
      photos: photoRows.length,
      themes: themes.length,
      directions: directions.length,
      // Ideas a check refused, plus directions the room's passes retired.
      thrownOut: trail.filter((r) => r.outcome === "rejected").length + directions.filter((d) => d.retiredAt !== undefined).length,
      searches: searches.length,
      products: listings.length,
      votes: votes.filter((x) => x.value !== "flag_duplicate").length + signals.length,
    },
  };
}

/** The reveal card, for room members. */
export const summary = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<GiftStory>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<GiftStory>(member.code);
    return ok(await buildStory(ctx, member.room, true));
  },
});

export interface GiftTag { token: string; includePhotos: boolean; createdAt: number }

async function liveTag(ctx: QueryCtx, roomId: Id<"rooms">): Promise<Doc<"giftStories"> | null> {
  const rows = await ctx.db.query("giftStories").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(20);
  return rows.find((r) => r.revokedAt === undefined) ?? null;
}

/** The room's live gift tag, if the organizer made one. */
export const tag = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<GiftTag | null>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<GiftTag | null>(member.code);
    const row = await liveTag(ctx, roomId);
    return ok(row ? { token: row.token, includePhotos: row.includePhotos, createdAt: row.createdAt } : null);
  },
});

function newStoryToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Organizer only, once a gift is chosen. Reuses the live tag so the printed QR keeps working. */
export const createTag = mutation({
  args: { roomId: v.id("rooms"), includePhotos: v.boolean() },
  handler: async (ctx, { roomId, includePhotos }): Promise<Result<GiftTag>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<GiftTag>(member.code);
    if (member.me.role !== "organizer") return err("unauthorized", "Only the organizer can make the gift tag.");
    const selection = member.room.currentSelectionId ? await ctx.db.get(member.room.currentSelectionId) : null;
    if (selection?.status !== "active") return err("validation_failed", "Choose the gift first.");
    const live = await liveTag(ctx, roomId);
    if (live) {
      if (live.includePhotos !== includePhotos) await ctx.db.patch(live._id, { includePhotos });
      return ok({ token: live.token, includePhotos, createdAt: live.createdAt });
    }
    const createdAt = Date.now();
    const token = newStoryToken();
    await ctx.db.insert("giftStories", { roomId, token, createdBy: member.me._id, includePhotos, createdAt });
    return ok({ token, includePhotos, createdAt });
  },
});

/** Organizer only. The link stops working at once. */
export const revokeTag = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<{ revoked: number }>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<{ revoked: number }>(member.code);
    if (member.me.role !== "organizer") return err("unauthorized", "Only the organizer can take the gift tag back.");
    const rows = (await ctx.db.query("giftStories").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(20)).filter((r) => r.revokedAt === undefined);
    const now = Date.now();
    for (const row of rows) await ctx.db.patch(row._id, { revokedAt: now });
    return ok({ revoked: rows.length });
  },
});

/** Public: the recipient's view. No sign-in; the token is the key. Revoked, deleted or not-yet-chosen all read as not found. */
export const byToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<Result<GiftStory>> => {
    if (!/^[0-9a-f]{32}$/.test(token)) return err("not_found", "This gift tag doesn't exist.");
    const row = await ctx.db.query("giftStories").withIndex("by_token", (q) => q.eq("token", token)).unique();
    const room = row && row.revokedAt === undefined ? await ctx.db.get(row.roomId) : null;
    if (!row || !isLiveRoom(room)) return err("not_found", "This gift tag doesn't exist.");
    const story = await buildStory(ctx, room, row.includePhotos);
    if (!story.gifts.length) return err("not_found", "This gift tag doesn't exist.");
    return ok(story);
  },
});
