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
import { action, type ActionCtx, internalAction, internalMutation, internalQuery, type MutationCtx, query, type QueryCtx } from "../_generated/server";
import { fadeOf } from "../../lib/map/directions";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MapDirection, Result } from "../../lib/contracts";
import { requireMember } from "../lib/auth";
import { err, memberError, ok } from "../lib/result";
import { requestRoomTrend, usableTrendJob } from "../research/trendJobs";
import { logTrail, nameOf } from "../lib/trail";
import { BASE_INSTRUCTIONS, containsSensitiveData } from "./engine";
import { IDEA_CALLS_PER_WINDOW } from "./ideas";
import { configuredModel, validatedModelCall } from "./model";
import {
  acceptProbe, type CaughtTrend, type DirectionDraft, type DirectionMemory, directionsSchema, MAX_DIRECTIONS, memoryReadings,
  MIN_MEMORIES_FOR_DIRECTIONS, presetDirections, probeSchema, type RejectedDirection, screenDirections,
} from "./directionsPolicy";

const WINDOW_MS = 10 * 60 * 1000;
const GIFT_IDEA_PREFIX = "Gift idea: ";

interface DirectionRoom {
  recipient: string;
  knowledgeRevision: number;
  participantId: Id<"participants">;
  memories: DirectionMemory[];
  caught: CaughtTrend[];
  openQuestion: boolean;
  overBudget: boolean;
}

/** Plain words for a pass reason, as friends tapped it. */
export const PASS_REASON_TEXT: Record<PassReason, string> = {
  style: "not her style", price: "too pricey", has_similar: "she has something like it", vibe: "wrong vibe",
};
export type PassReason = "style" | "price" | "has_similar" | "vibe";

