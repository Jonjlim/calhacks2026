/**
 * Council themes and the sharpen round for the gift map (D19: MAP-008, MAP-014). Owner: Dev 3.
 *
 * Themes group the room's published memories so gifts can sit between the
 * themes they satisfy. Sharpen asks one question that splits the two leading
 * gifts. Both read only room-visible data, validate model output, fall back to
 * deterministic presets, and never publish anything themselves: a theme is an
 * interpretation, and a sharpen answer is published by the member who taps it.
 */
import { v } from "convex/values";
import { z } from "zod";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { Result } from "../../lib/contracts";
import { requireMember } from "../lib/auth";
import { cleanText, LIMITS } from "../lib/input";
import { bumpKnowledgeRevision } from "../lib/knowledge";
import { err, memberError, ok } from "../lib/result";
import { BASE_INSTRUCTIONS, containsSensitiveData } from "./engine";
import { IDEA_CALLS_PER_WINDOW } from "./ideas";
import { configuredModel, validatedModelCall } from "./model";
import { readCatalog } from "../research/catalog";

const WINDOW_MS = 10 * 60 * 1000;
const GIFT_IDEA_PREFIX = "Gift idea: ";
const MAX_THEMES = 5;
const MIN_CLUES_FOR_THEMES = 3;

const BUCKET_LABEL: Record<"interest" | "wish" | "moment", string> = {
  interest: "Things she loves",
  wish: "Wishes she has mentioned",
  moment: "Moments and habits",
};
const bucketOf = (kind: string) => (kind === "explicit_wish" ? "wish" : kind === "interest" ? "interest" : "moment");

const tidyLabel = (raw: string): string | null => {
  const label = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!label || containsSensitiveData(label) || /https?:\/\/|\$\s?\d|@unwrap/i.test(label)) return null;
  return label;
};

// ---------- Themes ----------

export const themeContext = internalQuery({
  args: { roomId: v.id("rooms"), userId: v.string() },
  handler: async (ctx, { roomId, userId }) => {
    const member = await ctx.db.query("participants").withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId)).first();
    const room = await ctx.db.get(roomId);
    if (!member || !room || room.deletedAt) return null;
    const clues = await ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const recent = await ctx.db.query("ideaCalls").withIndex("by_room", (q) => q.eq("roomId", roomId).gte("createdAt", Date.now() - WINDOW_MS)).take(IDEA_CALLS_PER_WINDOW + 1);
    return {
      recipient: room.recipientDisplayName,
      knowledgeRevision: room.knowledgeRevision,
      participantId: member._id,
      // Room-visible memories only; friends' typed gift ideas are not memories about her.
      clues: clues.filter((c) => c.status === "active" && !c.text.startsWith(GIFT_IDEA_PREFIX)).slice(-60).map((c) => ({ id: c._id, kind: c.kind, text: c.text })),
      overBudget: recent.length >= IDEA_CALLS_PER_WINDOW,
    };
  },
});

export const storeThemes = internalMutation({
  args: {
    roomId: v.id("rooms"),
    knowledgeRevision: v.number(),
    source: v.union(v.literal("agent"), v.literal("preset")),
    themes: v.array(v.object({ label: v.string(), clueIds: v.array(v.id("publishedClues")) })),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    // Memories changed while the council was thinking: these themes describe an older room.
    if (!room || room.knowledgeRevision !== args.knowledgeRevision) return { stored: 0, stale: true };
    const valid: { label: string; clueIds: Id<"publishedClues">[] }[] = [];
    const used = new Set<string>();
    for (const theme of args.themes.slice(0, MAX_THEMES)) {
      const label = tidyLabel(theme.label);
      if (!label) continue;
      const ids: Id<"publishedClues">[] = [];
      for (const id of theme.clueIds) {
        const clue = await ctx.db.get(id);
        if (clue && clue.roomId === args.roomId && clue.status === "active" && !used.has(id)) {
          ids.push(id);
          used.add(id);
        }
      }
      if (ids.length) valid.push({ label, clueIds: ids });
    }
    if (!valid.length) return { stored: 0, stale: false };
    const old = await ctx.db.query("mapThemes").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect();
    for (const row of old) await ctx.db.delete(row._id);
    const now = Date.now();
    for (const theme of valid) await ctx.db.insert("mapThemes", { roomId: args.roomId, ...theme, source: args.source, knowledgeRevision: args.knowledgeRevision, createdAt: now });
    return { stored: valid.length, stale: false };
  },
});

