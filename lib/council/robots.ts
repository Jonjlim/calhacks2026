import type { CouncilActor, CouncilMemberState } from "./contracts";

/** Which storybook body each council robot is built on. Same rig and clips as the player avatars. */
export const COUNCIL_AVATAR = {
  archivist: "calm",
  muse: "dreamer",
  scout: "explorer",
  keeper: "kind",
  courier: "curious",
} as const satisfies Record<CouncilActor, "explorer" | "dreamer" | "kind" | "calm" | "curious">;

/** Robot shell colour per role. */
export const ROBOT_TINT: Record<CouncilActor, string> = {
  archivist: "#4a7fc0",
  muse: "#a072d6",
  scout: "#4fa36a",
  keeper: "#d9a23a",
  courier: "#e0674a",
};

export type RobotClip = "Idle" | "Walk" | "Wave" | "Sit" | "Celebrate";

export interface RobotClipInput {
  status: CouncilMemberState["status"];
  /** Travelling between the dock and its work spot. */
  walking?: boolean;
  /** A completion that arrived live and has not finished its celebration yet. */
  celebrating?: boolean;
  hover?: boolean;
  /** The gift reveal is playing. */
  reveal?: boolean;
  /** An occasional idle gesture. */
  gesture?: "Wave" | "Sit";
}

/** One clip from the robot's real state; earlier rules win. */
export function robotClip(i: RobotClipInput): RobotClip {
  if (i.walking) return "Walk";
  if (i.reveal) return "Celebrate";
  if (i.status === "failed") return "Sit";
  if (i.status === "started") return "Walk";
  if (i.status === "completed" && i.celebrating) return "Celebrate";
  if (i.hover) return "Wave";
  if (i.status === "idle" && i.gesture) return i.gesture;
  return "Idle";
}