/** A signed-in member's request, or (for a scheduled replacement) the member whose pass triggered it. */
export const directionContext = internalQuery({
  args: { roomId: v.id("rooms"), userId: v.optional(v.string()), participantId: v.optional(v.id("participants")) },
  handler: async (ctx, { roomId, userId, participantId }): Promise<DirectionRoom | null> => {
    const member = participantId ? await ctx.db.get(participantId)
      : userId ? await ctx.db.query("participants").withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId)).first() : null;
    const room = await ctx.db.get(roomId);
    if (!member || member.roomId !== roomId || !room || room.deletedAt) return null;
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
      memories: clues.slice(-40).map((c): DirectionMemory => ({ id: c._id as string, kind: c.kind, text: c.text })),
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

/** Gifts from one direction the room let go before the council gives up on the direction itself. */
export const GIFT_PASSES_TO_RETIRE = 2;

/**
 * The council reacting to passes (D23 trial). Called inside a pass on a
 * direction or on one of its gifts: once the room has let the direction go, or
 * let two of its gifts go, the direction is retired (never deleted) and one
 * replacement is scheduled that avoids it and the reasons friends gave.
 */
export async function reactToPasses(ctx: MutationCtx, roomId: Id<"rooms">, directionId: Id<"mapDirections">, by: Id<"participants">): Promise<boolean> {
  const direction = await ctx.db.get(directionId);
  if (!direction || direction.roomId !== roomId || direction.retiredAt) return false;
  const members = (await ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect()).length;
  const signals = (await ctx.db.query("mapSignals").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(2000))
    .filter((s) => s.targetKind === "direction" && s.targetId === directionId);
  const tally = { up: signals.filter((s) => s.value > 0).length, down: signals.filter((s) => s.value < 0).length };
  const reasons = signals.flatMap((s) => (s.value < 0 && s.reason ? [PASS_REASON_TEXT[s.reason]] : []));
  let giftsGone = 0;
  const job = await ctx.db.query("researchJobs").withIndex("by_room_direction", (q) => q.eq("roomId", roomId).eq("directionId", directionId))
    .order("desc").filter((q) => q.eq(q.field("status"), "succeeded")).first();
  if (job) {
    for (const listing of await ctx.db.query("productListings").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(60)) {
      const votes = await ctx.db.query("votes").withIndex("by_listing_participant", (q) => q.eq("listingId", listing._id)).collect();
      if (!votes.length) continue;
      const gift = { up: votes.filter((x) => x.value === "up").length, down: votes.filter((x) => x.value === "down").length };
      if (fadeOf(gift, members) === "gone") giftsGone += 1;
      for (const x of votes) if (x.value === "down" && x.reason) reasons.push(PASS_REASON_TEXT[x.reason]);
    }
  }
  const directionGone = fadeOf(tally, members) === "gone";
  if (!directionGone && giftsGone < GIFT_PASSES_TO_RETIRE) return false;

  await ctx.db.patch(directionId, { retiredAt: Date.now() });
  const why = [...new Set(reasons)];
  await logTrail(ctx, roomId, { stage: "council", actor: "council", outcome: "rejected", directionId, clueIds: direction.clueIds,
    text: `Retired “${direction.label}” after the room ${directionGone ? "passed on it" : `passed on ${giftsGone} of its gifts`}${why.length ? ` (${why.join(", ")})` : ""}. Asked the council for something different.` });
  // Everything the room already turned down, so the replacement doesn't circle back.
  const earlier = (await ctx.db.query("mapDirections").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect())
    .filter((d) => d.retiredAt && d._id !== directionId).slice(-5).map((d) => `${d.label} (search: ${d.query})`);
  await ctx.scheduler.runAfter(0, internal.agents.directions.replace, {
    roomId, directionId, participantId: by,
    passed: [`${direction.label} (search: ${direction.query})${why.length ? `: ${why.join(", ")}` : ""}`, ...earlier],
  });
  return true;
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
    /** For the decision log: how memories were read, and what the checks threw out. */
    notes: v.optional(v.object({
      readings: v.array(v.object({ text: v.string(), reading: v.string() })),
      rejected: v.array(v.object({ label: v.string(), reason: v.string() })),
    })),
    /** A replacement for one retired direction: adds beside the others instead of replacing them all. */
    replaces: v.optional(v.id("mapDirections")),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    // Memories changed while the council was thinking: these directions describe an older room.
    // One entry per draft, in order: its new ID, or null when it was skipped.
    if (!room || room.knowledgeRevision !== args.knowledgeRevision) return { stored: [] as (Id<"mapDirections"> | null)[], stale: true };
    const existing = await ctx.db.query("mapDirections").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect();
    const kept: Doc<"mapDirections">[] = [];
    for (const row of existing) {
      // A replacement leaves every other direction alone; a fresh request clears unresearched ones. Retired ones are history.
      if (args.replaces || row.retiredAt || await isResearched(ctx, args.roomId, row._id)) { if (!row.retiredAt) kept.push(row); }
      else await ctx.db.delete(row._id);
    }
    const retired = args.replaces ? await ctx.db.get(args.replaces) : null;
    if (retired) kept.push(retired); // its search must not come straight back
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
      const live = kept.length - (retired ? 1 : 0);
      if (live + added >= MAX_DIRECTIONS || (args.replaces && added >= 1) || keptQueries.has(d.query) || cited.length !== d.clueIds.length) {
        stored.push(null);
        continue;
      }
      added += 1;
      stored.push(await ctx.db.insert("mapDirections", {
        roomId: args.roomId, label: d.label, query: d.query, why: d.why, clueIds: cited,
        ...(d.trend ? { trend: d.trend } : {}), broad: d.broad, source: args.source, knowledgeRevision: args.knowledgeRevision, createdAt: now,
        ...(args.replaces ? { replaces: args.replaces } : {}),
      }));
    }
    if (retired) {
      // The council's answer to the room's passes, told as one line.
      const first = args.directions.findIndex((_, i) => !!stored[i]);
      const d = args.directions[first];
      await logTrail(ctx, args.roomId, { stage: "council", actor: "council", outcome: d ? "kept" : "info", clueIds: d?.clueIds ?? [],
        ...(d ? { directionId: stored[first]! } : {}),
        text: d ? `Suggested “${d.label}” in place of “${retired.label}”: ${d.why} Search: “${d.query}”.`
          : `Couldn’t find a different direction to replace “${retired.label}” yet. Share another memory and ask again.` });
      return { stored, stale: false };
    }
    // The decision log: how memories were read, what the council proposed and why, and what the checks threw out.
    const who = await nameOf(ctx, args.participantId);
    const readings = args.notes?.readings ?? [];
    if (readings.length) await logTrail(ctx, args.roomId, { stage: "memories", actor: "council", outcome: "info",
      text: `Read the memories as search words: ${readings.map((r) => `“${r.text}” → ${r.reading}`).join("; ")}.` });
    const storedDrafts = args.directions.flatMap((d, i) => (stored[i] ? [{ d, id: stored[i]! }] : []));
    await logTrail(ctx, args.roomId, { stage: "council", actor: "council", participantId: args.participantId, outcome: "info",
      text: `${who} asked the council to combine memories. ${args.source === "agent" ? "The model" : "A simple rule (no model was available)"} proposed ${args.directions.length + (args.notes?.rejected.length ?? 0)} ${args.directions.length === 1 ? "direction" : "directions"}.` });
    for (const { d, id } of storedDrafts) {
      await logTrail(ctx, args.roomId, { stage: "council", actor: "council", outcome: "kept", directionId: id, clueIds: d.clueIds,
        text: `Kept “${d.label}”: ${d.why}${d.trend ? ` It builds on the caught trend “${d.trend.query}”.` : ""} Search: “${d.query}”.` });
    }
    for (const r of args.notes?.rejected ?? []) {
      await logTrail(ctx, args.roomId, { stage: "council", actor: "checks", outcome: "rejected", text: `Threw out “${r.label}”: ${r.reason}.` });
    }
    for (const [i, d] of args.directions.entries()) {
      if (stored[i]) continue;
      await logTrail(ctx, args.roomId, { stage: "council", actor: "checks", outcome: "rejected",
        text: `Skipped “${d.label}”: ${keptQueries.has(d.query) ? "a direction you already searched covers it" : "the map already holds four directions or a memory it cited was withdrawn"}.` });
    }

    // One room-level trend lookup per request: the newest interest or wish that has none yet.
    const clues = (await ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect())
      .filter((c) => c.status === "active" && (c.kind === "interest" || c.kind === "explicit_wish") && !c.text.startsWith(GIFT_IDEA_PREFIX));
    const looked = new Set((await ctx.db.query("trendJobs").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect()).map((j) => j.publishedClueId as string));
    for (const clue of [...clues].reverse()) {
      if (looked.has(clue._id)) continue;
      const trend = await requestRoomTrend(ctx, room, args.participantId, clue._id);
      if (!trend.ok) continue;
      const seed = (await ctx.db.get(trend.value.jobId))?.seedTerm;
      await logTrail(ctx, args.roomId, { stage: "council", actor: "trends", outcome: "info", clueIds: [clue._id],
        text: `Started one Google Trends lookup for “${seed ?? clue.text}” (from “${clue.text}”), so a few related searches can drift by as ideas.` });
      break;
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
    const id = await ctx.db.insert("mapSharpens", {
      roomId: args.roomId, askedBy: args.askedBy, directionId: args.directionId, knowledgeRevision: args.knowledgeRevision,
      source: "agent", question: args.question, options: args.options.map((o) => ({ ...o, listingIds: [] })), finalistIds: [],
      status: "open", createdAt: Date.now(),
    });
    const direction = await ctx.db.get(args.directionId);
    await logTrail(ctx, args.roomId, { stage: "council", actor: "council", outcome: "info", directionId: args.directionId,
      text: `“${direction?.label ?? "A direction"}” was still broad, so the council asked the room one question: “${args.question}”` });
    return id;
  },
});

