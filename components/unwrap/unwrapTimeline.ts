import { useSyncExternalStore } from "react";

/**
 * Chapter 2 — the gift awakens. Pulling the hanging "Begin" tag starts one
 * clock that drives everything that follows, so the camera, the present, the
 * ribbon, the tree and the DOM invitation can never drift out of step:
 *
 *   tag detaches and flies → becomes the parchment invitation on the right
 *   while the camera reframes the present on the left → the ribbon is pulled
 *   loose and flies away → the lid opens and an autumn tree grows inside the
 *   box → all four walls fold down to reveal it → (the organizer writes who
 *   it's for and presses "Invite") → the camera rises to look
 *   down and the canopy turns into blocks that settle into the room's real
 *   QR code → live lobby.
 *
 * Two gates hold the clock: the names (the top view waits for "Invite") and
 * the room (the code is never shown for a room that does
 * not exist yet). Visual state lives
 * here; room data is only mirrored in `invite` so the 3D scene and the DOM
 * agree on what to show.
 */

export type UnwrapPhase =
  | "landing"
  | "tagDetaching"
  | "tagFlying"
  | "invitationLayout"
  | "ribbonUnwrapping"
  | "boxOpening"
  | "treeGrowing"
  /** Holding on the revealed tree until "Invite". */
  | "awaitingNames"
  /** Holding: the tree is grown; waiting for the names and the room. */
  | "awaitingRoom"
  | "lobbyReady";

export const UNWRAP_TIMES = {
  /** The tug pulls the string taut, then the tag lets go. */
  tagDetach: 0.45,
  /** The flying tag hands over to the DOM parchment. */
  tagHandoff: 1.45,
  /** Camera glides from the close-up to the lobby framing. */
  reframe: [0.4, 1.7] as const,
  /** Parchment settled on the right. */
  parchmentSettled: 2.2,
  /** One ribbon tail is pulled; the bow collapses; the bands peel off. */
  ribbonPull: 1.6,
  /** Every point of the ribbon is free. */
  ribbonPeeled: 3.0,
  /** The loose ribbon has swept offscreen. */
  ribbonGone: 4.0,
  /** The lid hinges open at the back, showing the hollow box. */
  lidOpen: [3.3, 4.0] as const,
  /** Grass and flowers sprout on the box floor. */
  grass: [3.7, 4.3] as const,
  /** A sapling rises in the open box as all four walls fold down flat to reveal it (the lid, hinged to the back wall, goes with it)... */
  wallsFold: [3.95, 4.85] as const,
  /** ...and grows into the full autumn tree once the walls are out of its way. */
  treeGrow: [4.0, 5.4] as const,
  /** Holds on the revealed tree until the organizer presses "Invite". */
  namesGate: 5.6,
  /** Then the camera rises to look straight down on the open box... */
  topView: [5.6, 6.7] as const,
  /**
   * The canopy turns into blocks that fall into the box and settle into the
   * QR code. Holds here until the room exists, since the code is its link.
   */
  roomGate: 6.8,
  /** The crown has pixelated and melted down into the code (see world/unwrap/GiftUnwrap). */
  settled: 8.95,
} as const;

/** Playback speed of the whole sequence; all beats keep their relative timing. */
export const UNWRAP_SPEED = 1;

const SCHEDULE: [UnwrapPhase, number][] = [
  ["tagDetaching", 0],
  ["tagFlying", UNWRAP_TIMES.tagDetach],
  ["invitationLayout", UNWRAP_TIMES.tagHandoff],
  ["ribbonUnwrapping", UNWRAP_TIMES.parchmentSettled],
  ["boxOpening", UNWRAP_TIMES.lidOpen[0]],
  ["treeGrowing", UNWRAP_TIMES.treeGrow[0]],
  ["awaitingNames", UNWRAP_TIMES.namesGate],
  ["awaitingRoom", UNWRAP_TIMES.roomGate],
  ["lobbyReady", UNWRAP_TIMES.settled],
];

/** What the invitation shows. Mirrors Convex; never invented. */
export interface InvitationDetails {
  recipientDisplayName: string;
  hostDisplayName: string;
  occasion: string;
  roomId: string;
  inviteToken: string;
  /** The URL the QR encodes: a configured public origin, or this page's. */
  inviteUrl: string;
}

/** Screen rectangle in CSS px; `rotate` in radians (for the tag hand-off). */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: number;
}

type Listener = () => void;

