/**
 * Idea cards for the memory game. Owner: Dev 3.
 *
 * The agents propose picture options built only from the room's published
 * clues and the friend's own picks so far; a friend's tap is what publishes a
 * memory, never the model. Output is validated, sensitive text is dropped, and
 * presets answer instantly when the model is off, slow, over budget or wrong.
 */
import { v } from "convex/values";
import { z } from "zod";
import { action, internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { ClueKind, Result } from "../../lib/contracts";
import { presetIdeas, type Idea } from "../../lib/ideas/presets";
import * as V from "../validators";
import { err, ok } from "../lib/result";
import { BASE_INSTRUCTIONS, containsSensitiveData } from "./engine";
import { configuredModel, validatedModelCall } from "./model";

/** Per room: at most this many agent suggestions in the window, then presets. */
export const IDEA_CALLS_PER_WINDOW = 40;
const WINDOW_MS = 10 * 60 * 1000;

const EMOJI = /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u;
const ideaSchema = z.strictObject({
  label: z.string().trim().min(1).max(32),
  emoji: z.string().trim().min(1).max(12),
  clue: z.string().trim().min(4).max(140),
});
const suggestionSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(90),
  options: z.array(ideaSchema).min(3).max(8),
});

export interface IdeaBoard {
  /** One line from the agent introducing the cards. */
  prompt: string;
  options: Idea[];
  source: "agent" | "preset";
}

const KIND_GOAL: Record<ClueKind, string> = {
  interest: "things they love doing",
  uncertain: "memorable moments or habits",
  explicit_wish: "things they have wished for out loud",
  ownership: "things they already own plenty of",
  exclusion: "things a gift should avoid",
  timing: "timing constraints",
};

export const ideaContext = internalQuery({
  args: { roomId: v.id("rooms"), userId: v.string() },
  handler: async (ctx, { roomId, userId }) => {
    const member = await ctx.db
      .query("participants")
      .withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId))
      .first();
    const room = await ctx.db.get(roomId);
    if (!member || !room) return null;
    const clues = await ctx.db
      .query("publishedClues")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    const recent = await ctx.db
      .query("ideaCalls")
      .withIndex("by_room", (q) => q.eq("roomId", roomId).gte("createdAt", Date.now() - WINDOW_MS))
      .take(IDEA_CALLS_PER_WINDOW + 1);
    return {
      recipient: room.recipientDisplayName,
      occasion: room.occasion,
      // Room-visible clue text only: no private imports, caps, or recipient-profile data.
      clues: clues.filter((c) => c.status === "active").slice(-40).map((c) => ({ kind: c.kind, text: c.text })),
      overBudget: recent.length >= IDEA_CALLS_PER_WINDOW,
    };
  },
});

export const recordIdeaCall = internalMutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    await ctx.db.insert("ideaCalls", { roomId, createdAt: Date.now() });
  },
});

/** Keeps only safe, distinct cards the room doesn't already know. */
export function cleanIdeas(options: Idea[], known: string[]): Idea[] {
  const seen = new Set(known.map((t) => t.toLowerCase().trim()));
  const out: Idea[] = [];
  for (const o of options) {
    const label = o.label.trim();
    const clue = o.clue.trim();
    if (!EMOJI.test(o.emoji.trim())) continue;
    if (containsSensitiveData(label) || containsSensitiveData(clue)) continue;
    if (/https?:\/\/|\$\s?\d|@unwrap/i.test(label + clue)) continue;
    const key = clue.toLowerCase();
    if (seen.has(key) || out.some((x) => x.label.toLowerCase() === label.toLowerCase())) continue;
    seen.add(key);
    out.push({ label, emoji: o.emoji.trim(), clue });
  }
  return out.slice(0, 6);
}

export const suggestIdeas = action({
  args: {
    roomId: v.id("rooms"),
    kind: V.clueKind,
    /** The friend's picks in this thread, newest last; each pick sparks the next cards. */
    picked: v.array(v.object({ label: v.string(), clue: v.string() })),
  },
  handler: async (ctx, args): Promise<Result<IdeaBoard>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return err("unauthorized", "Sign in first.");
    return ideasFor(ctx, userId, args);
  },
});

/** Shared by the memory game and the gift map: the next idea cards for one category and thread of picks. */
export async function ideasFor(
  ctx: ActionCtx,
  userId: string,
  args: { roomId: Id<"rooms">; kind: ClueKind; picked: Array<{ label: string; clue: string }> },
): Promise<Result<IdeaBoard>> {
  {
    const room = await ctx.runQuery(internal.agents.ideas.ideaContext, { roomId: args.roomId, userId });
    if (!room) return err("unauthorized", "Room membership required.");
    const picked = args.picked.slice(-3).map((p) => ({ label: p.label.slice(0, 40), clue: p.clue.slice(0, 160) }));
    const preset = (): IdeaBoard => ({
      prompt: picked.length ? "A few more to consider" : `Pick any that fit ${room.recipient}`,
      options: cleanIdeas(presetIdeas(args.kind, room.recipient), room.clues.map((c) => c.text)),
      source: "preset",
    });
    // A fresh category opens instantly from presets; agents take over once there is something to build on.
    if (!picked.length && room.clues.length === 0) return ok(preset());
    if (room.overBudget || !process.env.LLM_API_KEY) return ok(preset());
    await ctx.runMutation(internal.agents.ideas.recordIdeaCall, { roomId: args.roomId });
    try {
      const result = await validatedModelCall(
        configuredModel(),
        {
          role: "extractor",
          instructions:
            BASE_INSTRUCTIONS +
            `\nFriends are building a picture of ${"the recipient"} to choose a gift together. Propose 6 tappable picture cards for: ${KIND_GOAL[args.kind]}. Build on the friend's latest pick when there is one: go one level more specific (for example a pick of "Hiking" leads to "Day hikes", "Camping", "Trail running", "National parks"). Use the room's existing clues for context and never repeat them. Each card: label (2-4 words), emoji (exactly one emoji that pictures it), clue (one plain sentence a friend would say, naming the recipient as ${"{name}"}). prompt: one short friendly line introducing the cards, under 80 characters. Never infer health, religion, politics, sexuality, age, body or other sensitive traits. No brands, prices, links or products. Return JSON {"prompt":"...","options":[{"label":"...","emoji":"...","clue":"..."}]}.`,
          input: { recipient: "{name}", occasion: room.occasion, category: args.kind, picks: picked, roomClues: room.clues },
        },
        suggestionSchema,
      );
      const named = result.options.map((o) => ({ ...o, clue: o.clue.replaceAll("{name}", room.recipient) }));
      const options = cleanIdeas(named, room.clues.map((c) => c.text));
      if (options.length < 3) return ok(preset());
      return ok({ prompt: result.prompt.replaceAll("{name}", room.recipient), options, source: "agent" });
    } catch {
      return ok(preset());
    }
  }
}