const themesSchema = z.strictObject({
  themes: z.array(z.strictObject({ label: z.string().trim().min(2).max(40), clues: z.array(z.number().int().min(0)).min(1).max(30) })).min(2).max(MAX_THEMES),
});

/** The preset grouping: the room's clue kinds, the same as the tower's jars. */
export function presetThemes(clues: Array<{ id: Id<"publishedClues">; kind: string }>) {
  const groups = new Map<keyof typeof BUCKET_LABEL, Id<"publishedClues">[]>();
  for (const c of clues) {
    const b = bucketOf(c.kind);
    groups.set(b, [...(groups.get(b) ?? []), c.id]);
  }
  return [...groups.entries()].map(([b, clueIds]) => ({ label: BUCKET_LABEL[b], clueIds }));
}

export const suggestThemes = action({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<{ themes: number; source: "agent" | "preset" }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return err("unauthorized", "Sign in first.");
    const room = await ctx.runQuery(internal.agents.themes.themeContext, { roomId, userId });
    if (!room) return err("unauthorized", "Room membership required.");
    if (room.clues.length < MIN_CLUES_FOR_THEMES) return err("validation_failed", `Share at least ${MIN_CLUES_FOR_THEMES} memories first.`);

    let source: "agent" | "preset" = "preset";
    let themes = presetThemes(room.clues);
    if (!room.overBudget && process.env.LLM_API_KEY) {
      await ctx.runMutation(internal.agents.ideas.recordIdeaCall, { roomId });
      try {
        const result = await validatedModelCall(
          configuredModel(),
          {
            role: "extractor",
            instructions:
              BASE_INSTRUCTIONS +
              `\nFriends shared memories about {name} to choose a gift together. Group the numbered memories into 2-${MAX_THEMES} themes that a gift could speak to. A theme label is 2-5 plain words naming what its memories share (for example "Makes things with her hands", "Slow, cozy mornings"). Each memory belongs to at most one theme; skip memories that fit nowhere. Use only the memory numbers given. Never infer health, religion, politics, sexuality, age, body or other sensitive traits. No brands, prices or links. Return JSON {"themes":[{"label":"...","clues":[0,2]}]}.`,
            input: { recipient: "{name}", memories: room.clues.map((c, n) => ({ n, kind: c.kind, text: c.text })) },
          },
          themesSchema,
        );
        const mapped = result.themes.map((t) => ({ label: t.label.replaceAll("{name}", room.recipient), clueIds: t.clues.map((n) => room.clues[n]?.id).filter((id): id is Id<"publishedClues"> => !!id) }));
        if (mapped.filter((t) => t.clueIds.length).length >= 2) {
          themes = mapped;
          source = "agent";
        }
      } catch {
        // Presets below.
      }
    }
    const stored = await ctx.runMutation(internal.agents.themes.storeThemes, { roomId, knowledgeRevision: room.knowledgeRevision, source, themes });
    if (stored.stale) return err("stale_job", "Memories changed while the council was thinking. Try again.");
    return ok({ themes: stored.stored, source });
  },
});

export const listThemes = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    type Row = { id: Id<"mapThemes">; label: string; clueIds: Id<"publishedClues">[]; source: "agent" | "preset"; stale: boolean };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Row[]>(member.code);
    const room = await ctx.db.get(roomId);
    const rows = await ctx.db.query("mapThemes").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(MAX_THEMES * 2);
    return ok<Row[]>(rows.map((r) => ({ id: r._id, label: r.label, clueIds: r.clueIds, source: r.source, stale: !!room && r.knowledgeRevision < room.knowledgeRevision })));
  },
});

// ---------- Sharpen ----------

