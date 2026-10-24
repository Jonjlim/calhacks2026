/**
 * QA: the cinematic-intro state machine (components/intro/introTimeline.ts).
 * Pure logic only: no DOM, no WebGL, no React rendering. The implementation is
 * Claude's; these tests only observe its public behaviour.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { INTRO_TIMES, type IntroPhase, introClock, SNAPSHOT_AT, smoothstep } from "../../components/intro/introTimeline";

const DT = 1 / 60;

/** The clock is a module singleton: restore a known state before each test. */
function reset() {
  introClock.finish();
  introClock.pauseAt = null;
  introClock.gates.world = false;
  introClock.gates.sketch = false;
  introClock.gates.snapshot = false;
  introClock.sketch = null;
  introClock.snapshot = null;
}

function openAllGates() {
  introClock.gates.world = true;
  introClock.gates.sketch = true;
  introClock.gates.snapshot = true;
}

function run(seconds: number, dt = DT) {
  // Seed with the current phase so "seen" is the full journey, including where it started.
  const seen: IntroPhase[] = [introClock.phase];
  const steps = Math.ceil(seconds / dt);
  for (let i = 0; i < steps; i++) {
    introClock.advance(dt);
    if (seen[seen.length - 1] !== introClock.phase) seen.push(introClock.phase);
  }
  return seen;
}

beforeEach(reset);

describe("schedule constants", () => {
  it("phase start times strictly increase and end after the last phase", () => {
    const t = INTRO_TIMES;
    const ordered = [t.bookOpening, t.sketching, t.watercolor, t.enteringWorld, t.giftReveal, t.worldFlythrough, t.returningToLanding, t.end];
    for (let i = 1; i < ordered.length; i++) expect(ordered[i]!, `index ${i}`).toBeGreaterThan(ordered[i - 1]!);
  });

  it("captures the watercolour snapshot just before the watercolour phase begins", () => {
    expect(SNAPSHOT_AT).toBeLessThan(INTRO_TIMES.watercolor);
    expect(SNAPSHOT_AT).toBeGreaterThan(INTRO_TIMES.sketching);
  });
});

describe("start / finish", () => {
  it("is idle on the landing state when not started", () => {
    expect(introClock.active).toBe(false);
    expect(introClock.phase).toBe("landingReady");
  });

  it("start() enters loading at t=0, bumps the run counter, and clears per-run artefacts but keeps the world gate", () => {
    introClock.gates.world = true;
    introClock.gates.snapshot = true;
    const before = introClock.run;
    introClock.start();
    expect(introClock.active).toBe(true);
    expect(introClock.phase).toBe("loading");
    expect(introClock.t).toBe(0);
    expect(introClock.run).toBe(before + 1);
    expect(introClock.gates.snapshot).toBe(false);
    expect(introClock.gates.world).toBe(true);
  });

  it("finish() lands from any phase and makes later advances no-ops", () => {
    openAllGates();
    introClock.start();
    run(6);
    expect(introClock.phase).not.toBe("landingReady");
    introClock.finish();
    expect(introClock.phase).toBe("landingReady");
    expect(introClock.active).toBe(false);
    expect(introClock.t).toBe(INTRO_TIMES.end);
    introClock.advance(5);
    expect(introClock.t).toBe(INTRO_TIMES.end);
    expect(introClock.phase).toBe("landingReady");
  });

  it("can be restarted (replay) after finishing", () => {
    introClock.start();
    introClock.finish();
    introClock.start();
    expect(introClock.phase).toBe("loading");
    expect(introClock.active).toBe(true);
    expect(introClock.t).toBe(0);
  });
});

describe("loading gate", () => {
  it("holds t at 0 until BOTH world and sketch gates are open", () => {
    introClock.start();
    run(3);
    expect(introClock.phase).toBe("loading");
    expect(introClock.t).toBe(0);

    introClock.gates.world = true;
    run(3);
    expect(introClock.phase).toBe("loading");

    introClock.gates.sketch = true;
    introClock.advance(DT);
    expect(introClock.phase).toBe("bookOpening");
  });

  it("abandons the intro (lands on the page) if loading never completes within ~12s", () => {
    introClock.start();
    run(11.5);
    expect(introClock.active).toBe(true);
    run(1.5);
    expect(introClock.phase).toBe("landingReady");
    expect(introClock.active).toBe(false);
  });

  it("does not time out while loading is progressing normally", () => {
    introClock.gates.world = true;
    introClock.gates.sketch = true;
    introClock.start();
    introClock.gates.sketch = true;
    introClock.advance(DT);
    expect(introClock.phase).toBe("bookOpening");
  });
});

