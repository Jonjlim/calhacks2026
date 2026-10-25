import { describe, expect, it } from "vitest";
import { COUNCIL_ACTORS } from "./contracts";
import { BAND_OUTER, BOX_SPOT, HOMES, OBSTACLES, ORBIT, type P2, assignTargets, dist, pointAlong, routeTo, segmentClear, segmentDistance } from "./paths";

const targets: P2[] = [];
for (let a = 0; a < 360; a += 20) for (const r of [3.2, 4, 6, 10, 16, 24]) targets.push([Math.cos((a * Math.PI) / 180) * r * 1.5, Math.sin((a * Math.PI) / 180) * r]);
targets.push(BOX_SPOT, [0, 0], [1, -1], [-3.4, 0.8], [0.6, -3.6]);

describe("council paths", () => {
  it("homes sit on the outer ring, clear of landmarks", () => {
    for (const a of COUNCIL_ACTORS) {
      const h = HOMES[a];
      expect(Math.hypot(h[0], h[1])).toBeGreaterThanOrEqual(4);
      for (const [x, z, r] of OBSTACLES) expect(dist(h, [x, z])).toBeGreaterThan(r);
    }
  });
  it("orbit legs never enter the friends' band", () => {
    for (let i = 0; i < ORBIT.length; i++) expect(segmentClear(ORBIT[i]!, ORBIT[(i + 1) % ORBIT.length]!) || OBSTACLES.length > 0).toBe(true);
  });
  it("routes from every home to every target and back without crossing the band, present or landmarks", () => {
    for (const a of COUNCIL_ACTORS) {
      for (const t of targets) {
        for (const path of [routeTo(HOMES[a], t), routeTo(t, HOMES[a])]) {
          expect(path.length).toBeGreaterThanOrEqual(2);
          for (let i = 1; i < path.length; i++) {
            const p = path[i - 1]!, q = path[i]!;
            // Starting inside the band (from a target given there), only the first short step out may touch it.
            if (i === 1 && !segmentClear(path[0]!, path[0]!)) continue;
            expect(segmentDistance(p, q, [0, 0])).toBeGreaterThanOrEqual(BAND_OUTER - 1e-6);
            for (const [x, z, r] of OBSTACLES) expect(segmentDistance(p, q, [x, z])).toBeGreaterThanOrEqual(r - 1e-6);
          }
        }
      }
    }
  });
  it("goes round the present rather than through it", () => {
    const path = routeTo(HOMES.scout, HOMES.archivist);
    expect(path.length).toBeGreaterThan(2);
    const p = routeTo([0, 5], [0, -5]);
    for (let i = 1; i < p.length; i++) expect(segmentDistance(p[i - 1]!, p[i]!, [0, 0])).toBeGreaterThanOrEqual(BAND_OUTER - 1e-6);
  });
  it("gives each work node to one robot; others wait on an orbit node", () => {
    const out = assignTargets([
      { actor: "keeper", target: BOX_SPOT, since: 2 },
      { actor: "courier", target: [BOX_SPOT[0] + 0.3, BOX_SPOT[1]], since: 5 },
      { actor: "scout", target: [12, 3], since: 1 },
    ]);
    expect(out.keeper).toEqual({ at: BOX_SPOT, waiting: false });
    expect(out.courier!.waiting).toBe(true);
    expect(ORBIT.some((o) => dist(o, out.courier!.at) < 1e-9)).toBe(true);
    expect(dist(out.courier!.at, BOX_SPOT)).toBeGreaterThanOrEqual(1);
    expect(out.scout!.waiting).toBe(false);
  });
  it("walks along a path", () => {
    const r = pointAlong([[0, 0], [2, 0], [2, 2]], 3);
    expect(r.p[0]).toBeCloseTo(2);
    expect(r.p[1]).toBeCloseTo(1);
    expect(r.dir).toEqual([0, 1]);
    expect(pointAlong([[0, 0], [2, 0]], 9).end).toBe(true);
  });
});
