/**
 * Gift worlds: an opt-in, anonymized "zoom out" view of other gift sessions.
 * Owner: Dev 3 (backend); the world scene and cards belong to Dev 1.
 *
 * Privacy: the organizer shares a room explicitly and picks the (at most three)
 * published clue lines that appear. Everything else is coarse: occasion, a budget
 * band, friend count, clue-kind counts, and the final pick. Readers never receive
 * a room id, names, invite token, private imports, contribution limits or user ids.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { containsSensitiveData } from "./agents/engine";
import { getUserId, requireMember } from "./lib/auth";
import { cleanText } from "./lib/input";
import { err, memberError, ok } from "./lib/result";

type Band = Doc<"giftWorlds">["budgetBand"];
const MAX_HIGHLIGHTS = 3;
const HIGHLIGHT_MAX_CHARS = 80;

export function budgetBandOf(budgetMinor: number | undefined): Band {
  if (budgetMinor === undefined) return "unknown";
  if (budgetMinor < 2_500) return "under_25";
  if (budgetMinor < 5_000) return "25_50";
  if (budgetMinor < 10_000) return "50_100";
  return "100_plus";
}

/** Replaces the recipient's real name wherever it appears, so a shared line cannot identify them. */
export function anonymize(text: string, names: string[], alias: string): string {
  let out = text;
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue;
    out = out.replace(
      new RegExp(`(?<![\\w])${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "gi"),
      () => alias,
    );
  }
  return out;
}

/** The public projection of one world: nothing that identifies a room, person, or account. */
function publicView(row: Doc<"giftWorlds">, userId: string | null) {
  return {
    id: row._id,
    isSample: row.isSample,
    mine: !!userId && row.ownerUserId === userId,
    occasion: row.occasion,
    recipientAlias: row.recipientAlias,
    budgetBand: row.budgetBand,
    friends: row.friends,
    inputs: row.inputs,
    highlights: row.highlights,
    state: row.state,
    ...(row.outcome ? { outcome: row.outcome } : {}),
    sharedAt: row.sharedAt,
  };
}
export type PublicWorld = ReturnType<typeof publicView>;

export const shareWorld = mutation({
  args: {
    roomId: v.id("rooms"),
    recipientAlias: v.optional(v.string()),
    highlightClueIds: v.optional(v.array(v.id("publishedClues"))),
  },
  handler: async (ctx, args) => {
    type Out = { id: Id<"giftWorlds">; highlights: string[] };
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) return memberError<Out>(member.code);
    if (member.me.role !== "organizer")
      return err<Out>("unauthorized", "Only the organizer can share a room.");
    const userId = await getUserId(ctx);
    if (!userId) return err<Out>("unauthorized", "Sign in first.");

    const alias = cleanText(args.recipientAlias ?? "Someone special", 40);
    if (!alias) return err<Out>("validation_failed", "That name is too long.");
    const picked = args.highlightClueIds ?? [];
    if (new Set(picked).size > MAX_HIGHLIGHTS)
      return err<Out>("validation_failed", `Pick at most ${MAX_HIGHLIGHTS} clues to show.`);

    const published = await ctx.db
      .query("publishedClues")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    const active = published.filter((c) => c.status === "active");
    const names = [
      member.room.recipientDisplayName,
      ...(await ctx.db
        .query("participants")
        .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
        .collect()
      ).map((p) => p.displayName),
    ];
    const highlights: string[] = [];
    for (const id of new Set(picked)) {
      const clue = active.find((c) => c._id === id);
      if (!clue) return err<Out>("validation_failed", "Only active clues from this room can be shown.");
      if (containsSensitiveData(clue.text))
        return err<Out>("validation_failed", "One of those clues looks sensitive, so it can't be shared.");
      const line = cleanText(anonymize(clue.text, names, alias), HIGHLIGHT_MAX_CHARS);
      if (!line) return err<Out>("validation_failed", `Keep each shared line under ${HIGHLIGHT_MAX_CHARS} characters.`);
      highlights.push(line);
    }

    const counts = new Map<Doc<"publishedClues">["kind"], number>();
    for (const clue of active) counts.set(clue.kind, (counts.get(clue.kind) ?? 0) + 1);
    const selection = await ctx.db
      .query("giftSelections")
      .withIndex("by_room_status", (q) => q.eq("roomId", args.roomId).eq("status", "active"))
      .first();
    const listing = selection ? await ctx.db.get(selection.listingId) : null;
    const participants = await ctx.db
      .query("participants")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();

    const now = Date.now();
    const fields = {
      roomId: args.roomId,
      ownerUserId: userId,
      isSample: false,
      occasion: cleanText(member.room.occasion, 80) ?? "Gift",
      recipientAlias: alias,
      budgetBand: budgetBandOf(member.room.budgetMinor),
      friends: participants.length,
      inputs: [...counts.entries()].map(([kind, count]) => ({ kind, count })),
      highlights,
      state: selection ? ("chosen" as const) : ("exploring" as const),
      updatedAt: now,
    };
    const outcome = selection
      ? {
          title: anonymize(selection.listingSnapshot.title, names, alias),
          priceMinor: selection.listingSnapshot.priceMinor,
          priceStatus: selection.listingSnapshot.priceStatus,
          source: listing?.source ?? ("manual_fixture" as const),
        }
      : undefined;
    const existing = await ctx.db
      .query("giftWorlds")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();
    // `replace` so a withdrawn selection or removed highlight does not linger in public.
    if (existing) {
      await ctx.db.replace(existing._id, { ...fields, ...(outcome ? { outcome } : {}), sharedAt: existing.sharedAt });
      return ok<Out>({ id: existing._id, highlights });
    }
    const id = await ctx.db.insert("giftWorlds", { ...fields, ...(outcome ? { outcome } : {}), sharedAt: now });
    return ok<Out>({ id, highlights });
  },
});

export const unshareWorld = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<null>(member.code);
    if (member.me.role !== "organizer") return err<null>("unauthorized", "Only the organizer can unshare a room.");
    const existing = await ctx.db
      .query("giftWorlds")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return ok(null);
  },
});

/** Whether this room is currently public, and exactly what readers see. */
export const getMyWorldShare = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<PublicWorld | null>(member.code);
    const row = await ctx.db
      .query("giftWorlds")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .first();
    return ok<PublicWorld | null>(row ? publicView(row, await getUserId(ctx)) : null);
  },
});

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};

export const listWorlds = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getUserId(ctx);
    if (!userId) return err<{ worlds: PublicWorld[]; aggregate: WorldAggregate }>("unauthorized", "Sign in first.");
    const rows = await ctx.db
      .query("giftWorlds")
      .withIndex("by_shared")
      .order("desc")
      .take(Math.min(Math.max(Math.floor(limit ?? 30), 1), 60));
    const prices = rows.flatMap((r) =>
      r.outcome?.priceStatus === "observed" && r.outcome.priceMinor !== undefined ? [r.outcome.priceMinor] : [],
    );
    const kindCounts = new Map<string, number>();
    for (const r of rows) for (const i of r.inputs) kindCounts.set(i.kind, (kindCounts.get(i.kind) ?? 0) + i.count);
    const occasions = new Map<string, number>();
    for (const r of rows) occasions.set(r.occasion, (occasions.get(r.occasion) ?? 0) + 1);
    const aggregate: WorldAggregate = {
      worlds: rows.length,
      samples: rows.filter((r) => r.isSample).length,
      chosen: rows.filter((r) => r.state === "chosen").length,
      medianFriends: median(rows.map((r) => r.friends)),
      medianChosenPriceMinor: median(prices),
      topInputKinds: [...kindCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([kind, count]) => ({ kind, count })),
      topOccasions: [...occasions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([occasion, count]) => ({ occasion, count })),
    };
    return ok({ worlds: rows.map((r) => publicView(r, userId)), aggregate });
  },
});

export interface WorldAggregate {
  worlds: number;
  samples: number;
  chosen: number;
  medianFriends: number | null;
  medianChosenPriceMinor: number | null;
  topInputKinds: Array<{ kind: string; count: number }>;
  topOccasions: Array<{ occasion: string; count: number }>;
}

const SAMPLES: Array<Omit<Doc<"giftWorlds">, "_id" | "_creationTime" | "roomId" | "ownerUserId" | "isSample" | "sharedAt" | "updatedAt">> = [
  { occasion: "Birthday", recipientAlias: "A new potter", budgetBand: "50_100", friends: 4, inputs: [{ kind: "interest", count: 3 }, { kind: "ownership", count: 1 }], highlights: ["Keeps saying she wants to try pottery", "Already has a starter kit"], state: "chosen", outcome: { title: "Intro wheel-throwing class (4 sessions)", priceMinor: 9500, priceStatus: "observed", source: "manual_fixture" } },
  { occasion: "Housewarming", recipientAlias: "A plant parent", budgetBand: "25_50", friends: 3, inputs: [{ kind: "interest", count: 2 }, { kind: "exclusion", count: 1 }], highlights: ["Loves anything green", "No more succulents"], state: "chosen", outcome: { title: "Self-watering herb planter set", priceMinor: 3400, priceStatus: "observed", source: "manual_fixture" } },
  { occasion: "Graduation", recipientAlias: "A future nurse", budgetBand: "100_plus", friends: 7, inputs: [{ kind: "explicit_wish", count: 2 }, { kind: "timing", count: 1 }], highlights: ["Needs good shoes for long shifts"], state: "chosen", outcome: { title: "Cushioned clinical shoes", priceMinor: 12000, priceStatus: "observed", source: "manual_fixture" } },
  { occasion: "Anniversary", recipientAlias: "A couple who hikes", budgetBand: "50_100", friends: 2, inputs: [{ kind: "interest", count: 4 }], highlights: ["Weekend trail people"], state: "exploring" },
  { occasion: "Birthday", recipientAlias: "A coffee nerd", budgetBand: "25_50", friends: 5, inputs: [{ kind: "interest", count: 2 }, { kind: "ownership", count: 2 }, { kind: "exclusion", count: 1 }], highlights: ["Owns a grinder already", "Wants to learn latte art"], state: "chosen", outcome: { title: "Latte art workshop for two", priceMinor: 4500, priceStatus: "observed", source: "manual_fixture" } },
  { occasion: "Retirement", recipientAlias: "A retiring teacher", budgetBand: "100_plus", friends: 9, inputs: [{ kind: "explicit_wish", count: 3 }, { kind: "interest", count: 2 }], highlights: ["Wants to finally learn watercolor"], state: "chosen", outcome: { title: "Watercolor course and brush set", priceMinor: 18000, priceStatus: "observed", source: "manual_fixture" } },
];

/** Demo only: labelled samples so the zoom-out view has company on a fresh deployment. */
export const seedSampleWorlds = mutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.DEMO_SEED_ENABLED !== "true")
      return err<{ added: number }>("refused", "Demo seeding is not enabled on this deployment.");
    if (!(await getUserId(ctx))) return err<{ added: number }>("unauthorized", "Sign in first.");
    const existing = await ctx.db.query("giftWorlds").withIndex("by_shared").take(200);
    if (existing.some((r) => r.isSample)) return ok({ added: 0 });
    const now = Date.now();
    for (const [i, sample] of SAMPLES.entries())
      await ctx.db.insert("giftWorlds", { ...sample, isSample: true, sharedAt: now - i * 3_600_000, updatedAt: now });
    return ok({ added: SAMPLES.length });
  },
});