export const sharpenContext = internalQuery({
  args: { roomId: v.id("rooms"), userId: v.string() },
  handler: async (ctx, { roomId, userId }) => {
    const member = await ctx.db.query("participants").withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId)).first();
    const room = await ctx.db.get(roomId);
    if (!member || !room || room.deletedAt) return null;
    const clues = await ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const votes = await ctx.db.query("votes").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const owned = await ctx.db.query("mapFeedback").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const tally = (id: Id<"productListings">) => votes.filter((x) => x.listingId === id).reduce((n, x) => n + (x.value === "up" ? 1 : x.value === "down" ? -1 : 0), 0);
    // The same ranked pool the room shows (readCatalog), so the finalists are gifts people can see.
    const catalog = await readCatalog(ctx, room);
    const titles = new Map(catalog.listings.map((l) => [l.id, l.title]));
    const candidates: { id: Id<"productListings">; title: string; score: number; votes: number }[] = [];
    for (const r of catalog.recommendations) {
      const id = r.listingId as Id<"productListings">;
      if (owned.some((f) => f.listingId === id && f.kind === "owned" && f.active)) continue;
      const title = titles.get(r.listingId);
      if (title) candidates.push({ id, title, score: r.score, votes: tally(id) });
    }
    candidates.sort((a, b) => b.votes - a.votes || b.score - a.score);
    const recent = await ctx.db.query("ideaCalls").withIndex("by_room", (q) => q.eq("roomId", roomId).gte("createdAt", Date.now() - WINDOW_MS)).take(IDEA_CALLS_PER_WINDOW + 1);
    return {
      recipient: room.recipientDisplayName,
      knowledgeRevision: room.knowledgeRevision,
      participantId: member._id,
      clues: clues.filter((c) => c.status === "active" && !c.text.startsWith(GIFT_IDEA_PREFIX)).slice(-40).map((c) => c.text),
      finalists: candidates.slice(0, 2),
      overBudget: recent.length >= IDEA_CALLS_PER_WINDOW,
    };
  },
});

export const storeSharpen = internalMutation({
  args: {
    roomId: v.id("rooms"),
    askedBy: v.id("participants"),
    knowledgeRevision: v.number(),
    source: v.union(v.literal("agent"), v.literal("preset")),
    question: v.string(),
    options: v.array(v.object({ label: v.string(), clue: v.string(), listingIds: v.array(v.id("productListings")) })),
    finalistIds: v.array(v.id("productListings")),
  },
  handler: async (ctx, args) => {
    const open = await ctx.db.query("mapSharpens").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).collect();
    for (const row of open) if (row.status === "open") await ctx.db.patch(row._id, { status: "dismissed" });
    return ctx.db.insert("mapSharpens", { ...args, status: "open", createdAt: Date.now() });
  },
});

const sharpenSchema = z.strictObject({
  question: z.string().trim().min(8).max(110),
  options: z.array(z.strictObject({ label: z.string().trim().min(1).max(32), clue: z.string().trim().min(6).max(140), favors: z.enum(["A", "B"]) })).length(2),
});

const shortTitle = (t: string) => (t.length > 30 ? `${t.slice(0, 28).trimEnd()}…` : t);

