import { describe, expect, it } from "vitest";
import { buildArtifacts, filledAt, MAX_ARTIFACTS, symbolFor, type ArtifactInput } from "./artifacts";
import { CONVERGENCE_TIMES, giftChoreography, stateAt } from "./timeline";

const input = (n: number, source: ArtifactInput["source"] = "memory", text = "likes things"): ArtifactInput[] =>
  Array.from({ length: n }, (_, i) => ({ key: `clue:${i}`, source, text, x: 6 + i, z: -4 - i }));

describe("buildArtifacts", () => {
  it("creates nothing from nothing", () => {
    expect(buildArtifacts([])).toEqual({ artifacts: [], total: 0 });
    expect(filledAt([], 1)).toBe(1);
  });

  it("is deterministic", () => {
    const a = buildArtifacts([...input(5), ...input(3, "wish")]);
    const b = buildArtifacts([...input(5), ...input(3, "wish")]);
    expect(a).toEqual(b);
  });

  it("gathers in waves: memories, then wishes, then ideas and gifts", () => {
    const { artifacts } = buildArtifacts([...input(3, "idea"), ...input(3, "memory"), ...input(3, "wish")]);
    const first = (wave: number) => Math.min(...artifacts.filter((x) => x.wave === wave).map((x) => x.arrive));
    expect(first(1)).toBeLessThan(first(2));
    expect(first(2)).toBeLessThan(first(3));
  });

  it("every artifact lifts off before it lands, and lands before the box closes", () => {
    const { artifacts } = buildArtifacts([...input(12), ...input(6, "wish"), ...input(6, "idea")]);
    for (const a of artifacts) {
      expect(a.start).toBeLessThan(a.arrive);
      expect(a.arrive).toBeLessThanOrEqual(CONVERGENCE_TIMES.gather[1]);
      expect(a.arrive).toBeLessThan(CONVERGENCE_TIMES.wallsClose[0]);
    }
  });

  it("caps what is drawn but keeps supporting memories and reports the true total", () => {
    const many = input(60);
    many[59] = { ...many[59]!, supports: true };
    const { artifacts, total } = buildArtifacts(many);
    expect(total).toBe(60);
    expect(artifacts).toHaveLength(MAX_ARTIFACTS);
    expect(artifacts.some((a) => a.key === "clue:59")).toBe(true);
  });

  it("maps clues to symbolic objects and falls back to a folded note", () => {
    expect(symbolFor("loves pottery", "memory")).toBe("charm");
    expect(symbolFor("always painting", "memory")).toBe("brush");
    expect(symbolFor("a trip to Lisbon", "memory")).toBe("note");
    expect(symbolFor("anything", "wish")).toBe("letter");
    expect(symbolFor("a wheel-throwing class", "idea")).toBe("tag");
  });

  it("fills the box as artifacts land", () => {
    const { artifacts } = buildArtifacts(input(4));
    expect(filledAt(artifacts, 0)).toBe(0);
    expect(filledAt(artifacts, CONVERGENCE_TIMES.gather[1])).toBe(1);
  });
});

describe("giftChoreography", () => {
  it("starts and ends as a closed, wrapped present", () => {
    const start = giftChoreography(0, 0);
    expect(start.hollow).toBe(false);
    expect(start.ribbon).toEqual({ bandX: 1, bandZ: 1, tails: 1, bow: 1 });
    const closed = giftChoreography(CONVERGENCE_TIMES.wrap[1], 1);
    expect(closed.wall.every((w) => w === 0)).toBe(true);
    expect(closed.lid).toBe(0);
    expect(closed.ribbon.bandX).toBe(1);
    expect(closed.ribbon.bow).toBeCloseTo(1, 5);
  });

  it("is fully open with the ribbon off while artifacts arrive", () => {
    const mid = giftChoreography(2.5, 0.5);
    expect(mid.hollow).toBe(true);
    expect(mid.wall.every((w) => w > 0.9)).toBe(true);
    expect(mid.ribbon.bandX).toBe(0);
    expect(mid.ribbon.bow).toBe(0);
    expect(mid.lid).toBeGreaterThan(0.9);
  });

  it("rises, shakes harder as it charges, and is gone after the burst", () => {
    const early = giftChoreography(7.3, 1);
    const late = giftChoreography(8.9, 1);
    expect(late.lift).toBeGreaterThan(0.2);
    expect(late.charge).toBeGreaterThan(early.charge);
    const amp = (t: number) => Math.max(...Array.from({ length: 60 }, (_, i) => Math.abs(giftChoreography(t + i / 120, 1).shakeX)));
    expect(amp(8.5)).toBeGreaterThan(amp(7.1));
    expect(giftChoreography(CONVERGENCE_TIMES.end, 1).presence).toBe(0);
    expect(giftChoreography(CONVERGENCE_TIMES.burst[0] + 0.1, 1).presence).toBeGreaterThanOrEqual(1);
  });

  it("walks through the story in order", () => {
    const order = [0.1, 1, 3.2, 3.6, 4.4, 5.5, 6.6, 8, 9.1, 10, 11].map(stateAt);
    expect(order[0]).toBe("anticipation");
    expect(order.at(-1)).toBe("complete");
    expect(new Set(order).size).toBeGreaterThanOrEqual(8);
  });
});
