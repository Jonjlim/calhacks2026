/**
 * Gift directions (D23 trial): validation and presets. Pure; no I/O.
 *
 * A direction combines memories into one gift direction and one shopping
 * search. Model output is untrusted: it may only cite the numbered memories
 * and caught trends it was given, a single-memory direction must rest on an
 * explicit wish, and nothing with links, prices or sensitive traits survives.
 */
import { z } from "zod";
import type { ClueKind } from "../../lib/contracts";
import { shoppingPhrases } from "../research/text";

export const MAX_DIRECTIONS = 4;
export const MIN_MEMORIES_FOR_DIRECTIONS = 2;

export interface DirectionMemory { id: string; kind: ClueKind; text: string }
export interface CaughtTrend { trendJobId: string; query: string }
export interface DirectionDraft {
  label: string;
  query: string;
  why: string;
  clueIds: string[];
  trend?: CaughtTrend;
  broad: boolean;
}

export const directionsSchema = z.strictObject({
  directions: z.array(z.strictObject({
    label: z.string().trim().min(3).max(48),
    query: z.string().trim().min(3).max(60),
    why: z.string().trim().min(10).max(220),
    memories: z.array(z.number().int().min(0)).min(1).max(6),
    trend: z.number().int().min(0).optional(),
    broad: z.boolean(),
  })).min(1).max(MAX_DIRECTIONS),
});
export type DirectionsOutput = z.infer<typeof directionsSchema>;

const UNSAFE = /https?:\/\/|www\.|\$\s?\d|\d+\s?(?:usd|dollars?)\b|@/i;
const tidy = (text: string, max: number) => text.trim().replace(/\s+/g, " ").slice(0, max);
const positive = (kind: ClueKind) => kind === "interest" || kind === "explicit_wish";
/** One plain word ("hiking", "jackets") is too broad to search well on its own. */
const isBroadPhrase = (text: string) => (shoppingPhrases(text)[0] ?? text).trim().split(/\s+/).length <= 1;

/**
 * Keeps only directions that cite real memories. A direction must combine two
 * memories unless one is an explicit wish; queries are deduplicated.
 * `isSensitive` is the agents' existing sensitive-content check.
 */
export function acceptDirections(
  output: DirectionsOutput,
  memories: readonly DirectionMemory[],
  trends: readonly CaughtTrend[],
  isSensitive: (text: string) => boolean,
): DirectionDraft[] {
  return screenDirections(output, memories, trends, isSensitive).accepted;
}

/** What the checks threw out, in words the room can read ("How we got here"). */
/** `clueIds`: the real memories it cited, so the map can fray the thread between them. */
export interface RejectedDirection { label: string; reason: string; clueIds: string[] }

/** Same rules as acceptDirections, also saying why each refused direction was refused. */
export function screenDirections(
  output: DirectionsOutput,
  memories: readonly DirectionMemory[],
  trends: readonly CaughtTrend[],
  isSensitive: (text: string) => boolean,
): { accepted: DirectionDraft[]; rejected: RejectedDirection[] } {
  const accepted: DirectionDraft[] = [];
  const rejected: RejectedDirection[] = [];
  const queries = new Set<string>();
  for (const d of output.directions) {
    const label = tidy(d.label, 48);
    const cited = [...new Set(d.memories)].map((n) => memories[n]).filter((m): m is DirectionMemory => !!m);
    const refuse = (reason: string) => rejected.push({ label, reason, clueIds: cited.map((m) => m.id) });
    if (cited.length !== new Set(d.memories).size || !cited.length) { refuse("it cited a memory nobody shared"); continue; }
    if (cited.length < 2 && !cited.some((m) => m.kind === "explicit_wish")) { refuse("it rested on one memory that isn't a wish"); continue; }
    if (!cited.some((m) => positive(m.kind))) { refuse("it only cited things she owns or doesn't want"); continue; }
    const query = tidy(d.query, 60).toLowerCase();
    const why = tidy(d.why, 220);
    if ([label, query, why].some((t) => UNSAFE.test(t) || isSensitive(t))) { refuse("it included a link, a price or a sensitive detail"); continue; }
    if (queries.has(query)) { refuse("it repeated another direction's search"); continue; }
    const trend = d.trend === undefined ? undefined : trends[d.trend];
    if (d.trend !== undefined && !trend) { refuse("it used a trend nobody caught"); continue; }
    queries.add(query);
    const broad = d.broad || (cited.length === 1 && isBroadPhrase(cited[0]!.text));
    accepted.push({ label, query, why, clueIds: cited.map((m) => m.id), ...(trend ? { trend } : {}), broad });
  }
  for (const extra of accepted.slice(MAX_DIRECTIONS)) rejected.push({ label: extra.label, reason: `only ${MAX_DIRECTIONS} directions fit on the map`, clueIds: extra.clueIds });
  return { accepted: accepted.slice(0, MAX_DIRECTIONS), rejected };
}

