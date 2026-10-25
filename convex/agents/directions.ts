/**
 * Gift directions for the map (D23 trial). Owner: Dev 4 for the trial; Dev 3 reviews.
 *
 * The council combines room-visible memories (and any trend clouds people
 * caught) into a few gift directions, each with one shopping search. Like
 * themes, a direction is an interpretation: it publishes nothing and never
 * touches budgets, caps, selection or approvals. When a new direction rests on
 * one broad memory, the council asks the room one question about her; the
 * member who answers publishes that answer as their own memory.
 */
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MapDirection, Result } from "../../lib/contracts";
import { requireMember } from "../lib/auth";
import { err, memberError, ok } from "../lib/result";
import { requestRoomTrend, usableTrendJob } from "../research/trendJobs";
import { BASE_INSTRUCTIONS, containsSensitiveData } from "./engine";
import { IDEA_CALLS_PER_WINDOW } from "./ideas";
import { configuredModel, validatedModelCall } from "./model";
import {
  acceptDirections, acceptProbe, type CaughtTrend, type DirectionDraft, directionsSchema, MAX_DIRECTIONS,
  MIN_MEMORIES_FOR_DIRECTIONS, presetDirections, probeSchema,
} from "./directionsPolicy";

const WINDOW_MS = 10 * 60 * 1000;
const GIFT_IDEA_PREFIX = "Gift idea: ";

export const directionContext = internalQuery({
  args: { roomId: v.id("rooms"), userId: v.string() },
  handler: async (ctx, { roomId, userId }) => {
    const member = await ctx.db.query("participants").withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId)).first();
    const room = await ctx.db.get(roomId);
    if (!member || !room || room.deletedAt) return null;
    const clues = (await ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
      .filter((c) => c.status === "active" && !c.text.startsWith(GIFT_IDEA_PREFIX));
    // Trend clouds someone caught (+1 net) from a still-usable sample: the only trends the council may weave in.
    const signals = await ctx.db.query("mapSignals").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(2000);
    const net = new Map<string, number>();
    for (const s of signals) if (s.targetKind === "trend") net.set(s.targetId, (net.get(s.targetId) ?? 0) + s.value);
    const caught: CaughtTrend[] = [];
    for (const [key, value] of net) {
      if (value <= 0 || caught.length >= 4) continue;
      const at = key.indexOf(":");
      const jobId = ctx.db.normalizeId("trendJobs", key.slice(0, at));
      const job = jobId ? await usableTrendJob(ctx, roomId, jobId) : null;
      const query = key.slice(at + 1);
      if (job?.sample?.suggestions.some((s) => s.query === query)) caught.push({ trendJobId: job._id, query });
    }
    const recent = await ctx.db.query("ideaCalls").withIndex("by_room", (q) => q.eq("roomId", roomId).gte("createdAt", Date.now() - WINDOW_MS)).take(IDEA_CALLS_PER_WINDOW + 1);
    const openQuestion = (await ctx.db.query("mapSharpens").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").first())?.status === "open";
    return {
      recipient: room.recipientDisplayName,
      knowledgeRevision: room.knowledgeRevision,
      participantId: member._id,
      memories: clues.slice(-40).map((c) => ({ id: c._id as string, kind: c.kind, text: c.text })),
      caught,
      openQuestion,
      overBudget: recent.length >= IDEA_CALLS_PER_WINDOW,
    };
  },
});

/** A direction with a research job keeps its gifts; only unresearched suggestions are replaced. */
async function isResearched(ctx: QueryCtx, roomId: Id<"rooms">, id: Id<"mapDirections">) {
  return !!(await ctx.db.query("researchJobs").withIndex("by_room_direction", (q) => q.eq("roomId", roomId).eq("directionId", id)).first());
}

