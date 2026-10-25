/**
 * Direction signals on the gift map (D19, MAP-012). Owner: Dev 3.
 *
 * A member pulls a memory or theme toward the present (+1) or pushes it away
 * (−1). Signals are advisory and attributed: they shape the map's layout and
 * nothing else. They never publish, withdraw or edit a clue, and never touch
 * selection, budgets or caps. Listing votes stay in `votes.castVote`.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { err, memberError, ok } from "./lib/result";
import { usableTrendJob } from "./research/trendJobs";
import { logTrail } from "./lib/trail";

type TargetKind = "clue" | "theme" | "direction" | "trend";

/** The interim themes are the clue groups the map already uses; council themes are rows in `mapThemes`. */
const BUCKET_THEMES = new Set(["interest", "wish", "moment"]);

export const setDirection = mutation({
  args: {
    roomId: v.id("rooms"),
    // "direction" and "trend" are the D23 trial: pass/pull a direction; catch (+1) or let drift (−1) a trend cloud.
    targetKind: v.union(v.literal("clue"), v.literal("theme"), v.literal("direction"), v.literal("trend")),
    targetId: v.string(),
    /** 1 pulls toward the present, −1 pushes away, 0 takes the caller's signal back. */
    value: v.union(v.literal(1), v.literal(-1), v.literal(0)),
  },
  handler: async (ctx, { roomId, targetKind, targetId, value }) => {
    type Out = { targetKind: TargetKind; targetId: string; value: number };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Out>(member.code);

    // Only things that are really on this room's map can be signalled.
    if (targetKind === "clue") {
      const id = ctx.db.normalizeId("publishedClues", targetId);
      const clue = id ? await ctx.db.get(id) : null;
      if (!clue || clue.roomId !== roomId || clue.status !== "active") return err<Out>("not_found", "That memory isn't on this map.");
    } else if (targetKind === "direction") {
      const id = ctx.db.normalizeId("mapDirections", targetId);
      const direction = id ? await ctx.db.get(id) : null;
      if (!direction || direction.roomId !== roomId) return err<Out>("not_found", "That direction isn't on this map.");
      if (value !== 0) await logTrail(ctx, roomId, { stage: "steering", actor: "person", participantId: member.me._id, outcome: value > 0 ? "kept" : "rejected", directionId: direction._id,
        text: `${member.me.displayName || "A friend"} ${value > 0 ? "pulled in" : "passed on"} the direction “${direction.label}”.` });
    } else if (targetKind === "trend") {
      // A trend cloud is one returned suggestion of a usable sample in this room: "trendJobId:query".
      const at = targetId.indexOf(":");
      const id = at > 0 ? ctx.db.normalizeId("trendJobs", targetId.slice(0, at)) : null;
      const job = id ? await usableTrendJob(ctx, roomId, id) : null;
      const query = targetId.slice(at + 1);
      if (!job?.sample?.suggestions.some((s) => s.query === query)) return err<Out>("not_found", "That trend has drifted off this map.");
      if (value !== 0) await logTrail(ctx, roomId, { stage: "steering", actor: "person", participantId: member.me._id, outcome: value > 0 ? "kept" : "rejected",
        text: value > 0 ? `${member.me.displayName || "A friend"} caught the trend “${query}” for the council to use.` : `${member.me.displayName || "A friend"} let the trend “${query}” drift away.` });
    } else if (!BUCKET_THEMES.has(targetId)) {
      const id = ctx.db.normalizeId("mapThemes", targetId);
      const theme = id ? await ctx.db.get(id) : null;
      if (!theme || theme.roomId !== roomId) return err<Out>("not_found", "That theme isn't on this map.");
    }

    const existing = await ctx.db
      .query("mapSignals")
      .withIndex("by_member_target", (q) => q.eq("roomId", roomId).eq("participantId", member.me._id).eq("targetKind", targetKind).eq("targetId", targetId))
      .first();
    if (value === 0) {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) {
      await ctx.db.patch(existing._id, { value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("mapSignals", { roomId, participantId: member.me._id, targetKind, targetId, value, updatedAt: Date.now() });
    }
    return ok<Out>({ targetKind, targetId, value });
  },
});

export const listSignals = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    type Row = { targetKind: TargetKind; targetId: string; up: number; down: number; voters: { participantId: Id<"participants">; value: number; at: number }[] };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Row[]>(member.code);
    const rows = await ctx.db.query("mapSignals").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(2000);
    const byTarget = new Map<string, Row>();
    for (const r of rows) {
      const key = `${r.targetKind}:${r.targetId}`;
      const row = byTarget.get(key) ?? { targetKind: r.targetKind, targetId: r.targetId, up: 0, down: 0, voters: [] };
      if (r.value > 0) row.up += 1;
      else row.down += 1;
      row.voters.push({ participantId: r.participantId, value: r.value, at: r.updatedAt });
      byTarget.set(key, row);
    }
    return ok([...byTarget.values()]);
  },
});