const INSTRUCTIONS = `\nFriends shared numbered memories about {name} to choose a gift together. Propose 2-${MAX_DIRECTIONS} gift directions. A good direction COMBINES at least two memories into something more specific than either alone (for example "loves hiking" + "drawn to retro patterns" -> "vintage-pattern trail jacket"). A direction may rest on a single memory only if that memory is an explicit wish. For each: label (2-6 plain words naming the gift direction), query (a 2-6 word shopping search for real products in that direction; no brand unless a memory names it), why (one sentence that says which memories it joins and how, without inventing facts), memories (the numbers it combines), broad (true when it still rests on one general interest and a question to the friends would sharpen it). Optional trend: the index of one caught trend search it builds on, only if that search truly fits. Avoid anything the "avoid" memories say she already owns or dislikes. Never infer health, religion, politics, sexuality, age, body or other sensitive traits. No prices or links. Return JSON {"directions":[{"label":"...","query":"...","why":"...","memories":[0,2],"broad":false}]}.`;

const PROBE_INSTRUCTIONS = `\nFriends are choosing a gift for {name}. One gift direction is still broad. Ask ONE short, warm question about {name} herself (not about products) whose answer would make that direction more specific. Example for "hiking": "Is {name} more of a sunrise day-hiker or an overnight camper?" Give 2-3 answers. Each answer: label (2-5 words) and clue (one plain sentence about {name} that a friend could confirm, e.g. "{name} mostly does early-morning day hikes."). Ground it in the friends' memories. Never ask about health, religion, politics, sexuality, age, body, money or other sensitive traits. No brands, prices or links. Return JSON {"question":"...","options":[{"label":"...","clue":"..."}]}.`;