export const storeDirections = internalMutation({
  args: {
    roomId: v.id("rooms"),
    participantId: v.id("participants"),
    knowledgeRevision: v.number(),
    source: v.union(v.literal("agent"), v.literal("preset")),
    directions: v.array(v.object({
      label: v.string(), query: v.string(), why: v.string(), clueIds: v.array(v.id("publishedClues")),
      trend: v.optional(v.object({ trendJobId: v.id("trendJobs"), query: v.string() })), broad: v.boolean(),
    })),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    // Memories changed while the council was thinking: these directions describe an older room.
    // One entry per draft, in order: its new ID, or null when it was skipped.
    if (!room || room.knowledgeRevision !== args.knowledgeRevision) return { stored: [] as (Id<"mapDirections"> | null)[], stale: true };
    const existing = await ctx.db.query("mapDirections").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect();
    const kept: Doc<"mapDirections">[] = [];
    for (const row of existing) {
      if (await isResearched(ctx, args.roomId, row._id)) kept.push(row);
      else await ctx.db.delete(row._id);
    }
    const keptQueries = new Set(kept.map((d) => d.query));
    const stored: (Id<"mapDirections"> | null)[] = [];
    let added = 0;
    const now = Date.now();
    for (const d of args.directions) {
      const cited: Id<"publishedClues">[] = [];
      for (const id of d.clueIds) {
        const clue = await ctx.db.get(id);
        if (clue?.roomId === args.roomId && clue.status === "active") cited.push(id);
      }
      if (kept.length + added >= MAX_DIRECTIONS || keptQueries.has(d.query) || cited.length !== d.clueIds.length) {
        stored.push(null);
        continue;
      }
      added += 1;
      stored.push(await ctx.db.insert("mapDirections", {
        roomId: args.roomId, label: d.label, query: d.query, why: d.why, clueIds: cited,
        ...(d.trend ? { trend: d.trend } : {}), broad: d.broad, source: args.source, knowledgeRevision: args.knowledgeRevision, createdAt: now,
      }));
    }
    // One room-level trend lookup per request: the newest interest or wish that has none yet.
    const clues = (await ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect())
      .filter((c) => c.status === "active" && (c.kind === "interest" || c.kind === "explicit_wish") && !c.text.startsWith(GIFT_IDEA_PREFIX));
    const looked = new Set((await ctx.db.query("trendJobs").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect()).map((j) => j.publishedClueId as string));
    for (const clue of [...clues].reverse()) {
      if (looked.has(clue._id)) continue;
      if ((await requestRoomTrend(ctx, room, args.participantId, clue._id)).ok) break;
    }
    return { stored, stale: false };
  },
});

export const storeProbe = internalMutation({
  args: {
    roomId: v.id("rooms"),
    askedBy: v.id("participants"),
    directionId: v.id("mapDirections"),
    knowledgeRevision: v.number(),
    question: v.string(),
    options: v.array(v.object({ label: v.string(), clue: v.string() })),
  },
  handler: async (ctx, args) => {
    const latest = await ctx.db.query("mapSharpens").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).order("desc").first();
    // Never talk over a question the room hasn't answered yet.
    if (latest?.status === "open") return null;
    return ctx.db.insert("mapSharpens", {
      roomId: args.roomId, askedBy: args.askedBy, directionId: args.directionId, knowledgeRevision: args.knowledgeRevision,
      source: "agent", question: args.question, options: args.options.map((o) => ({ ...o, listingIds: [] })), finalistIds: [],
      status: "open", createdAt: Date.now(),
    });
  },
});

const INSTRUCTIONS = `\nFriends shared numbered memories about {name} to choose a gift together. Propose 2-${MAX_DIRECTIONS} gift directions. A good direction COMBINES at least two memories into something more specific than either alone (for example "loves hiking" + "drawn to retro patterns" -> "vintage-pattern trail jacket"). A direction may rest on a single memory only if that memory is an explicit wish. For each: label (2-6 plain words naming the gift direction), query (a 2-6 word shopping search for real products in that direction; no brand unless a memory names it), why (one sentence that says which memories it joins and how, without inventing facts), memories (the numbers it combines), broad (true when it still rests on one general interest and a question to the friends would sharpen it). Optional trend: the index of one caught trend search it builds on, only if that search truly fits. Avoid anything the "avoid" memories say she already owns or dislikes. Never infer health, religion, politics, sexuality, age, body or other sensitive traits. No prices or links. Return JSON {"directions":[{"label":"...","query":"...","why":"...","memories":[0,2],"broad":false}]}.`;

const PROBE_INSTRUCTIONS = `\nFriends are choosing a gift for {name}. One gift direction is still broad. Ask ONE short, warm question about {name} herself (not about products) whose answer would make that direction more specific. Example for "hiking": "Is {name} more of a sunrise day-hiker or an overnight camper?" Give 2-3 answers. Each answer: label (2-5 words) and clue (one plain sentence about {name} that a friend could confirm, e.g. "{name} mostly does early-morning day hikes."). Ground it in the friends' memories. Never ask about health, religion, politics, sexuality, age, body, money or other sensitive traits. No brands, prices or links. Return JSON {"question":"...","options":[{"label":"...","clue":"..."}]}.`;

