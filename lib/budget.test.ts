import { describe, expect, it } from "vitest";
import { softBudget, validRange } from "./budget";

describe("soft budget", () => {
  it("is the lowest maximum times the friends, and the mean minimum", () => {
    const b = softBudget([{ minMinor: 2000, maxMinor: 6000 }, { minMinor: 4000, maxMinor: 9000 }, { minMinor: 3000, maxMinor: 5000 }], 3);
    expect(b).toEqual({ minMinor: 3000, maxMinor: 15_000, count: 3 });
  });

  it("counts everyone in the room even if some have not answered yet", () => {
    expect(softBudget([{ minMinor: 1000, maxMinor: 4000 }], 4)).toMatchObject({ maxMinor: 16_000, minMinor: 1000, count: 1 });
  });

  it("is nothing until someone answers, and ignores bad ranges", () => {
    expect(softBudget([], 3)).toBeNull();
    expect(softBudget([{ minMinor: 500, maxMinor: 100 }], 3)).toBeNull();
    expect(validRange({ minMinor: 0, maxMinor: 100 })).toBe(true);
    expect(validRange({ minMinor: 0, maxMinor: 0 })).toBe(false);
  });
});
