import { useSyncExternalStore } from "react";

/**
 * The hanging "Begin" tag on the island's present: the opening's interactive
 * endpoint. Purely visual — a tug plays an animation and nothing else (no
 * navigation, rooms or backend).
 *
 * One store is shared by the 3D tag, the present it hangs from, the camera
 * (which holds the close-up while the title screen is mounted) and the DOM
 * mirror button that gives keyboard and screen-reader access. Every animation
 * is a function of the time since its transition, so all of them stay in
 * lock-step and a replay simply resets the timestamps.
 */

export type GiftTagState =
  /** Intro still running (or no title screen): the tag hangs still and ignores input. */
  | "hidden"
  /** Camera has arrived: the tag swings into view and settles. Already clickable. */
  | "settling"
  | "ready"
  /** The viewer's pull: string goes taut, tag swings out and down. */
  | "tugging"
  /** Ribbon flexes, the present hops and glows, spirits react. */
  | "responding"
  /** Everything has settled; the tag can be tugged again. */
  | "complete";

/** Timings in seconds from the tug (full motion). */
export const TUG = {
  /** Tag is pulled out and down. */
  pull: 0.28,
  /** Let go: the tag swings back on its own. */
  release: 0.42,
  /** The present answers (glow, sparkles, hop). */
  respond: 0.45,
  /** Everything at rest again. */
  done: 2.6,
} as const;
/** Reduced motion: a short glow instead of the tug. */
const REDUCED_DONE = 1.1;
export const SETTLE_DURATION = 1.6;

type Listener = () => void;
const now = () => performance.now() / 1000;

class GiftTagStore {
  /** True while the title screen is mounted on the landing route. */
  enabled = false;
  state: GiftTagState = "hidden";
  hovered = false;
  /** Full motion unless the viewer prefers reduced motion. */
  motion = true;
  revealAt = -Infinity;
  tugAt = -Infinity;
  hoverAt = -Infinity;
  tugCount = 0;
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

  private set(state: GiftTagState) {
    if (state === this.state) return;
    this.state = state;
    this.emit();
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.reset();
    this.emit();
  }

  /** Back to the still, non-interactive pose (intro start or replay). */
  reset() {
    this.revealAt = this.tugAt = -Infinity;
    this.hovered = false;
    this.set("hidden");
  }

  /** The camera has settled on the present: invite the tug. */
  reveal() {
    if (!this.enabled || this.state !== "hidden") return;
    this.revealAt = now();
    this.set(this.motion ? "settling" : "ready");
  }

  get interactive() {
    return this.enabled && (this.state === "settling" || this.state === "ready" || this.state === "complete");
  }

  get busy() {
    return this.state === "tugging" || this.state === "responding";
  }

  setHover(on: boolean) {
    if (on === this.hovered) return;
    this.hovered = on;
    this.hoverAt = now();
    this.emit();
  }

  /** Returns false (and does nothing) when a tug is already playing or the tag is not ready. */
  tug(): boolean {
    if (!this.interactive) return false;
    this.tugAt = now();
    this.tugCount++;
    this.set("tugging");
    return true;
  }

  /** Seconds since the tug, or Infinity when none is playing. */
  tugAge(t = now()): number {
    return this.busy ? t - this.tugAt : Infinity;
  }

  /** Steps the state machine; called every rendered frame by the tag. */
  advance(t = now()) {
    if (this.state === "settling" && t - this.revealAt >= SETTLE_DURATION) this.set("ready");
    if (!this.busy) return;
    const age = t - this.tugAt;
    const done = this.motion ? TUG.done : REDUCED_DONE;
    if (age >= done) this.set("complete");
    else if (this.state === "tugging" && age >= (this.motion ? TUG.respond : 0.15)) this.set("responding");
  }
}

export const giftTag = new GiftTagStore();

export function useGiftTagState(): GiftTagState {
  return useSyncExternalStore(
    giftTag.subscribe,
    () => giftTag.state,
    () => "hidden" as GiftTagState,
  );
}

export function useGiftTagEnabled(): boolean {
  return useSyncExternalStore(
    giftTag.subscribe,
    () => giftTag.enabled,
    () => false,
  );
}

/**
 * The "you can tug me" swing played once when the camera arrives: a pendulum
 * kick that overshoots and dies away. `age` is seconds since the reveal.
 */
export function settleSwing(age: number, motion: boolean): number {
  if (!motion || !(age >= 0) || age > SETTLE_DURATION + 1) return 0;
  return Math.exp(-age * 2.4) * Math.sin(age * 5.2);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/**
 * Shared tug curves, sampled by both the tag and the present so the pull,
 * the ribbon's answer and the glow line up. `age` is seconds since the tug.
 */
export function tugCurves(age: number, motion: boolean) {
  if (!Number.isFinite(age) || age < 0) return { pull: 0, swing: 0, ribbon: 0, hop: 0, glow: 0, sparkle: false };
  if (!motion) {
    // Reduced motion: no pull or hop, only a warm glow that rises and fades.
    const glow = smooth(0, 0.25, age) * (1 - smooth(0.45, REDUCED_DONE, age));
    return { pull: 0, swing: 0, ribbon: 0, hop: 0, glow, sparkle: false };
  }
  // Quick, soft pull (ease-out), held a beat, then released.
  const pullIn = 1 - Math.pow(1 - clamp01(age / TUG.pull), 3);
  const pull = pullIn * (1 - smooth(TUG.release, TUG.release + 0.22, age));
  // After the release the tag swings back past rest and settles.
  const r = age - TUG.release;
  const swing = r > 0 ? Math.exp(-r * 2.6) * Math.sin(r * 7.2) : 0;
  // A ripple through the ribbon, slightly behind the pull.
  const rb = clamp01((age - 0.12) / 0.9);
  const ribbon = Math.sin(rb * Math.PI) * Math.exp(-rb * 1.4);
  // Anticipation dip, a small hop, then a damped settle.
  let hop = 0;
  if (age < 0.3) hop = -0.35 * Math.sin((age / 0.3) * Math.PI * 0.5) * smooth(0.1, 0.3, age);
  else if (age < 0.62) hop = -0.35 + 1.35 * Math.sin(((age - 0.3) / 0.32) * Math.PI * 0.5);
  else {
    const k = age - 0.62;
    hop = Math.exp(-k * 4.5) * Math.cos(k * 9);
  }
  const glow = smooth(TUG.respond, TUG.respond + 0.35, age) * (1 - smooth(1.15, TUG.done, age));
  return { pull, swing, ribbon, hop, glow, sparkle: age >= TUG.respond };
}
