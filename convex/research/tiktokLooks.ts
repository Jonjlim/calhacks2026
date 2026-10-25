/**
 * TikTok inspiration for trend clouds (D23 trial). Owner: Dev 4.
 *
 * Tapping "See TikToks" on a trend cloud runs one capped public TikTok search
 * for that cloud's own query (a sourced, screened Google Trends suggestion, so
 * nothing personal is ever searched), and shows a few public posts as
 * inspiration. Only post links are kept: no captions, profiles or media.
 * One search per room and query per day; everyone in the room sees it.
 */
import { v } from "convex/values";
import { normalizeTikTokPosts } from "../../lib/research/tiktok";
import type { Result } from "../../lib/contracts";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, mutation, query } from "../_generated/server";
import { requireMember } from "../lib/auth";
import { err, memberError, ok } from "../lib/result";
import { logTrail } from "../lib/trail";
import { createFashionProvider, FASHION_DEADLINE_MS } from "./fashionProvider";
import { usableTrendJob } from "./trendJobs";

export const LOOK_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_LOOK_POSTS = 6;
const POLL_MS = 5_000;
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface TikTokLook {
  id: string;
  query: string;
  status: Doc<"tiktokLooks">["status"];
  posts: { url: string; videoId: string }[];
  retrievedAt?: number;
  lastError?: string;
}

/** Show TikToks for one trend cloud. Reuses a fresh or running search for the same query. */
export const look = mutation({
  args: { roomId: v.id("rooms"), trendJobId: v.id("trendJobs"), query: v.string() },
  handler: async (ctx, args): Promise<Result<{ lookId: Id<"tiktokLooks"> }>> => {
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return memberError<{ lookId: Id<"tiktokLooks"> }>(member.code);
    const job = await usableTrendJob(ctx, args.roomId, args.trendJobId);
    if (!job?.sample?.suggestions.some((s) => s.query === args.query)) return err("validation_failed", "Only a trend idea on this map can be looked up on TikTok.");
    const latest = await ctx.db.query("tiktokLooks").withIndex("by_room_query", (q) => q.eq("roomId", args.roomId).eq("query", args.query)).order("desc").first();
    const now = Date.now();
    if (latest && (latest.status === "pending" || latest.status === "running"
      || (latest.status === "succeeded" && latest.retrievedAt && now - latest.retrievedAt < LOOK_TTL_MS))) return ok({ lookId: latest._id });
    const lookId = await ctx.db.insert("tiktokLooks", { roomId: args.roomId, query: args.query, trendJobId: args.trendJobId, requestedBy: member.me._id, status: "pending", postUrls: [], createdAt: now });
    await ctx.scheduler.runAfter(0, internal.research.tiktokLooks.start, { lookId });
    return ok({ lookId });
  },
});

export const claim = internalMutation({
  args: { lookId: v.id("tiktokLooks") },
  handler: async (ctx, { lookId }) => {
    const row = await ctx.db.get(lookId);
    if (row?.status !== "pending") return null;
    await ctx.db.patch(lookId, { status: "running" });
    return { query: row.query };
  },
});

/** The paid run started: keep its id so polling never starts a second one. */
export const saveRun = internalMutation({
  args: { lookId: v.id("tiktokLooks"), runId: v.string() },
  handler: async (ctx, { lookId, runId }) => {
    const row = await ctx.db.get(lookId);
    if (row?.status === "running") await ctx.db.patch(lookId, { providerRunId: runId });
  },
});

export const settle = internalMutation({
  args: { lookId: v.id("tiktokLooks"), status: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("uncertain")), postUrls: v.optional(v.array(v.string())), message: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.lookId);
    if (!row || (row.status !== "running" && row.status !== "pending")) return;
    await ctx.db.patch(args.lookId, {
      status: args.status, ...(args.postUrls ? { postUrls: args.postUrls, retrievedAt: Date.now() } : {}),
      ...(args.message ? { lastError: args.message } : {}),
    });
    if (args.status === "succeeded") {
      const who = (await ctx.db.get(row.requestedBy))?.displayName || "A friend";
      await logTrail(ctx, row.roomId, { stage: "steering", actor: "person", participantId: row.requestedBy, outcome: "info",
        text: `${who} looked at ${args.postUrls?.length ?? 0} public TikToks for the trend idea “${row.query}” (inspiration only, not facts about her).` });
    }
  },
});

