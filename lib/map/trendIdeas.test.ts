import { describe, expect, it } from "vitest";
import { RING_RADII, ringDistance, ringPoint } from "./rings";
import { isTrendKey, layoutTrendIdeas, signalLabel } from "./trendIdeas";

const s = (query: string, signals = [{ kind: "top_search" as const, popularityIndex: 50 }]) => ({ query, sourceUrl: `https://trends.google.com/?q=${query}`, signals });

describe("trend sprouts", () => {
  it("labels signals as search interest without inventing numbers", () => {
    expect(signalLabel([{ kind: "breakout_search" }])).toBe("breakout search");
    expect(signalLabel([{ kind: "rising_search", growthPercent: 250 }])).toBe("searches +250%");
    expect(signalLabel([{ kind: "rising_search" }])).toBe("rising search");
    expect(signalLabel([{ kind: "top_search", popularityIndex: 80 }])).toBe("related search");
  });

  it("floats near the source memory, between the theme and gift rings", () => {
    const [x, z] = ringPoint(40, RING_RADII.input);
    const nodes = layoutTrendIdeas("job1", [s("a"), s("b"), s("c")], { x, z });
    expect(nodes.map((n) => n.query)).toEqual(["a", "b", "c"]);
    for (const n of nodes) {
      expect(isTrendKey(n.key)).toBe(true);
      const r = ringDistance(n.x, n.z);
      expect(r).toBeGreaterThan(RING_RADII.gift);
      expect(r).toBeLessThan(RING_RADII.theme + 0.5);
      const angle = (Math.atan2(n.z, n.x / 1.5) * 180) / Math.PI;
      expect(Math.abs(angle - 40)).toBeLessThan(20);
    }
  });

  it("keeps at most five, with keys unique per trend job", () => {
    const nodes = layoutTrendIdeas("job1", ["a", "b", "c", "d", "e", "f", "g"].map((q) => s(q)), null);
    expect(nodes.map((n) => n.query)).toEqual(["a", "b", "c", "d", "e"]);
    expect(layoutTrendIdeas("job2", [s("a")], null)[0]!.key).not.toBe(nodes[0]!.key);
  });
});
