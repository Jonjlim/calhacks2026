import { describe, expect, it } from "vitest";
import { matchThemes } from "./themeMatching";

const old = [
  { id: "t_out", label: "Loves the outdoors", clueIds: ["hike", "camp", "trail"] },
  { id: "t_tea", label: "Matcha mornings", clueIds: ["matcha", "tea"] },
];

describe("keeping themes steady through a regroup", () => {
  it("keeps a theme's id when it keeps most of its memories, even with a sharper label", () => {
    const plan = matchThemes(old, [
      { label: "Trail days outdoors", clueIds: ["hike", "camp", "trail", "kayak"] },
      { label: "Matcha mornings", clueIds: ["matcha", "tea"] },
    ]);
    expect(plan.keep).toEqual([
      { id: "t_tea", label: "Matcha mornings", clueIds: ["matcha", "tea"] },
      { id: "t_out", label: "Trail days outdoors", clueIds: ["hike", "camp", "trail", "kayak"] },
    ]);
    expect(plan.add).toEqual([]);
    expect(plan.drop).toEqual([]);
    expect(plan.changed).toBe(true);
  });

  it("reports nothing changed when the grouping is the same", () => {
    const plan = matchThemes(old, old.map(({ label, clueIds }) => ({ label, clueIds })));
    expect(plan.changed).toBe(false);
  });

  it("adds new themes and drops ones whose memories went elsewhere", () => {
    const plan = matchThemes(old, [
      { label: "Loves the outdoors", clueIds: ["hike", "camp"] },
      { label: "Board game nights", clueIds: ["catan", "chess"] },
    ]);
    expect(plan.keep.map((k) => k.id)).toEqual(["t_out"]);
    expect(plan.add.map((a) => a.label)).toEqual(["Board game nights"]);
    expect(plan.drop).toEqual(["t_tea"]);
  });

  it("never lets one old theme claim two new ones", () => {
    const plan = matchThemes([{ id: "t", label: "Outdoors", clueIds: ["a", "b", "c", "d"] }], [
      { label: "Hiking", clueIds: ["a", "b"] }, { label: "Camping", clueIds: ["c", "d"] },
    ]);
    expect(plan.keep).toHaveLength(1);
    expect(plan.add).toHaveLength(1);
  });
});
