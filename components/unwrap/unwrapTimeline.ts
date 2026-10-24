import { useSyncExternalStore } from "react";

/**
 * Create-a-room → gift-to-invitation sequence. One clock drives the camera,
 * the gift's own unwrapping, the unfolding card, the QR tiles and the DOM
 * invitation, so nothing can drift out of step or overlap.
 *
 * Invitation *data* (names, source) is kept apart from the animation, and the
 * QR pattern comes from a replaceable provider (lib/invitation/mockQr).
 */

export type UnwrapPhase =
  | "landing"
  | "closingForm"
  | "approachingGift"
  | "giftAnticipation"
  | "unwrapping"
  | "unfoldingPaper"
  | "assemblingQR"
  | "invitationReady"
  | "returningToWorld";

export const UNWRAP_TIMES = {
  closingForm: 0,
  approachingGift: 0.4,
  /** The present lifts and its ribbon loosens. */
  giftAnticipation: 1.35,
  /** Bow unties and falls, ribbon slips to the floor, lid comes off. */
  unwrapping: 2.0,
  /** Walls fall open onto the pedestal and a tree grows out of the box. */
  unfoldingPaper: 2.95,
  /** Seen from above, tree and wrapping pixelate and settle into the code. */
  assemblingQR: 5.0,
  invitationReady: 7.0,
  /** Text and decorations settle in after the code stops. */
  settled: 7.55,
} as const;

/** Playback speed of the whole sequence; all beats keep their relative timing. */
export const UNWRAP_SPEED = 1.3;

/**
 * Closing rewinds the whole sequence (code → tree → open box → wrapped
 * present, camera back to the island) at speed, so the return is as
 * continuous as the way in.
 */
export const RETURN_SECONDS = 2.2;

const SCHEDULE: [UnwrapPhase, number][] = [
  ["closingForm", UNWRAP_TIMES.closingForm],
  ["approachingGift", UNWRAP_TIMES.approachingGift],
  ["giftAnticipation", UNWRAP_TIMES.giftAnticipation],
  ["unwrapping", UNWRAP_TIMES.unwrapping],
  ["unfoldingPaper", UNWRAP_TIMES.unfoldingPaper],
  ["assemblingQR", UNWRAP_TIMES.assemblingQR],
  ["invitationReady", UNWRAP_TIMES.invitationReady],
];

export interface InvitationDetails {
  recipientDisplayName: string;
  occasion: string;
  hostDisplayName: string;
  /** `mock` = nothing was saved; the card must say it is a preview. */
  source: "mock" | "convex";
  /** Real rooms only: where "Enter the room" goes. */
  roomId?: string;
  /** Real rooms only: the code behind `/join/<token>`. */
  inviteToken?: string;
}

/** Screen rectangle of the floating 3D card (CSS px), for aligning DOM text to it. */
export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Listener = () => void;

class UnwrapClock {
  t = 0;
  /** 0→1 while returning to the world. */
  back = 0;
  /** Sequence time when the invitation was closed; the rewind runs from here to 0. */
  private closedAt = 0;
  phase: UnwrapPhase = "landing";
  active = false;
  /** HTML-only presentation: reduced motion, no WebGL, or a failed 3D sequence. */
  staticPreview = false;
  invite: InvitationDetails | null = null;
  cardRect: CardRect | null = null;
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

  /** Begins the sequence. Ignored while one is already running, so taps can't overlap. */
  start(invite: InvitationDetails, opts: { staticPreview: boolean }) {
    if (this.active) return false;
    this.invite = invite;
    this.staticPreview = opts.staticPreview;
    this.active = true;
    this.cardRect = null;
    this.back = 0;
    this.run++;
    this.t = opts.staticPreview ? UNWRAP_TIMES.settled : 0;
    this.phase = opts.staticPreview ? "invitationReady" : "closingForm";
    this.emit();
    return true;
  }

  /** Replays from a clean gift (keeps the same invitation details). */
  replay() {
    if (!this.invite) return;
    const invite = this.invite;
    const staticPreview = this.staticPreview;
    this.active = false;
    this.start(invite, { staticPreview });
  }

  /** Jump straight to the finished, stationary invitation. */
  skip() {
    if (!this.active || this.phase === "returningToWorld") return;
    this.t = Math.max(this.t, UNWRAP_TIMES.settled);
    this.setPhase("invitationReady");
  }

  /** Fall back to the HTML invitation if the 3D sequence can't complete. */
  degrade() {
    if (!this.active) return;
    this.staticPreview = true;
    this.t = UNWRAP_TIMES.settled;
    this.setPhase("invitationReady");
    this.emit();
  }

  close() {
    if (!this.active || this.phase === "returningToWorld") return;
    if (this.staticPreview) {
      this.end();
      return;
    }
    this.back = 0;
    this.closedAt = this.t;
    this.setPhase("returningToWorld");
  }

  reset() { this.end(); }

  private end() {
    this.active = false;
    this.back = 0;
    this.t = 0;
    this.cardRect = null;
    this.setPhase("landing");
  }

  advance(dt: number) {
    if (!this.active || this.staticPreview) return;
    if (this.phase === "returningToWorld") {
      this.back = Math.min(1, this.back + dt / RETURN_SECONDS);
      const k = this.back * this.back * (3 - 2 * this.back);
      this.t = this.closedAt * (1 - k);
      if (this.back >= 1) this.end();
      return;
    }
    if (this.pauseAt !== null && this.t >= this.pauseAt) return;
    this.t = Math.min(UNWRAP_TIMES.settled + 1, this.pauseAt ?? Infinity, this.t + dt * UNWRAP_SPEED);
    let p: UnwrapPhase = "closingForm";
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

/** Progress of `t` through [a, b], eased. */
export const span = (t: number, a: number, b: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