export const start = internalAction({
  args: { lookId: v.id("tiktokLooks") },
  handler: async (ctx, { lookId }): Promise<null> => {
    const claimed = await ctx.runMutation(internal.research.tiktokLooks.claim, { lookId });
    if (!claimed) return null;
    const run = await createFashionProvider(process.env.APIFY_TOKEN ?? "").startInspiration(claimed.query);
    if (run.kind !== "ok") {
      await ctx.runMutation(internal.research.tiktokLooks.settle, { lookId, status: run.kind, message: run.message });
      return null;
    }
    await ctx.runMutation(internal.research.tiktokLooks.saveRun, { lookId, runId: run.value.id });
    await ctx.scheduler.runAfter(POLL_MS, internal.research.tiktokLooks.poll, { lookId, startedAt: Date.now() });
    return null;
  },
});

export const runOf = internalMutation({
  args: { lookId: v.id("tiktokLooks") },
  handler: async (ctx, { lookId }) => {
    const row = await ctx.db.get(lookId);
    return row?.status === "running" && row.providerRunId ? { runId: row.providerRunId, query: row.query } : null;
  },
});

export const poll = internalAction({
  args: { lookId: v.id("tiktokLooks"), startedAt: v.number() },
  handler: async (ctx, { lookId, startedAt }): Promise<null> => {
    const current = await ctx.runMutation(internal.research.tiktokLooks.runOf, { lookId });
    if (!current) return null;
    const provider = createFashionProvider(process.env.APIFY_TOKEN ?? "");
    const run = await provider.getRun(current.runId);
    if (run.kind !== "ok") {
      await ctx.runMutation(internal.research.tiktokLooks.settle, { lookId, status: run.kind, message: run.message });
      return null;
    }
    if (run.value.status === "SUCCEEDED" && run.value.defaultDatasetId) {
      const dataset = await provider.getDataset(run.value.defaultDatasetId);
      if (dataset.kind !== "ok") {
        await ctx.runMutation(internal.research.tiktokLooks.settle, { lookId, status: dataset.kind, message: dataset.message });
        return null;
      }
      const now = Date.now();
      // Public posts only (private accounts and ads are already dropped); keep links, nothing else.
      const posts = normalizeTikTokPosts(dataset.value, { seedTerm: current.query, windowStart: now - WINDOW_MS, windowEnd: now, retrievedAt: now })
        .filter((p) => p.advertising !== "flagged").slice(0, MAX_LOOK_POSTS);
      await ctx.runMutation(internal.research.tiktokLooks.settle, { lookId, status: "succeeded", postUrls: posts.map((p) => p.sourceUrl) });
    } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.value.status)) {
      await ctx.runMutation(internal.research.tiktokLooks.settle, { lookId, status: "failed", message: "The TikTok search didn't finish." });
    } else if (Date.now() - startedAt > FASHION_DEADLINE_MS) {
      await ctx.runMutation(internal.research.tiktokLooks.settle, { lookId, status: "uncertain", message: "The TikTok search is taking too long." });
    } else {
      await ctx.scheduler.runAfter(POLL_MS, internal.research.tiktokLooks.poll, { lookId, startedAt });
    }
    return null;
  },
});

/** The TikTok id at the end of a post link, for TikTok's own embedded player. */
export const videoIdOf = (url: string) => /\/(?:video|photo)\/(\d+)/.exec(url)?.[1] ?? null;

export const list = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<TikTokLook[]>(member.code);
    const rows = await ctx.db.query("tiktokLooks").withIndex("by_room_query", (q) => q.eq("roomId", roomId)).take(40);
    return ok<TikTokLook[]>(rows.map((r) => ({
      id: r._id, query: r.query, status: r.status,
      posts: r.postUrls.flatMap((url) => { const videoId = videoIdOf(url); return videoId ? [{ url, videoId }] : []; }),
      ...(r.retrievedAt ? { retrievedAt: r.retrievedAt } : {}),
      ...(r.lastError ? { lastError: r.lastError } : {}),
    })));
  },
});
