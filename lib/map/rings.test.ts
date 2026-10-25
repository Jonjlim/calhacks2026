import { describe, expect, it } from "vitest";
import { BOX_DROP_RADIUS, GIFT_MIN_RADIUS, RING_RADII, RING_THEMES, dragResult, layoutRings, ringDistance, ringPoint, themeForKind } from "./rings";

const gift = (over: Partial<Parameters<typeof layoutRings>[1][number]> = {}) => ({ listingId: "l1", clueIds: [], score: 0.6, up: 0, down: 0, resting: false, ...over });

describe("ring layout", () => {
  it("groups clue kinds the same way as the room's jars", () => {
    expect(themeForKind("interest")).toBe("interest");
    expect(themeForKind("explicit_wish")).toBe("wish");
    for (const kind of ["ownership", "exclusion", "timing", "uncertain"]) expect(themeForKind(kind)).toBe("moment");
  });

  it("puts clues on the outer ring and only shows themes that have clues", () => {
    const layout = layoutRings([{ id: "a", kind: "interest" }, { id: "b", kind: "interest" }], []);
    expect(layout.themes).toEqual([expect.objectContaining({ id: "interest", count: 2 })]);
    for (const c of layout.clues) expect(ringDistance(c.x, c.z)).toBeCloseTo(RING_RADII.input, 5);
  });

  it("places a gift between the themes its recommendation cites", () => {
    const clues = [{ id: "a", kind: "interest" }, { id: "b", kind: "explicit_wish" }];
    const [both] = layoutRings(clues, [gift({ clueIds: ["a", "b"] })]).gifts;
    const [one] = layoutRings(clues, [gift({ clueIds: ["a"] })]).gifts;
    expect(both!.themes.sort()).toEqual(["interest", "wish"]);
    const angle = (Math.atan2(both!.z, both!.x / 1.5) * 180) / Math.PI;
    const between = ((RING_THEMES.interest.angle + RING_THEMES.wish.angle + 360) / 2) % 360 - 360;
    expect(angle).toBeCloseTo(between, 0);
    // Fitting two themes pulls it closer to the present than fitting one.
    expect(both!.radius).toBeLessThan(one!.radius);
  });

  it("moves gifts in with votes and out when resting, within the gift band", () => {
    const base = layoutRings([], [gift()]).gifts[0]!.radius;
    expect(layoutRings([], [gift({ up: 2 })]).gifts[0]!.radius).toBeLessThan(base);
    expect(layoutRings([], [gift({ down: 2 })]).gifts[0]!.radius).toBeGreaterThan(base);
    expect(layoutRings([], [gift({ resting: true })]).gifts[0]!.radius).toBeGreaterThan(base);
    expect(layoutRings([], [gift({ up: 99, score: 1 })]).gifts[0]!.radius).toBe(GIFT_MIN_RADIUS);
  });

  it("ignores clue ids the viewer cannot see", () => {
    const [g] = layoutRings([{ id: "a", kind: "interest" }], [gift({ clueIds: ["a", "hidden"] })]).gifts;
    expect(g!.themes).toEqual(["interest"]);
  });

  it("fans out gifts that share a direction", () => {
    const clues = [{ id: "a", kind: "interest" }];
    const [g1, g2] = layoutRings(clues, [gift({ listingId: "1", clueIds: ["a"] }), gift({ listingId: "2", clueIds: ["a"] })]).gifts;
    expect(Math.hypot(g1!.x - g2!.x, g1!.z - g2!.z)).toBeGreaterThan(2);
  });
});

describe("drag results", () => {
  const out = ringPoint(90, 12);
  it("treats a drop on the present as choosing a gift", () => {
    expect(dragResult("gift", out, ringPoint(90, BOX_DROP_RADIUS - 1))).toBe("box");
    expect(dragResult("clue", out, ringPoint(90, BOX_DROP_RADIUS - 1))).toBe("support");
  });
  it("reads moving inward as support and outward as a pass", () => {
    expect(dragResult("gift", out, ringPoint(90, 9.5))).toBe("support");
    expect(dragResult("gift", out, ringPoint(90, 15))).toBe("pass");
    expect(dragResult("gift", out, ringPoint(95, 12.3))).toBeNull();
  });
});

describe("zones", () => {
  it("splits the map halfway between rings", async () => {
    const { zoneAt, ringPoint: at, RING_RADII: R } = await import("./rings");
    expect(zoneAt(...at(40, 2))).toBe("box");
    expect(zoneAt(...at(40, R.gift))).toBe("gift");
    expect(zoneAt(...at(40, R.theme))).toBe("theme");
    expect(zoneAt(...at(40, R.input))).toBe("outer");
    expect(zoneAt(...at(40, R.input + 9))).toBe("outer");
  });
});
