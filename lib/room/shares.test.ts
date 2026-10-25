import { describe, expect, it } from "vitest";
import { equalSplit, summarizeShares } from "./shares";

describe("equal split", () => {
  it("always adds back to the total, with leftover cents to the first people", () => {
    const parts = equalSplit(10_000, ["a", "b", "c"]);
    expect(parts.map((p) => p.amountMinor)).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((n, p) => n + p.amountMinor, 0)).toBe(10_000);
  });

  it("splits evenly when it can", () => {
    expect(equalSplit(9_500, ["a", "b"]).map((p) => p.amountMinor)).toEqual([4750, 4750]);
  });

  it("handles one person, no people and bad totals", () => {
    expect(equalSplit(500, ["a"])).toEqual([{ participantId: "a", amountMinor: 500 }]);
    expect(equalSplit(500, [])).toEqual([]);
    expect(equalSplit(-1, ["a"])).toEqual([]);
  });

  for (const n of [2, 3, 4, 5, 7]) {
    it(`never loses a cent between ${n} people`, () => {
      for (const total of [1, 99, 1001, 12_345, 99_999]) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        expect(equalSplit(total, ids).reduce((s, p) => s + p.amountMinor, 0)).toBe(total);
      }
    });
  }
});

describe("summarizing shares", () => {
  it("recognises an equal split and an exact sum", () => {
    const s = summarizeShares(10_000, equalSplit(10_000, ["a", "b", "c"]));
    expect(s).toMatchObject({ adds: true, isEqual: true, sumMinor: 10_000 });
  });

  it("shows who covers more when a limit binds", () => {
    const s = summarizeShares(10_000, [{ participantId: "a", amountMinor: 2000 }, { participantId: "b", amountMinor: 8000 }]);
    expect(s.isEqual).toBe(false);
    expect(s.adds).toBe(true);
    expect(s.deltas).toEqual({ a: -3000, b: 3000 });
  });

  it("notices when shares do not add up", () => {
    expect(summarizeShares(10_000, [{ participantId: "a", amountMinor: 4000 }, { participantId: "b", amountMinor: 5000 }]).adds).toBe(false);
  });
});
