import { useSyncExternalStore } from "react";
import { type ArtifactInput, buildArtifacts } from "@/lib/convergence/artifacts";
import { CONVERGENCE_TIMES, EXIT_TIME, type ConvergenceState, stateAt } from "@/lib/convergence/timeline";

/**
 * The Great Gift Convergence's one clock. The organizer's reveal starts it;
 * the 3D present, the camera, the artifacts and the DOM all read `t` from here
 * (the DOM's frame loop advances it), so nothing is a pile of timeouts and
 * a replay is exactly the same performance. It is local presentation only:
 * the chosen gift itself lives in Convex, and nothing here writes to it.
 *
 *   idle → playing → holding (the reveal stays up) → leaving (the camera
 *   glides back to the map) → idle
 */

type Listener = () => void;

/** The camera pose the map had when the reveal began, so the push starts exactly where the viewer was. */
export interface StartPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  shiftX: number;
  shiftY: number;
}

class ConvergenceClock {
  active = false;
  /** Seconds into the sequence. */
  t = 0;
  /** 0..EXIT_TIME while the camera glides back; -1 otherwise. */
  exit = -1;
  /** Bumped per run, so 3D parts reset to a clean present. */
  run = 0;
  /** The selection this performance shows. If the room's selection changes, the reveal is dropped. */
  selectionId: string | null = null;
  /** What flies in: published memories and ideas of the room, with where their islands float. */
  inputs: ArtifactInput[] = [];
  /** When each island's artifact lands in the box (by ring node key); the island is gone from then on. */
  arrivals = new Map<string, number>();
  /** Total shared things, including any that were grouped rather than drawn. */
  total = 0;
  /** Reduced motion (or reopening the finished reveal): straight to the end state. */
  instant = false;
  /** Fast-forward after "Skip". */
  private speed = 1;
  startPose: StartPose | null = null;
  /** QA hook (dev only): hold the sequence once it reaches this time. */
  pauseAt: number | null = null;
  private listeners = new Set<Listener>();
  private lastState: ConvergenceState = "idle";

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  get state(): ConvergenceState {
    return this.active ? stateAt(this.t) : "idle";
  }

  get leaving() {
    return this.exit >= 0;
  }

  /** The finished reveal is on screen. */
  get holding() {
    return this.active && this.t >= CONVERGENCE_TIMES.end && !this.leaving;
  }

  /** The 3D scene is being driven: from the first frame until the camera is home again. */
  get engaged() {
    return this.active;
  }

  start(opts: { selectionId: string; inputs: ArtifactInput[]; total: number; instant: boolean }) {
    if (this.active) return false;
    this.active = true;
    this.t = opts.instant ? CONVERGENCE_TIMES.end : 0;
    this.exit = -1;
    this.instant = opts.instant;
    this.speed = 1;
    this.selectionId = opts.selectionId;
    this.inputs = opts.inputs;
    this.total = opts.total;
    this.arrivals = new Map(buildArtifacts(opts.inputs).artifacts.map((a) => [a.key, a.arrive]));
    this.startPose = null;
    this.run++;
    this.lastState = stateAt(this.t);
    this.emit();
    return true;
  }

  /** Fast-forwards the performance to the reveal. */
  skip() {
    if (!this.active || this.leaving || this.t >= CONVERGENCE_TIMES.reveal[0]) return;
    this.speed = 5;
  }

  /** Closes the reveal: the camera glides back to the map. */
  close() {
    if (!this.active || this.leaving) return;
    if (this.t < CONVERGENCE_TIMES.end) this.t = CONVERGENCE_TIMES.end;
    this.exit = this.instant ? EXIT_TIME : 0;
    this.emit();
  }

  /** Drops everything now (the selection changed, or the page is going away). */
  abort() {
    if (!this.active) return;
    this.active = false;
    this.exit = -1;
    this.t = 0;
    this.startPose = null;
    this.emit();
  }

  advance(dt: number) {
    if (!this.active) return;
    const step = Math.min(dt, 0.05);
    if (this.leaving) {
      this.exit += step;
      if (this.exit >= EXIT_TIME) {
        this.active = false;
        this.exit = -1;
        this.startPose = null;
        this.emit();
      }
      return;
    }
    if (this.t >= CONVERGENCE_TIMES.end) return;
    this.t = Math.min(CONVERGENCE_TIMES.end, this.t + step * this.speed);
    if (this.pauseAt !== null && this.t > this.pauseAt) this.t = Math.max(this.pauseAt, Math.min(this.t, this.pauseAt));
    if (this.t >= CONVERGENCE_TIMES.reveal[0]) this.speed = 1;
    const now = stateAt(this.t);
    if (now !== this.lastState) {
      this.lastState = now;
      this.emit();
    }
  }
}

export const convergence = new ConvergenceClock();

export function useConvergenceState(): ConvergenceState {
  return useSyncExternalStore(convergence.subscribe, () => convergence.state, () => "idle" as const);
}

export function useConvergenceActive(): boolean {
  return useSyncExternalStore(convergence.subscribe, () => convergence.active, () => false);
}

export function useConvergenceRun(): number {
  return useSyncExternalStore(convergence.subscribe, () => convergence.run, () => 0);
}

export function useConvergenceLeaving(): boolean {
  return useSyncExternalStore(convergence.subscribe, () => convergence.leaving, () => false);
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __convergence?: ConvergenceClock }).__convergence = convergence;
}
