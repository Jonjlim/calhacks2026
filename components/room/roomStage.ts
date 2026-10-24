import { useSyncExternalStore } from "react";

/**
 * Where a gift room is staged in the one island world:
 *   tower  — inside the storybook tower: friends share memories around the
 *            council's table while the five agents work.
 *   garden — back outside at the island's own present: friends carry the
 *            Muse's charms out and decorate it, and choose the gift.
 *
 * One clock owns the transition (glide → fade out → swap scene at the darkest
 * moment → fade in), so the camera, the fade overlay and the scenes can never
 * disagree. The intro and unwrap clocks own the camera on "/"; this one only
 * runs inside rooms.
 */
export type RoomStage = "tower" | "garden";

/** Seconds: approach (camera glides toward the doorway), then fade out, then fade in. */
export const STAGE_TIMES = { approach: 1.15, fadeOut: 0.45, fadeIn: 0.7 } as const;

type Listener = () => void;

class RoomStageClock {
  /** The scene currently rendered (switches only at the fade's darkest point). */
  shown: RoomStage | null = null;
  /** Where we are heading. */
  target: RoomStage | null = null;
  /** The stage we are leaving (for its exit camera move). */
  from: RoomStage | null = null;
  /** Seconds into the current transition; -1 when settled. */
  t = -1;
  /** Bumped whenever a new scene is shown, so arrival animations restart cleanly. */
  arrival = 0;
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

  get transitioning() {
    return this.t >= 0;
  }

  /** Request a stage. `instant` (reduced motion, deep link) swaps without the glide. */
  go(stage: RoomStage | null, instant = false) {
    if (stage === this.target && (this.transitioning || this.shown === stage)) return;
    this.from = this.shown;
    this.target = stage;
    if (instant || stage === null) {
      this.shown = stage;
      this.t = -1;
      this.arrival++;
    } else {
      // Entering from outside the room glides to the doorway first; tower ↔ garden just fades.
      this.t = this.from === null && stage === "tower" ? 0 : STAGE_TIMES.approach;
    }
    this.emit();
  }

  /** Fade overlay opacity, 0..1. */
  get fade(): number {
    if (this.t < 0) return 0;
    const { approach, fadeOut, fadeIn } = STAGE_TIMES;
    if (this.t < approach) return 0;
    if (this.t < approach + fadeOut) return (this.t - approach) / fadeOut;
    return Math.max(0, 1 - (this.t - approach - fadeOut) / fadeIn);
  }

  /** 0..1 progress of the approach glide (only on first entry to the tower). */
  get approachProgress(): number {
    return this.t < 0 ? 1 : Math.min(1, this.t / STAGE_TIMES.approach);
  }

  advance(dt: number) {
    if (this.t < 0) return;
    const { approach, fadeOut, fadeIn } = STAGE_TIMES;
    const before = this.t;
    this.t += Math.min(dt, 0.05);
    if (before < approach + fadeOut && this.t >= approach + fadeOut) {
      this.shown = this.target;
      this.arrival++;
      this.emit();
    }
    if (this.t >= approach + fadeOut + fadeIn) {
      this.t = -1;
      this.emit();
    }
  }
}

export const roomStage = new RoomStageClock();

export function useRoomStage(): { shown: RoomStage | null; target: RoomStage | null; arrival: number } {
  const shown = useSyncExternalStore(roomStage.subscribe, () => roomStage.shown, () => null);
  const target = useSyncExternalStore(roomStage.subscribe, () => roomStage.target, () => null);
  const arrival = useSyncExternalStore(roomStage.subscribe, () => roomStage.arrival, () => 0);
  return { shown, target, arrival };
}
