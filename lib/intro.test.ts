import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { introClock, INTRO_TIMES } from "@/components/intro/introTimeline";

describe("introduction skipping", () => {
  beforeEach(() => {
    introClock.finish();
    introClock.pauseAt = null;
    introClock.gates = { world: false, sketch: false, snapshot: false };
    introClock.start();
  });
  afterEach(() => {
    introClock.pauseAt = null;
    introClock.finish();
  });

  it.each(["loading", "playing", "snapshot_gate", "qa_pause"])("lands immediately from %s and stays finished", (stage) => {
    if (stage !== "loading") {
      introClock.gates.world = introClock.gates.sketch = true;
      introClock.advance(0);
      if (stage === "snapshot_gate") for (let i = 0; i < 120; i++) introClock.advance(0.05);
      if (stage === "qa_pause") {
        introClock.pauseAt = 1;
        introClock.advance(2);
      }
    }
    const changes: string[] = [];
    const unsubscribe = introClock.subscribe(() => changes.push(introClock.phase));
    introClock.finish();
    expect(introClock.phase).toBe("landingReady");
    expect(introClock.active).toBe(false);
    expect(changes).toContain("landingReady");
    introClock.advance(5);
    expect(introClock.phase).toBe("landingReady");
    expect(introClock.t).toBe(INTRO_TIMES.end);
    unsubscribe();
  });

  it("waits for loading and finishes once the full sequence has played", () => {
    introClock.advance(10.1);
    expect(introClock.phase).toBe("loading");
    expect(introClock.active).toBe(true);
    introClock.gates.world = introClock.gates.sketch = true;
    introClock.advance(0);
    introClock.gates.snapshot = true;
    introClock.advance(INTRO_TIMES.end + 0.01);
    expect(introClock.phase).toBe("landingReady");
  });
});