export const propose = action({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<{ directions: number; source: "agent" | "preset"; asked: boolean }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return err("unauthorized", "Sign in first.");
    const room = await ctx.runQuery(internal.agents.directions.directionContext, { roomId, userId });
    if (!room) return err("unauthorized", "Room membership required.");
    const usable = room.memories.filter((m) => m.kind === "interest" || m.kind === "explicit_wish");
    if (room.memories.length < MIN_MEMORIES_FOR_DIRECTIONS || !usable.length)
      return err("validation_failed", "Share at least two memories, including something she loves or wished for.");

    const positive = room.memories.filter((m) => m.kind !== "ownership" && m.kind !== "exclusion");
    const avoid = room.memories.filter((m) => m.kind === "ownership" || m.kind === "exclusion").map((m) => m.text);
    let source: "agent" | "preset" = "preset";
    let drafts: DirectionDraft[] = presetDirections(positive, room.recipient);
    const canThink = !room.overBudget && !!process.env.LLM_API_KEY;
    if (canThink) {
      await ctx.runMutation(internal.agents.ideas.recordIdeaCall, { roomId });
      try {
        const output = await validatedModelCall(configuredModel(), {
          role: "extractor",
          instructions: BASE_INSTRUCTIONS + INSTRUCTIONS,
          input: {
            recipient: "{name}",
            memories: positive.map((m, n) => ({ n, kind: m.kind, text: m.text })),
            avoid,
            caughtTrends: room.caught.map((t, i) => ({ i, search: t.query })),
          },
        }, directionsSchema);
        const named = (s: string) => s.replaceAll("{name}", room.recipient);
        const accepted = acceptDirections(output, positive, room.caught, containsSensitiveData)
          .map((d) => ({ ...d, label: named(d.label), why: named(d.why) }));
        if (accepted.length) {
          drafts = accepted;
          source = "agent";
        }
      } catch {
        // Presets above.
      }
    }
    if (!drafts.length) return err("validation_failed", "The council couldn't combine these memories yet. Share a wish or another interest.");
    const result = await ctx.runMutation(internal.agents.directions.storeDirections, {
      roomId, participantId: room.participantId, knowledgeRevision: room.knowledgeRevision, source,
      directions: drafts.map(({ trend, clueIds, ...rest }) => ({
        ...rest, clueIds: clueIds as Id<"publishedClues">[],
        ...(trend ? { trend: { trendJobId: trend.trendJobId as Id<"trendJobs">, query: trend.query } } : {}),
      })),
    });
    if (result.stale) return err("stale_job", "Memories changed while the council was thinking. Try again.");

    // One probe question for the first new broad direction, unless the room already has one open.
    let asked = false;
    const broadIndex = drafts.findIndex((d, i) => d.broad && !!result.stored[i]);
    const broadId = broadIndex >= 0 ? result.stored[broadIndex] : null;
    if (broadId && !room.openQuestion && canThink) {
      const broad = drafts[broadIndex]!;
      try {
        const output = await validatedModelCall(configuredModel(), {
          role: "extractor",
          instructions: BASE_INSTRUCTIONS + PROBE_INSTRUCTIONS,
          input: { recipient: "{name}", direction: broad.label, memories: positive.map((m) => m.text) },
        }, probeSchema);
        const probe = acceptProbe(output, containsSensitiveData);
        if (probe) {
          const named = (s: string) => s.replaceAll("{name}", room.recipient);
          asked = !!(await ctx.runMutation(internal.agents.directions.storeProbe, {
            roomId, askedBy: room.participantId, directionId: broadId, knowledgeRevision: room.knowledgeRevision,
            question: named(probe.question), options: probe.options.map((o) => ({ label: named(o.label), clue: named(o.clue) })),
          }));
        }
      } catch {
        // No question is better than an invented one.
      }
    }
    return ok({ directions: result.stored.filter(Boolean).length, source, asked });
  },
});

export const list = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<MapDirection[]>(member.code);
    const rows = await ctx.db.query("mapDirections").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(MAX_DIRECTIONS * 3);
    const out: MapDirection[] = [];
    for (const r of rows) {
      out.push({
        id: r._id, label: r.label, query: r.query, why: r.why, clueIds: r.clueIds, broad: r.broad, source: r.source,
        ...(r.trend ? { trend: r.trend } : {}),
        stale: r.knowledgeRevision < member.room.knowledgeRevision,
        researched: await isResearched(ctx, roomId, r._id),
      });
    }
    return ok(out);
  },
});