class UnwrapClock {
  t = 0;
  phase: UnwrapPhase = "landing";
  active = false;
  /** Reduced motion or no WebGL: jump between the held states instead of animating. */
  staticPreview = false;
  /** The organizer has submitted TO / FROM. */
  namesSubmitted = false;
  invite: InvitationDetails | null = null;
  /** Projected rectangle of the flying 3D tag at the hand-off, for the DOM parchment to grow from. */
  tagRect: ScreenRect | null = null;
  /** Projected rectangle of the settled 3D QR code, for the label beneath it. */
  codeRect: ScreenRect | null = null;
  /** Bumped per run so 3D parts reset to a clean gift. */
  run = 0;
  /** QA hook (dev only): hold the sequence once it reaches this time. */
  pauseAt: number | null = null;
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private setPhase(p: UnwrapPhase) {
    if (p === this.phase) return;
    this.phase = p;
    this.emit();
  }

  /** The Begin tag was pulled. Ignored while a run is in progress, so clicks can't overlap. */
  start(opts: { staticPreview: boolean }) {
    if (this.active) return false;
    this.active = true;
    this.staticPreview = opts.staticPreview;
    this.namesSubmitted = false;
    this.invite = null;
    this.tagRect = this.codeRect = null;
    this.run++;
    this.t = opts.staticPreview ? UNWRAP_TIMES.namesGate : 0;
    this.phase = opts.staticPreview ? "awaitingRoom" : "tagDetaching";
    this.emit();
    return true;
  }

  /** The organizer has sent TO / FROM; the room is being created. */
  submitNames() {
    if (!this.active || this.namesSubmitted) return;
    this.namesSubmitted = true;
    if (this.staticPreview) this.t = UNWRAP_TIMES.roomGate;
    this.emit();
  }

  /** The room exists: the plaque may show its real QR. */
  roomReady(invite: InvitationDetails) {
    this.invite = invite;
    if (this.staticPreview) this.t = UNWRAP_TIMES.settled;
    this.emit();
  }

  /** Room creation failed: let the organizer edit and resubmit. The scene keeps its place. */
  roomFailed() {
    this.namesSubmitted = false;
    this.t = Math.min(this.t, UNWRAP_TIMES.namesGate);
    this.emit();
  }

  /**
   * Restores a lobby after a refresh or revisit: no cinematic, straight to
   * the open gift with its tree and QR.
   */
  restore(invite: InvitationDetails, opts: { staticPreview: boolean }) {
    this.active = true;
    this.staticPreview = opts.staticPreview;
    this.namesSubmitted = true;
    this.invite = invite;
    this.tagRect = null;
    this.run++;
    this.t = UNWRAP_TIMES.settled;
    this.phase = "lobbyReady";
    this.emit();
  }

  /** Jumps to the next hold: the revealed tree, or the code (once the room exists). */
  skip() {
    if (!this.active) return;
    const to = !this.namesSubmitted ? UNWRAP_TIMES.namesGate : this.invite ? UNWRAP_TIMES.settled : UNWRAP_TIMES.roomGate;
    this.t = Math.max(this.t, to);
    this.advance(0);
  }

  reset() {
    this.active = false;
    this.namesSubmitted = false;
    this.invite = null;
    this.t = 0;
    this.tagRect = this.codeRect = null;
    this.setPhase("landing");
  }

  /** Where the clock is allowed to run to right now. */
  private limit() {
    if (!this.namesSubmitted) return UNWRAP_TIMES.namesGate;
    return this.invite ? UNWRAP_TIMES.settled : UNWRAP_TIMES.roomGate;
  }

  advance(dt: number) {
    if (!this.active) return;
    let next = this.t + dt * UNWRAP_SPEED;
    next = Math.min(next, this.limit(), this.pauseAt ?? Infinity);
    this.t = Math.max(this.t, next);
    let p: UnwrapPhase = "tagDetaching";
    for (const [phase, at] of SCHEDULE) if (this.t >= at) p = phase;
    this.setPhase(p);
  }
}

export const unwrapClock = new UnwrapClock();

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __unwrapClock?: UnwrapClock }).__unwrapClock = unwrapClock;
}

export function useUnwrapPhase(): UnwrapPhase {
  return useSyncExternalStore(
    unwrapClock.subscribe,
    () => unwrapClock.phase,
    () => "landing" as UnwrapPhase,
  );
}

/** Re-renders on every clock event (phase, gates, invite). */
export function useUnwrapClock() {
  useSyncExternalStore(
    unwrapClock.subscribe,
    () => `${unwrapClock.phase}|${unwrapClock.namesSubmitted}|${unwrapClock.invite?.roomId ?? ""}|${unwrapClock.run}`,
    () => "landing",
  );
  return unwrapClock;
}

/** Progress of `t` through [a, b], eased. */
export const span = (t: number, a: number, b: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/** Linear progress of `t` through [a, b]. */
export const progress = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
