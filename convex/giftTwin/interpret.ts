/**
 * The gift agent's interpretation layer between the twin's raw notes and
 * the room. Twin notes can repeat each other ("Jon loves arcteryx jacket",
 * "Jon wants arcteryx jacket") or come out garbled ("Jon has been doing
 * playing this mobile game instead for"). Before anything becomes a clue:
 *   - incoherent notes are dropped (isCoherentNote),
 *   - notes about the same thing are merged into one stronger clue
 *     ("Jon really wants an Arc'teryx jacket"), and
 *   - notes that repeat an existing room clue are dropped.
 * A model does this when configured; deterministic code checks its output
 * (a rewrite may not add facts) and is the fallback.
 */
import { z } from "zod";
import { validatedModelCall, type ModelTransport } from "../agents/model";
import {
  screenSharedText,
  TWIN_INSIGHT_CATEGORIES,
  TWIN_LIMITS,
  type TwinConfidence,
  type TwinInsightCategory,
} from "../../lib/agentCollaborators/contracts";

export interface NoteCandidate<Ref> {
  ref: Ref;
  category: TwinInsightCategory;
  text: string;
  confidence: TwinConfidence;
  evidenceCount?: number;
}

/** One clue-to-be: `primary` carries the final text; `merged` are folded into it and hidden. */
export interface InterpretedNote<Ref> {
  primary: Ref;
  merged: Ref[];
  category: TwinInsightCategory;
  text: string;
  confidence: TwinConfidence;
  evidenceCount: number;
}

export interface Interpretation<Ref> {
  notes: Array<InterpretedNote<Ref>>;
  /** Garbled, vetoed, or already known. */
  dropped: Ref[];
}

const normalize = (text: string) => text.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

const DANGLING_END = /\b(for|to|of|with|and|or|but|instead|the|a|an|this|that|these|those|my|their|his|her|in|on|at|from|about|like|because|so|than|then|into|by|is|are|was|been|being|has|have)\s*[.!?]*$/i;
const STACKED_VERBS = /\b(doing|being|having|getting|going|been)\s+(\w+ing)\b/i;
const ALLOWED_STACKS = new Set(["getting into", "going to"]);
const VAGUE_REFERENCE = /\b(this|that|these|those|it|stuff|something|thing|things)\b/i;

/**
 * True when a note reads as one complete, specific sentence a friend could
 * act on. Rejects dangling endings ("... instead for"), stacked verbs
 * ("doing playing"), and references that need the original chat to make
 * sense ("this mobile game").
 */
export function isCoherentNote(raw: string): boolean {
  const text = normalize(raw).replace(/[.!?]+$/, "");
  const words = text.split(" ");
  if (words.length < 3) return false;
  if (DANGLING_END.test(text)) return false;
  const stacked = STACKED_VERBS.exec(text);
  if (stacked && !ALLOWED_STACKS.has(`${stacked[1]} ${stacked[2]}`.toLowerCase())) return false;
  // "Maya's messages back this up" is the one fixed phrase that may say "this".
  if (VAGUE_REFERENCE.test(text.replace(/back this up/i, ""))) return false;
  if (/(\b\w+\b) \1\b/i.test(text)) return false;
  return true;
}

const LEAD =
  /^(?:has said (?:they|she|he) |has mentioned (?:they|she|he) )?(?:really |also |still |definitely )?(wants?(?: to)?|would love|is (?:really )?into|'?re into|is a (?:big |huge )?fan of|loves?|likes?|enjoys?|has been (?:doing|playing|practicing|practising|learning|training for|getting into|taking up|taking)|already (?:has|owns)|(?:doesn't|does not|don't) like|hates?|can't stand)\s+/i;

/** Splits "Jon wants an Arc'teryx jacket" into the verb and the thing, keeping the thing's casing. */
export function splitNote(raw: string, name: string): { verb: string; object: string } | null {
  let rest = normalize(raw).replace(/[.!?]+$/, "");
  if (!rest.toLowerCase().startsWith(name.toLowerCase())) return null;
  rest = rest.slice(name.length).trim();
  if (/^'s favou?rite /i.test(rest)) return { verb: "favorite", object: rest.replace(/^'s favou?rite /i, "") };
  if (/^'s messages back this up: they're into /i.test(rest)) return { verb: "into", object: rest.replace(/^'s messages back this up: they're into /i, "") };
  const match = LEAD.exec(rest);
  if (!match?.[1]) return null;
  const object = rest.slice(match[0].length).trim();
  return object ? { verb: match[1].toLowerCase(), object } : null;
}