describe("phase progression", () => {
  it("visits every phase once, in order, ending on the landing page", () => {
    openAllGates();
    introClock.start();
    introClock.gates.snapshot = true;
    const seen = run(INTRO_TIMES.end + 1);
    expect(seen).toEqual(["loading", "bookOpening", "sketching", "watercolor", "enteringWorld", "giftReveal", "worldFlythrough", "returningToLanding", "landingReady"]);
    expect(introClock.active).toBe(false);
  });

  it("switches phase exactly at each scheduled time (never early)", () => {
    openAllGates();
    introClock.start();
    introClock.gates.snapshot = true;
    const first = new Map<IntroPhase, number>();
    for (let i = 0; i < Math.ceil((INTRO_TIMES.end + 1) / DT); i++) {
      introClock.advance(DT);
      if (!first.has(introClock.phase)) first.set(introClock.phase, introClock.t);
    }
    const expected: [IntroPhase, number][] = [
      ["sketching", INTRO_TIMES.sketching],
      ["watercolor", INTRO_TIMES.watercolor],
      ["enteringWorld", INTRO_TIMES.enteringWorld],
      ["giftReveal", INTRO_TIMES.giftReveal],
      ["worldFlythrough", INTRO_TIMES.worldFlythrough],
      ["returningToLanding", INTRO_TIMES.returningToLanding],
    ];
    for (const [phase, at] of expected) {
      const t = first.get(phase)!;
      expect(t, phase).toBeGreaterThanOrEqual(at - 1e-9);
      expect(t, phase).toBeLessThan(at + DT * 1.5);
    }
  });

  it("time never goes backwards", () => {
    openAllGates();
    introClock.start();
    introClock.gates.snapshot = true;
    let last = -1;
    for (let i = 0; i < 1200; i++) {
      introClock.advance(DT * (1 + (i % 3)));
      expect(introClock.t).toBeGreaterThanOrEqual(last);
      last = introClock.t;
    }
  });

  it("survives one huge frame (returning to a throttled background tab) by landing cleanly", () => {
    openAllGates();
    introClock.start();
    introClock.gates.snapshot = true;
    introClock.advance(DT); // leaves "loading"; the clock itself only moves on later frames
    introClock.advance(60);
    expect(introClock.phase).toBe("landingReady");
    expect(introClock.active).toBe(false);
    expect(introClock.t).toBe(INTRO_TIMES.end);
  });
});

describe("watercolour snapshot gate", () => {
  function startAtSketching() {
    introClock.gates.world = true;
    introClock.gates.sketch = true;
    introClock.start();
    introClock.advance(DT);
  }

  it("never lets the watercolour phase begin without its snapshot", () => {
    startAtSketching();
    run(INTRO_TIMES.watercolor + 1.5);
    expect(introClock.phase).toBe("sketching");
    expect(introClock.t).toBeLessThan(INTRO_TIMES.watercolor);
  });

  it("resumes as soon as the snapshot is provided", () => {
    startAtSketching();
    run(INTRO_TIMES.watercolor + 1);
    introClock.gates.snapshot = true;
    run(0.5);
    expect(introClock.phase).toBe("watercolor");
  });

  it("gives up and lands on the page if the snapshot never arrives (~5s hold)", () => {
    startAtSketching();
    run(INTRO_TIMES.watercolor + 8);
    expect(introClock.phase).toBe("landingReady");
    expect(introClock.active).toBe(false);
  });

  it("a replay must re-take its snapshot (gate cleared by start())", () => {
    startAtSketching();
    introClock.gates.snapshot = true;
    introClock.finish();
    introClock.start();
    expect(introClock.gates.snapshot).toBe(false);
  });
});

describe("QA pause hook (?introAt=)", () => {
  it("freezes the clock at the requested time and holds the phase", () => {
    openAllGates();
    introClock.start();
    introClock.gates.snapshot = true;
    introClock.pauseAt = 3;
    run(10);
    expect(introClock.t).toBeCloseTo(3, 6);
    expect(introClock.phase).toBe("sketching");
    expect(introClock.active).toBe(true);
  });

  it("does not overshoot the pause point with a large frame", () => {
    openAllGates();
    introClock.start();
    introClock.gates.snapshot = true;
    introClock.pauseAt = 4.2;
    introClock.advance(DT); // leaves "loading"
    introClock.advance(30);
    expect(introClock.t).toBeCloseTo(4.2, 6);
  });

  it("resumes when the pause is cleared", () => {
    openAllGates();
    introClock.start();
    introClock.gates.snapshot = true;
    introClock.pauseAt = 3;
    run(5);
    introClock.pauseAt = null;
    run(1);
    expect(introClock.t).toBeGreaterThan(3.5);
  });
});

describe("subscriptions and invalidation", () => {
  it("notifies subscribers on phase changes only, and stops after unsubscribe", () => {
    openAllGates();
    let calls = 0;
    const off = introClock.subscribe(() => calls++);
    introClock.start();
    const afterStart = calls;
    expect(afterStart).toBeGreaterThan(0);
    introClock.gates.snapshot = true;
    introClock.advance(DT);
    introClock.advance(DT);
    introClock.advance(DT);
    expect(calls).toBe(afterStart + 1); // loading -> bookOpening once, not per frame
    off();
    introClock.finish();
    expect(calls).toBe(afterStart + 1);
  });

  it("invalidateSketch() clears the sketch gate and artefact (viewport resize)", () => {
    introClock.gates.sketch = true;
    introClock.sketch = { width: 1, height: 1, strokes: [], regions: [], gift: { x: 0, y: 0 } };
    introClock.invalidateSketch();
    expect(introClock.gates.sketch).toBe(false);
    expect(introClock.sketch).toBeNull();
  });
});

describe("smoothstep", () => {
  it("clamps to [0, 1], hits 0.5 at the midpoint, and is monotone", () => {
    expect(smoothstep(2, 4, 1)).toBe(0);
    expect(smoothstep(2, 4, 5)).toBe(1);
    expect(smoothstep(2, 4, 3)).toBeCloseTo(0.5, 10);
    let last = -1;
    for (let x = 0; x <= 6; x += 0.1) {
      const y = smoothstep(2, 4, x);
      expect(y).toBeGreaterThanOrEqual(last);
      last = y;
    }
  });
});
