import { beforeEach, describe, expect, it } from "vitest";
import { CONVERGENCE_TIMES, EXIT_TIME } from "@/lib/convergence/timeline";
import { convergence } from "@/components/convergence/convergenceClock";

const start = (instant = false) => convergence.start({ selectionId: "sel_1", inputs: [], total: 0, instant });

describe("convergence clock", () => {
  beforeEach(() => convergence.abort());

  it("ignores a second start while one is running (no overlapping runs)", () => {
    expect(start()).toBe(true);
    const run = convergence.run;
    expect(start()).toBe(false);
    expect(convergence.run).toBe(run);
  });

  it("plays to the end, then holds the reveal", () => {
    start();
    for (let i = 0; i < 400; i++) convergence.advance(0.05);
    expect(convergence.t).toBe(CONVERGENCE_TIMES.end);
    expect(convergence.holding).toBe(true);
    expect(convergence.state).toBe("complete");
  });

  it("skip fast-forwards to the reveal, never past a stopped state", () => {
    start();
    convergence.advance(0.05);
    convergence.skip();
    let steps = 0;
    while (convergence.t < CONVERGENCE_TIMES.reveal[0] && steps++ < 200) convergence.advance(0.05);
    expect(steps).toBeLessThan(80);
    expect(convergence.t).toBeGreaterThanOrEqual(CONVERGENCE_TIMES.reveal[0]);
  });

  it("instant (reduced motion) opens straight onto the reveal", () => {
    start(true);
    expect(convergence.state).toBe("complete");
    expect(convergence.holding).toBe(true);
  });

  it("closing glides the camera home, then releases everything", () => {
    start(true);
    convergence.close();
    expect(convergence.leaving).toBe(true);
    for (let i = 0; i < 80; i++) convergence.advance(0.05);
    expect(convergence.active).toBe(false);
    expect(EXIT_TIME).toBeGreaterThan(0);
  });

  it("abort drops the reveal at once and allows a clean replay", () => {
    start();
    convergence.advance(0.5);
    convergence.abort();
    expect(convergence.active).toBe(false);
    expect(start()).toBe(true);
    expect(convergence.t).toBe(0);
  });
});