/** "an Arc'teryx jackets" and "arcteryx jacket" share one key. */
export function subjectKey(object: string): string {
  return object
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w, i) => !(i === 0 && ["a", "an", "the", "some", "new", "their", "more"].includes(w)))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

/** Notes only merge with notes of the same leaning: liking and wanting go together; dislikes and ownership stay apart. */
function leaning(category: TwinInsightCategory): "positive" | "dislike" | "owns" {
  return category === "dislike" ? "dislike" : category === "owns" ? "owns" : "positive";
}

export function noteKey(category: TwinInsightCategory, text: string, name: string): string | null {
  const split = splitNote(text, name);
  return split ? `${leaning(category)}:${subjectKey(split.object)}` : null;
}

function mergedText(category: TwinInsightCategory, object: string, name: string): string | null {
  switch (category) {
    case "wish":
      return `${name} really wants ${object}`;
    case "interest":
      return `${name} is really into ${object}`;
    case "dislike":
      return `${name} really doesn't like ${object}`;
    case "owns":
      return `${name} already has ${object}`;
    case "style":
      return null;
  }
}

const rank = { low: 0, medium: 1, high: 2 } as const;

/** Model-free interpretation: drop incoherent or known notes, merge same-subject ones. */
export function interpretNotes<Ref>(candidates: Array<NoteCandidate<Ref>>, name: string, roomClues: string[] = []): Interpretation<Ref> {
  const known = new Set(roomClues.map((text) => splitNote(text, name)).filter((s) => s !== null).map((s) => subjectKey(s.object)));
  const dropped: Ref[] = [];
  const groups = new Map<string, Array<NoteCandidate<Ref>>>();
  for (const candidate of candidates) {
    if (!isCoherentNote(candidate.text) || !screenSharedText(candidate.text).ok) {
      dropped.push(candidate.ref);
      continue;
    }
    const key = noteKey(candidate.category, candidate.text, name) ?? `text:${candidate.category}:${subjectKey(candidate.text)}`;
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }
  const notes: Array<InterpretedNote<Ref>> = [];
  for (const group of groups.values()) {
    const lead = group.find((c) => c.category === "wish") ?? [...group].sort((a, b) => rank[b.confidence] - rank[a.confidence])[0]!;
    const split = splitNote(lead.text, name);
    if (split && known.has(subjectKey(split.object)) && lead.category !== "dislike" && lead.category !== "owns") {
      dropped.push(...group.map((c) => c.ref));
      continue;
    }
    const evidenceCount = Math.min(999, group.reduce((n, c) => n + (c.evidenceCount ?? 1), 0));
    let text = lead.text;
    if (group.length > 1 && split) {
      const rewrite = mergedText(lead.category, split.object, name);
      if (rewrite && screenSharedText(rewrite).ok) text = rewrite;
    }
    notes.push({
      primary: lead.ref,
      merged: group.filter((c) => c !== lead).map((c) => c.ref),
      category: lead.category,
      text: normalize(text),
      confidence: group.length > 1 ? "high" : lead.confidence,
      evidenceCount,
    });
  }
  return { notes, dropped };
}

const REWRITE_ALLOWED = new Set(
  "really also still very most more much big huge wants want wanting would love loves loved into likes like enjoys enjoy has have been already owns own doesnt does dont not fan favorite favourite style prefers getting always try trying get got interested obsessed hooked avoid avoids dislikes dislike hates hate cant stand kind type especially said says mentioned keeps talking about the and for with their they them she her his him one new lot lots".split(" "),
);

function words(text: string): string[] {
  return text.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
}

/** A rewrite may reword and combine its sources but may not add a brand, product, or detail they lack. */
export function rewriteAddsNothing(rewrite: string, sources: string[], name: string): boolean {
  const nameWords = new Set(words(name));
  const sourceStems = new Set(sources.flatMap(words).map((w) => w.slice(0, 4)));
  return words(rewrite).every((w) => nameWords.has(w) || REWRITE_ALLOWED.has(w) || sourceStems.has(w.slice(0, 4)));
}