/**
 * How the reader turned memories into search words, for the log:
 * only the ones it actually changed ("we hiked mt hood" → "hiking").
 */
export function memoryReadings(memories: readonly DirectionMemory[], limit = 4): { text: string; reading: string }[] {
  const out: { text: string; reading: string }[] = [];
  for (const m of memories) {
    if (!positive(m.kind)) continue;
    const reading = shoppingPhrases(m.text).join(" + ");
    const plain = m.text.trim().toLowerCase().replace(/[.!?]+$/, "");
    if (reading && reading !== plain) out.push({ text: m.text, reading });
    if (out.length >= limit) break;
  }
  return out;
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Without a model: each explicit wish becomes a direction, sharpened by an
 * interest when there is one ("hiking" + wish "jackets" → "hiking jackets").
 * Only short phrases are used; long sentences stay memories, not searches.
 */
export function presetDirections(memories: readonly DirectionMemory[], recipient: string): DirectionDraft[] {
  const short = (m: DirectionMemory) => {
    const phrase = shoppingPhrases(m.text)[0]?.trim() ?? "";
    return phrase && phrase.split(/\s+/).length <= 3 ? phrase : null;
  };
  const wishes = memories.filter((m) => m.kind === "explicit_wish").map((m) => ({ m, phrase: short(m) })).filter((w) => w.phrase);
  const interests = memories.filter((m) => m.kind === "interest").map((m) => ({ m, phrase: short(m) })).filter((i) => i.phrase);
  const drafts: DirectionDraft[] = [];
  wishes.forEach((wish, i) => {
    const interest = interests[i % Math.max(1, interests.length)];
    if (interest) {
      drafts.push({
        label: capitalized(`${interest.phrase} ${wish.phrase}`),
        query: `${interest.phrase} ${wish.phrase}`.toLowerCase(),
        why: `${recipient} wished for ${wish.phrase}, and friends remember ${interest.phrase}.`,
        clueIds: [wish.m.id, interest.m.id],
        broad: false,
      });
    } else {
      drafts.push({
        label: capitalized(wish.phrase!), query: wish.phrase!.toLowerCase(),
        why: `${recipient} wished for ${wish.phrase}.`, clueIds: [wish.m.id], broad: isBroadPhrase(wish.m.text),
      });
    }
  });
  // Two interests and no wish: one direction that joins them.
  if (!drafts.length && interests.length >= 2) {
    const [a, b] = interests as [typeof interests[number], typeof interests[number]];
    drafts.push({
      label: capitalized(`${a.phrase} meets ${b.phrase}`), query: `${b.phrase} ${a.phrase} gift`.toLowerCase(),
      why: `Friends remember both ${a.phrase} and ${b.phrase}.`, clueIds: [a.m.id, b.m.id], broad: false,
    });
  }
  const seen = new Set<string>();
  return drafts.filter((d) => !seen.has(d.query) && seen.add(d.query)).slice(0, MAX_DIRECTIONS);
}

export const probeSchema = z.strictObject({
  question: z.string().trim().min(8).max(110),
  options: z.array(z.strictObject({
    label: z.string().trim().min(1).max(32),
    clue: z.string().trim().min(6).max(140),
  })).min(2).max(3),
});
export type ProbeOutput = z.infer<typeof probeSchema>;

/** A probe question is safe only if every line is free of links, prices and sensitive traits. */
export function acceptProbe(output: ProbeOutput, isSensitive: (text: string) => boolean): ProbeOutput | null {
  const lines = [output.question, ...output.options.flatMap((o) => [o.label, o.clue])];
  if (lines.some((t) => UNSAFE.test(t) || isSensitive(t))) return null;
  return { question: tidy(output.question, 110), options: output.options.map((o) => ({ label: tidy(o.label, 32), clue: tidy(o.clue, 140) })) };
}