export const sharpen = action({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<{ sharpenId: Id<"mapSharpens">; source: "agent" | "preset" }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return err("unauthorized", "Sign in first.");
    const room = await ctx.runQuery(internal.agents.themes.sharpenContext, { roomId, userId });
    if (!room) return err("unauthorized", "Room membership required.");
    const [a, b] = room.finalists;
    if (!a || !b) return err("validation_failed", "Find at least two gifts first, then sharpen.");

    let source: "agent" | "preset" = "preset";
    let question = `Which feels more like ${room.recipient}?`;
    let options = [
      { label: shortTitle(a.title), clue: `${room.recipient} would love ${a.title.toLowerCase()} more than ${b.title.toLowerCase()}.`, listingIds: [a.id] },
      { label: shortTitle(b.title), clue: `${room.recipient} would love ${b.title.toLowerCase()} more than ${a.title.toLowerCase()}.`, listingIds: [b.id] },
    ];
    if (!room.overBudget && process.env.LLM_API_KEY) {
      await ctx.runMutation(internal.agents.ideas.recordIdeaCall, { roomId });
      try {
        const result = await validatedModelCall(
          configuredModel(),
          {
            role: "extractor",
            instructions:
              BASE_INSTRUCTIONS +
              `\nFriends are choosing between two gifts for {name}: A and B. Ask ONE short, warm question about {name} herself (not about the products) whose answer would tell the friends which gift fits better. Example: "Does {name} love making things, or having beautiful handmade things around?" Give exactly two answers. Each answer: label (2-5 words), clue (one plain sentence a friend would confirm about {name}), favors ("A" or "B"). Ground it in the friends' memories. Never ask about health, religion, politics, sexuality, age, body, money or other sensitive traits. No brands, prices or links. Return JSON {"question":"...","options":[{"label":"...","clue":"...","favors":"A"},{"label":"...","clue":"...","favors":"B"}]}.`,
            input: { recipient: "{name}", memories: room.clues, A: a.title, B: b.title },
          },
          sharpenSchema,
        );
        const named = (s: string) => s.replaceAll("{name}", room.recipient);
        const safe = [result.question, ...result.options.flatMap((o) => [o.label, o.clue])].every((t) => !containsSensitiveData(t) && !/https?:\/\/|\$\s?\d/.test(t));
        const favorsBoth = new Set(result.options.map((o) => o.favors)).size === 2;
        if (safe && favorsBoth) {
          question = named(result.question);
          options = result.options.map((o) => ({ label: named(o.label), clue: named(o.clue), listingIds: [o.favors === "A" ? a.id : b.id] }));
          source = "agent";
        }
      } catch {
        // Preset question above.
      }
    }
    const sharpenId = await ctx.runMutation(internal.agents.themes.storeSharpen, { roomId, askedBy: room.participantId, knowledgeRevision: room.knowledgeRevision, source, question, options, finalistIds: [a.id, b.id] });
    return ok({ sharpenId, source });
  },
});

export const getSharpen = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    type Out = (Pick<Doc<"mapSharpens">, "_id" | "question" | "options" | "finalistIds" | "status" | "answer" | "source"> & { answeredBy?: Id<"participants"> }) | null;
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Out>(member.code);
    const latest = await ctx.db.query("mapSharpens").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").first();
    if (!latest || latest.status === "dismissed") return ok<Out>(null);
    const { _id, question, options, finalistIds, status, answer, answeredBy, source } = latest;
    return ok<Out>({ _id, question, options, finalistIds, status, answer, answeredBy, source });
  },
});

/** Tapping an answer is the member's own statement: it publishes that clue as them, like any manual memory. */
export const answerSharpen = mutation({
  args: { sharpenId: v.id("mapSharpens"), option: v.number() },
  handler: async (ctx, { sharpenId, option }) => {
    type Out = { clueId: Id<"publishedClues"> };
    const row = await ctx.db.get(sharpenId);
    if (!row) return err<Out>("not_found", "That question is gone.");
    const member = await requireMember(ctx, row.roomId);
    if (!member.ok) return memberError<Out>(member.code);
    if (row.status !== "open") return err<Out>("invalid_revision", "Someone already answered this question.");
    const chosen = row.options[option];
    if (!chosen) return err<Out>("validation_failed", "Pick one of the two answers.");
    const text = cleanText(chosen.clue, LIMITS.clueTextMaxChars);
    if (!text) return err<Out>("validation_failed", "That answer can't be shared.");
    const clueId = await ctx.db.insert("publishedClues", {
      roomId: row.roomId, publisherId: member.me._id, kind: "interest", text,
      sourceKind: "manual", sourceMessageIds: [], status: "active", publishedAt: Date.now(),
    });
    await ctx.db.patch(sharpenId, { status: "answered", answer: option, answeredBy: member.me._id });
    await bumpKnowledgeRevision(ctx, row.roomId);
    return ok<Out>({ clueId });
  },
});

export const dismissSharpen = mutation({
  args: { sharpenId: v.id("mapSharpens") },
  handler: async (ctx, { sharpenId }) => {
    const row = await ctx.db.get(sharpenId);
    if (!row) return err<null>("not_found", "That question is gone.");
    const member = await requireMember(ctx, row.roomId);
    if (!member.ok) return memberError<null>(member.code);
    await ctx.db.patch(sharpenId, { status: "dismissed" });
    return ok(null);
  },
});
