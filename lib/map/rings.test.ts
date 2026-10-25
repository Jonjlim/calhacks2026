import { describe, expect, it } from "vitest";
import { BOX_DROP_RADIUS, GIFT_MIN_RADIUS, RING_RADII, UNGROUPED, dragResult, layoutRings, ringDistance, ringPoint, themeForKind } from "./rings";

const gift = (over: Partial<Parameters<typeof layoutRings>[1][number]> = {}) => ({ listingId: "l1", clueIds: [], score: 0.6, up: 0, down: 0, resting: false, ...over });

describe("ring layout", () => {
  it("groups clue kinds the same way as the room's jars", () => {
    expect(themeForKind("interest")).toBe("interest");
    expect(themeForKind("explicit_wish")).toBe("wish");
    for (const kind of ["ownership", "exclusion", "timing", "uncertain"]) expect(themeForKind(kind)).toBe("moment");
  });

  it("keeps every clue in place when another one arrives", () => {
    const two = layoutRings([{ id: "a", kind: "interest" }, { id: "b", kind: "interest" }], []).clues;
    const three = layoutRings([{ id: "a", kind: "interest" }, { id: "b", kind: "interest" }, { id: "c", kind: "interest" }], []).clues;
    expect(three.slice(0, 2)).toEqual(two);
  });

  it("shows memories on their own around the outer ring until the council groups them", () => {
    const layout = layoutRings([{ id: "a", kind: "interest" }, { id: "b", kind: "explicit_wish" }, { id: "c", kind: "timing" }], []);
    expect(layout.themes).toEqual([]);
    expect(layout.clues.every((c) => c.theme === UNGROUPED)).toBe(true);
    for (const c of layout.clues) expect(ringDistance(c.x, c.z)).toBeGreaterThan(RING_RADII.input - 1);
    // No two floating memories share a seat.
    const seats = new Set(layout.clues.map((c) => `${c.x.toFixed(1)},${c.z.toFixed(1)}`));
    expect(seats.size).toBe(3);
  });

  it("places a gift between the themes its recommendation cites", () => {
    const clues = [{ id: "a", kind: "interest" }, { id: "b", kind: "explicit_wish" }];
    const themes = [{ id: "t1", label: "Loves the outdoors", clueIds: ["a"] }, { id: "t2", label: "Retro style", clueIds: ["b"] }];
    const [both] = layoutRings(clues, [gift({ clueIds: ["a", "b"] })], { themes }).gifts;
    const [one] = layoutRings(clues, [gift({ clueIds: ["a"] })], { themes }).gifts;
    expect(both!.themes.sort()).toEqual(["t1", "t2"]);
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
    const [g] = layoutRings([{ id: "a", kind: "interest" }], [gift({ clueIds: ["a", "hidden"] })], { themes: [{ id: "t1", label: "Hikes", clueIds: ["a", "hidden"] }] }).gifts;
    expect(g!.themes).toEqual(["t1"]);
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

describe("council themes, signals and sharpen", () => {
  const clues = [{ id: "a", kind: "interest" }, { id: "b", kind: "interest" }, { id: "c", kind: "timing" }];
  it("groups by council themes and lets a memory no theme holds yet float on its own", async () => {
    const { layoutRings: lay } = await import("./rings");
    const out = lay(clues, [], { themes: [{ id: "t1", label: "Makes things", clueIds: ["a", "b", "zz"] }] });
    expect(out.themes.map((t) => [t.id, t.count])).toEqual([["t1", 2]]);
    expect(out.clues.find((c) => c.id === "c")?.theme).toBe(UNGROUPED);
  });
  it("pulls signalled clues and themes inward, and their gifts with them", async () => {
    const { layoutRings: lay, ringDistance: dist } = await import("./rings");
    const themes = [{ id: "t1", label: "Makes things", clueIds: ["a", "b"] }];
    const base = lay(clues, [gift({ clueIds: ["a"] })], { themes });
    const pulled = lay(clues, [gift({ clueIds: ["a"] })], { themes, signals: { clue: { a: 2 }, theme: { t1: 2 } } });
    const r = (l: typeof base, id: string) => { const c = l.clues.find((x) => x.id === id)!; return dist(c.x, c.z); };
    expect(r(pulled, "a")).toBeLessThan(r(base, "a"));
    expect(pulled.gifts[0]!.radius).toBeLessThan(base.gifts[0]!.radius);
  });
  it("fades non-finalists and brings the favoured gift close", async () => {
    const { layoutRings: lay, GIFT_MIN_RADIUS: min } = await import("./rings");
    const out = lay([], [gift({ listingId: "1", faded: true }), gift({ listingId: "2", favored: true }), gift({ listingId: "3" })]);
    expect(out.gifts[0]!.radius).toBeGreaterThan(out.gifts[2]!.radius);
    expect(out.gifts[1]!.radius).toBe(min);
  });
});
