import { useSyncExternalStore } from "react";

/**
 * Single source of truth for the cinematic intro. One clock (`t`, seconds)
 * drives the DOM storybook overlay and the live WebGL camera alike, so every
 * phase is derived from the same number instead of scattered timeouts.
 *
 * Gates hold the clock at a boundary until the work that boundary needs is
 * done (world loaded, sketch traced, watercolour snapshot taken). A gate that
 * stays closed too long abandons the intro rather than trapping the user.
 */

export type IntroPhase =
  | "loading"
  | "bookOpening"
  | "sketching"
  | "watercolor"
  | "enteringWorld"
  | "giftReveal"
  | "worldFlythrough"
  | "returningToLanding"
  | "landingReady";

export const INTRO_TIMES = {
  bookOpening: 0,
  sketching: 2.0,
  watercolor: 5.5,
  enteringWorld: 7.5,
  giftReveal: 9.0,
  worldFlythrough: 10.2,
  returningToLanding: 12.6,
  end: 15.2,
} as const;

const SCHEDULE: [IntroPhase, number][] = [
  ["bookOpening", INTRO_TIMES.bookOpening],
  ["sketching", INTRO_TIMES.sketching],
  ["watercolor", INTRO_TIMES.watercolor],
  ["enteringWorld", INTRO_TIMES.enteringWorld],
  ["giftReveal", INTRO_TIMES.giftReveal],
  ["worldFlythrough", INTRO_TIMES.worldFlythrough],
  ["returningToLanding", INTRO_TIMES.returningToLanding],
];

/** When the watercolour snapshot is captured: late, so the live scene has barely drifted by the hand-off. */
export const SNAPSHOT_AT = INTRO_TIMES.watercolor - 0.3;

/** Gates the clock waits on. Loading may hold for a while; mid-sequence gates should be near-instant. */
const LOADING_TIMEOUT_S = 12;
const GATE_TIMEOUT_S = 5;

export interface SketchStroke {
  /** Screen-space polyline in CSS pixels, [x0, y0, x1, y1, ...]. */
  points: Float32Array;
  length: number;
  start: number;
  duration: number;
  weight: number;
  alpha: number;
}

export interface PaintRegion {
  x: number;
  y: number;
  radius: number;
  start: number;
  duration: number;
}

export interface SketchData {
  width: number;
  height: number;
  strokes: SketchStroke[];
  regions: PaintRegion[];
  /** Screen position of the gift, used to aim the push-in. */
  gift: { x: number; y: number };
}

type Listener = () => void;

class IntroClock {
  t = 0;
  phase: IntroPhase = "landingReady";
  active = false;
  /** QA hook: freeze the clock once it reaches this time. */
  pauseAt: number | null = null;
  gates = { world: false, sketch: false, snapshot: false };
  sketch: SketchData | null = null;
  snapshot: HTMLCanvasElement | null = null;
  /** Bumped on every (re)start so long-lived consumers can reset their own state. */
  run = 0;
  private heldFor = 0;
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

  private setPhase(phase: IntroPhase) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.emit();
  }

  start() {
    this.t = 0;
    this.heldFor = 0;
    this.active = true;
    this.run++;
    // The world gate persists across replays; per-run artefacts do not.
    this.gates.snapshot = false;
    this.snapshot = null;
    this.phase = "loading";
    this.emit();
  }

  /** Jump to a valid landing state from anywhere in the sequence. */
  finish() {
    this.t = INTRO_TIMES.end;
    this.active = false;
    this.setPhase("landingReady");
  }

  /** Tracing depends on the viewport, so a resize invalidates it. */
  invalidateSketch() {
    this.gates.sketch = false;
    this.sketch = null;
  }

  advance(dt: number) {
    if (!this.active) return;
    if (this.phase === "loading") {
      if (this.gates.world && this.gates.sketch) {
        this.heldFor = 0;
        this.setPhase("bookOpening");
      } else {
        this.heldFor += dt;
        if (this.heldFor > LOADING_TIMEOUT_S) this.finish();
      }
      return;
    }
    if (this.pauseAt !== null && this.t >= this.pauseAt) return;

    let next = this.t + dt;
    if (this.pauseAt !== null) next = Math.min(next, this.pauseAt);
    // Never let the watercolour start without its painting.
    if (!this.gates.snapshot && next >= INTRO_TIMES.watercolor) {
      next = INTRO_TIMES.watercolor - 1e-3;
      this.heldFor += dt;
      if (this.heldFor > GATE_TIMEOUT_S) {
        this.finish();
        return;
      }
    } else {
      this.heldFor = 0;
    }
    this.t = next;
    if (this.t >= INTRO_TIMES.end) {
      this.finish();
      return;
    }
    let phase: IntroPhase = "bookOpening";
    for (const [p, at] of SCHEDULE) if (this.t >= at) phase = p;
    this.setPhase(phase);
  }
}

export const introClock = new IntroClock();

export function useIntroPhase(): IntroPhase {
  return useSyncExternalStore(
    introClock.subscribe,
    () => introClock.phase,
    () => "landingReady" as IntroPhase,
  );
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