const INTERPRET_INSTRUCTIONS = `You are Unwrap's gift-buying agent. The recipient's Gift Twin (an agent acting for the recipient) sent short notes about them, found in their messages. Notes can repeat each other, be clumsy, or be garbled.
Turn them into the fewest clear clues a friend could act on:
- Merge notes about the same thing into one note and say it once, more strongly when several agree. Example: "Jon loves arcteryx jacket" + "Jon wants arcteryx jacket" -> {"sources":[0,1],"category":"wish","text":"Jon really wants an Arc'teryx jacket","confidence":"high"}.
- Drop notes that are garbled, incomplete, vague, or do not make sense on their own, e.g. "Jon has been doing playing this mobile game instead for". Drop notes that are not giftable (meals, moods, plans, chores, people, places) and notes that repeat an existing room clue.
- Use only facts in the source notes; never add brands, products, or details. Write one natural third-person sentence about the recipient by name, at most 160 characters, no quotation marks.
- category: "wish" (wants it), "interest" (does or likes it), "style" (taste or favorite), "dislike" (avoid it), "owns" (already has it). Never merge a dislike or an owned item with a want.
- confidence: "high" when several notes agree or the want is explicit, otherwise "medium".
Each note index may appear in at most one output note. Leave dropped notes out.
Return JSON only: {"notes":[{"sources":number[],"category":string,"text":string,"confidence":"medium"|"high"}]}`;

export const twinInterpretationSchema = z.strictObject({
  notes: z
    .array(
      z.strictObject({
        sources: z.array(z.number().int().min(0)).min(1).max(TWIN_LIMITS.insightsPerRun),
        category: z.enum(TWIN_INSIGHT_CATEGORIES),
        text: z.string().max(400),
        confidence: z.enum(["medium", "high"]),
      }),
    )
    .max(TWIN_LIMITS.insightsPerRun),
});

/**
 * Model interpretation, checked note by note. A note whose sources are
 * invalid, whose text fails screening or coherence, or that adds facts is
 * rebuilt deterministically from its sources. Notes the model leaves out
 * are dropped (the model may veto). Without a model, or if the call fails,
 * the deterministic interpretation stands.
 */
export async function interpretWithModel<Ref>(
  model: ModelTransport | undefined,
  candidates: Array<NoteCandidate<Ref>>,
  context: { name: string; occasion: string; roomClues: string[] },
): Promise<Interpretation<Ref>> {
  const fallback = () => interpretNotes(candidates, context.name, context.roomClues);
  if (!model || candidates.length === 0) return fallback();
  let raw: z.infer<typeof twinInterpretationSchema>;
  try {
    raw = await validatedModelCall(
      model,
      {
        role: "buyer",
        instructions: INTERPRET_INSTRUCTIONS,
        input: {
          recipientName: context.name,
          occasion: context.occasion,
          roomClues: context.roomClues,
          notes: candidates.map((c, index) => ({ index, category: c.category, text: c.text, confidence: c.confidence, evidenceCount: c.evidenceCount ?? 1 })),
        },
      },
      twinInterpretationSchema,
    );
  } catch {
    return fallback();
  }
  const used = new Set<number>();
  const notes: Array<InterpretedNote<Ref>> = [];
  const rebuild: Array<NoteCandidate<Ref>> = [];
  for (const note of raw.notes) {
    const sources = [...new Set(note.sources)].filter((i) => i < candidates.length && !used.has(i));
    if (sources.length === 0) continue;
    sources.forEach((i) => used.add(i));
    const group = sources.map((i) => candidates[i]!);
    const text = normalize(note.text);
    const valid =
      group.every((c) => leaning(c.category) === leaning(note.category)) &&
      screenSharedText(text).ok &&
      isCoherentNote(text) &&
      rewriteAddsNothing(text, group.map((c) => c.text), context.name);
    if (!valid) {
      rebuild.push(...group);
      continue;
    }
    notes.push({
      primary: group[0]!.ref,
      merged: group.slice(1).map((c) => c.ref),
      category: note.category,
      text,
      confidence: group.length > 1 ? "high" : note.confidence,
      evidenceCount: Math.min(999, group.reduce((n, c) => n + (c.evidenceCount ?? 1), 0)),
    });
  }
  const rebuilt = interpretNotes(rebuild, context.name, context.roomClues);
  return {
    notes: [...notes, ...rebuilt.notes],
    dropped: [...candidates.filter((_, i) => !used.has(i)).map((c) => c.ref), ...rebuilt.dropped],
  };
}
