/**
 * AI Council event contract (see docs/CONTRACTS.md § "AI Council").
 *
 * One Fetch.ai coordinator runs five specialist roles and emits a small event
 * at every real execution boundary. Convex validates and stores them; the
 * web app derives each council member's state from the stored events and
 * animates locally. Nothing here is an animation frame.
 */
import { z } from "zod";
import library from "./library.json";

export const COUNCIL_ACTORS = ["archivist", "muse", "scout", "keeper", "courier"] as const;
export type CouncilActor = (typeof COUNCIL_ACTORS)[number];

export const COUNCIL_STATUSES = ["started", "completed", "failed"] as const;
export type CouncilStatus = (typeof COUNCIL_STATUSES)[number];

/** Which task each actor performs; one task per actor per run. */
export const COUNCIL_TASKS = {
  archivist: "analyze_memories",
  muse: "design_decoration",
  scout: "research_gifts",
  keeper: "check_constraints",
  courier: "deliver_recommendations",
} as const satisfies Record<CouncilActor, string>;
export type CouncilTask = (typeof COUNCIL_TASKS)[CouncilActor];

export const DECORATION_ASSET_IDS = library.assets.map((a) => a.id) as [string, ...string[]];
export const DECORATION_COLORS = Object.keys(library.colors) as [string, ...string[]];
export const DECORATION_PLACEMENTS = library.placements as [string, ...string[]];
export const MEMORY_JARS = library.jars as [string, ...string[]];
export const DECORATION_COLOR_HEX: Record<string, string> = library.colors;

const shortText = (max: number) => z.string().trim().min(1).max(max);
const slug = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);

/** A memory-derived charm, restricted to the approved library and placement slots. */
export const decorationSpecSchema = z.strictObject({
  memoryId: slug,
  jar: z.enum(MEMORY_JARS),
  assetId: z.enum(DECORATION_ASSET_IDS),
  color: z.enum(DECORATION_COLORS),
  placement: z.enum(DECORATION_PLACEMENTS),
  label: shortText(32),
});
export type DecorationSpec = z.infer<typeof decorationSpecSchema>;

/** Small, display-only summaries. Products never arrive here; they come back to the requester. */
export const councilResultSchema = z
  .strictObject({
    summary: shortText(200).optional(),
    count: z.number().int().min(0).max(100).optional(),
    decorations: z.array(decorationSpecSchema).max(8).optional(),
    cached: z.boolean().optional(),
    error: shortText(160).optional(),
  })
  .optional();

export const councilEventSchema = z.strictObject({
  eventId: slug,
  runId: slug,
  actor: z.enum(COUNCIL_ACTORS),
  task: z.enum(Object.values(COUNCIL_TASKS) as [CouncilTask, ...CouncilTask[]]),
  status: z.enum(COUNCIL_STATUSES),
  /** Monotonic per run; orders events that arrive out of order. */
  sequence: z.number().int().min(0).max(10_000),
  timestamp: z.number().int().positive(),
  result: councilResultSchema,
});
export type CouncilEvent = z.infer<typeof councilEventSchema>;

export const councilRunSchema = z.strictObject({
  runId: slug,
  source: z.enum(["web", "asi1"]),
  /** Browser-session key for web demo runs that have no Unwrap room. */
  demoKey: slug.optional(),
});

/** The derived, renderable state of one council member. */
export interface CouncilMemberState {
  actor: CouncilActor;
  status: "idle" | CouncilStatus;
  sequence: number;
  summary?: string;
}

/**
 * Folds stored events into per-actor state. Order-independent and
 * idempotent: duplicates are ignored by eventId, and for each actor the
 * highest sequence wins, so late or repeated deliveries cannot rewind a
 * finished task.
 */
export function reduceCouncil(events: readonly CouncilEvent[]): Record<CouncilActor, CouncilMemberState> {
  const out = Object.fromEntries(COUNCIL_ACTORS.map((a) => [a, { actor: a, status: "idle", sequence: -1 }])) as Record<CouncilActor, CouncilMemberState>;
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    const cur = out[e.actor];
    if (e.sequence <= cur.sequence) continue;
    out[e.actor] = { actor: e.actor, status: e.status, sequence: e.sequence, summary: e.result?.summary ?? e.result?.error };
  }
  return out;
}

/** Decorations from completed Muse events, one per memory (latest wins). */
export function decorationsFrom(events: readonly CouncilEvent[]): DecorationSpec[] {
  const byMemory = new Map<string, { seq: number; spec: DecorationSpec }>();
  for (const e of events) {
    if (e.actor !== "muse" || e.status !== "completed") continue;
    for (const spec of e.result?.decorations ?? []) {
      const prev = byMemory.get(spec.memoryId);
      if (!prev || e.sequence > prev.seq) byMemory.set(spec.memoryId, { seq: e.sequence, spec });
    }
  }
  return [...byMemory.values()].map((v) => v.spec);
}
