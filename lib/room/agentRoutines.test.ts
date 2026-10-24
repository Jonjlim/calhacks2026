import { describe, expect, it } from "vitest";
import { COUNCIL_ACTORS } from "@/lib/council/contracts";
import { sampleRoutine, stationFor } from "@/components/world/room/agentRoutines";

describe("room agent routes", () => {
  it("keeps every route out of the table, wall furniture and the player's front spot", () => {
    const obstacles = [[-3.15, -1.55, .65], [2.3, -2, .52], [-2.14, -2.44, .55], [2.14, -2.44, .55]];
    for (const actor of COUNCIL_ACTORS) for (let time = 0; time < 180; time += .1) {
      const p = sampleRoutine(actor, time);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(1.7);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(3);
      expect(Math.hypot(p.x, p.z - 2.1)).toBeGreaterThan(1);
      for (const [x, z, radius] of obstacles) expect(Math.hypot(p.x - x!, p.z - z!)).toBeGreaterThan(radius!);
    }
  });
  it("has continuous movement, real stops and separate lanes for passing agents", () => {
    for (const actor of COUNCIL_ACTORS) {
      const moving = new Set<boolean>();
      for (let time = 0; time < 90; time += .05) {
        const p = sampleRoutine(actor, time), next = sampleRoutine(actor, time + .05);
        expect(Math.hypot(next.x - p.x, next.z - p.z)).toBeLessThan(.04);
        moving.add(p.moving);
      }
      expect(moving).toEqual(new Set([true, false]));
      expect(stationFor(actor).clip).toBeTruthy();
    }
    for (let time = 0; time < 120; time += .2) for (let i = 0; i < COUNCIL_ACTORS.length; i++) for (let j = i + 1; j < COUNCIL_ACTORS.length; j++) {
      const a = sampleRoutine(COUNCIL_ACTORS[i]!, time), b = sampleRoutine(COUNCIL_ACTORS[j]!, time);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(.5);
    }
  });
});