/**
 * The council's drafting step, shared by a fresh request and a replacement:
 * the model when it is available and within the room's budget, the simple
 * rule otherwise, and the same checks either way. `passed` lists directions
 * the room turned down, with their reasons, so a replacement goes elsewhere.
 */
async function draftDirections(ctx: ActionCtx, roomId: Id<"rooms">, room: DirectionRoom, passed: string[] = []) {
  const positive = room.memories.filter((m) => m.kind !== "ownership" && m.kind !== "exclusion");
  const avoid = room.memories.filter((m) => m.kind === "ownership" || m.kind === "exclusion").map((m) => m.text);
  let source: "agent" | "preset" = "preset";
  let drafts: DirectionDraft[] = presetDirections(positive, room.recipient);
  let rejected: RejectedDirection[] = [];
  const canThink = !room.overBudget && !!process.env.LLM_API_KEY;
  if (canThink) {
    await ctx.runMutation(internal.agents.ideas.recordIdeaCall, { roomId });
    try {
      const output = await validatedModelCall(configuredModel(), {
        role: "extractor",
        instructions: BASE_INSTRUCTIONS + INSTRUCTIONS + (passed.length ? PASSED_INSTRUCTIONS : ""),
        input: {
          recipient: "{name}",
          memories: positive.map((m, n) => ({ n, kind: m.kind, text: m.text })),
          avoid,
          caughtTrends: room.caught.map((t, i) => ({ i, search: t.query })),
          ...(passed.length ? { passedOn: passed } : {}),
        },
      }, directionsSchema);
      const named = (s: string) => s.replaceAll("{name}", room.recipient);
      const screened = screenDirections(output, positive, room.caught, containsSensitiveData);
      rejected = screened.rejected.map((r) => ({ ...r, label: named(r.label) }));
      const accepted = screened.accepted.map((d) => ({ ...d, label: named(d.label), why: named(d.why) }));
      if (accepted.length) {
        drafts = accepted;
        source = "agent";
      }
    } catch {
      // Presets above.
    }
  }
  return { positive, drafts, rejected, source, canThink };
}

const toStored = (drafts: DirectionDraft[]) => drafts.map(({ trend, clueIds, ...rest }) => ({
  ...rest, clueIds: clueIds as Id<"publishedClues">[],
  ...(trend ? { trend: { trendJobId: trend.trendJobId as Id<"trendJobs">, query: trend.query } } : {}),
}));

const PASSED_INSTRUCTIONS = `\nFriends passed on the directions in "passedOn" (with their reasons). Propose something clearly different that still combines the memories; respect the reasons (for "too pricey", aim for a simpler or smaller gift).`;

/**
 * The council's reaction to the room's passes (D23 trial): one replacement for
 * a retired direction, beside the others. Scheduled by the pass that retired it.
 */
export const replace = internalAction({
  args: { roomId: v.id("rooms"), directionId: v.id("mapDirections"), participantId: v.id("participants"), passed: v.array(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const room = await ctx.runQuery(internal.agents.directions.directionContext, { roomId: args.roomId, participantId: args.participantId });
    if (!room) return null;
    const { drafts, rejected, source } = await draftDirections(ctx, args.roomId, room, args.passed);
    await ctx.runMutation(internal.agents.directions.storeDirections, {
      roomId: args.roomId, participantId: room.participantId, knowledgeRevision: room.knowledgeRevision, source,
      directions: toStored(drafts), notes: { readings: [], rejected }, replaces: args.directionId,
    });
    return null;
  },
});

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

    const { positive, drafts, rejected, source, canThink } = await draftDirections(ctx, roomId, room);
    if (!drafts.length) return err("validation_failed", "The council couldn't combine these memories yet. Share a wish or another interest.");
    const result = await ctx.runMutation(internal.agents.directions.storeDirections, {
      roomId, participantId: room.participantId, knowledgeRevision: room.knowledgeRevision, source,
      directions: toStored(drafts),
      notes: { readings: memoryReadings(positive), rejected },
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
    // Retired directions are history ("How we got here"), not map nodes.
    const rows = (await ctx.db.query("mapDirections").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(60)).filter((r) => !r.retiredAt);
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
