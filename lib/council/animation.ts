/** Semantic task events map to the finished, role-specific GLB clips. */
import type { CouncilActor, CouncilMemberState } from "./contracts";

export const COUNCIL_CLIPS = ["idle", "walk", "wave", "think", "talk", "celebrate", "read_scroll", "unroll_memory", "stamp_bookmark", "sit", "search", "inspect_object", "discovery", "sketch_idea", "present_design", "brush_twirl", "count_coins", "compare_options", "approve", "carry_letter", "deliver_message", "excited_hop"] as const;
export type CouncilClip = (typeof COUNCIL_CLIPS)[number];

/** Small extra motion layered on top of a clip where no exact clip exists. */
export type Procedural = "none" | "scan" | "bob" | "settle";

export interface CouncilPose {
  clip: CouncilClip;
  /** Play once and hold/return; otherwise loop. */
  once: boolean;
  /** Clip to fall back to after a one-shot finishes. */
  then?: CouncilClip;
  procedural: Procedural;
  /** Plain-language description, shown to screen readers and in the status list. */
  caption: string;
}

type Table = Record<CouncilActor, Record<"idle" | "started" | "completed" | "failed", CouncilPose>>;

const idle = (caption: string): CouncilPose => ({ clip: "idle", once: false, procedural: "none", caption });
const recover = (caption: string): CouncilPose => ({ clip: "idle", once: false, procedural: "settle", caption });

export const COUNCIL_POSES: Table = {
  archivist: {
    idle: idle("Waiting for memories"),
    started: { clip: "read_scroll", once: false, procedural: "none", caption: "Reading the memories" },
    completed: { clip: "unroll_memory", once: true, then: "talk", procedural: "none", caption: "Presents the clues it found" },
    failed: recover("Couldn't read the memories"),
  },
  muse: {
    idle: idle("Waiting for clues"),
    // Muse uses its articulated brush and sketchbook.
    started: { clip: "sketch_idea", once: false, procedural: "none", caption: "Crafting a charm" },
    completed: { clip: "present_design", once: true, then: "idle", procedural: "none", caption: "Reveals the memory charm" },
    failed: recover("No charm this time"),
  },
  scout: {
    idle: idle("Ready to search"),
    // Scout uses its focusing optic and magnifier.
    started: { clip: "search", once: false, procedural: "none", caption: "Searching for real gifts" },
    completed: { clip: "discovery", once: true, then: "idle", procedural: "none", caption: "Presents researched options" },
    failed: recover("Search didn't come back — recovering"),
  },
  keeper: {
    idle: idle("Holding the budget"),
    started: { clip: "compare_options", once: false, procedural: "none", caption: "Checking budget and constraints" },
    completed: { clip: "approve", once: true, then: "idle", procedural: "none", caption: "Presents budget findings" },
    failed: recover("Couldn't check constraints"),
  },
  courier: {
    idle: idle("Ready to deliver"),
    // Courier holds the letter while coordinating.
    started: { clip: "carry_letter", once: false, procedural: "none", caption: "Coordinating the council" },
    completed: { clip: "deliver_message", once: true, then: "idle", procedural: "none", caption: "Delivers the recommendations" },
    failed: recover("Delivery failed"),
  },
};

export function poseFor(member: Pick<CouncilMemberState, "actor" | "status">): CouncilPose {
  return COUNCIL_POSES[member.actor][member.status];
}

/** UI accents only. Never recolor the finished models. */
/** One clear hue per role (casing, fabric, mat and the status dots in the room panel). */
export const COUNCIL_TINT: Record<CouncilActor, string> = {
  archivist: "#4a7fc0", // scholar's blue
  muse: "#a072d6", // painter's violet
  scout: "#4fa36a", // explorer's green
  keeper: "#d9a23a", // counting-house gold
  courier: "#e0674a", // post-red
};

export const COUNCIL_LABEL: Record<CouncilActor, string> = {
  archivist: "Archivist",
  muse: "Esum",
  scout: "Scout",
  keeper: "Keeper",
  courier: "Courier",
};

export const COUNCIL_MODELS: Record<CouncilActor, string> = Object.fromEntries(Object.keys(COUNCIL_LABEL).map(actor => [actor, `/ai-council/${actor}.glb`])) as Record<CouncilActor, string>;
