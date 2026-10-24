import { describe, expect, it } from "vitest";
import { allocate, sharesEqual } from "./allocations";

const people = (...limits: number[]) =>
  limits.map((limitMinor, i) => ({ participantId: `p${i}`, limitMinor }));

function amounts(result: ReturnType<typeof allocate>): number[] {
  if (!result.feasible) throw new Error(`expected feasible, got ${result.reason}`);
  return result.shares.map((s) => s.amountMinor);
}

describe("allocate", () => {
  it("splits evenly when everyone has room", () => {
    expect(amounts(allocate({ payableTotalMinor: 9000, participants: people(5000, 5000, 5000) }))).toEqual([
      3000, 3000, 3000,
    ]);
  });

  it("gives leftover cents to the organizer first, then join order", () => {
    expect(amounts(allocate({ payableTotalMinor: 1000, participants: people(1000, 1000, 1000) }))).toEqual([
      334, 333, 333,
    ]);
    expect(amounts(allocate({ payableTotalMinor: 1001, participants: people(1000, 1000, 1000) }))).toEqual([
      334, 334, 333,
    ]);
  });

  it("redistributes past a low cap to people with capacity", () => {
    expect(amounts(allocate({ payableTotalMinor: 9000, participants: people(6000, 1500, 6000) }))).toEqual([
      3750, 1500, 3750,
    ]);
  });

  it("skips a participant whose cap is 0", () => {
    expect(amounts(allocate({ payableTotalMinor: 5000, participants: people(5000, 0) }))).toEqual([5000, 0]);
  });

  it("handles a solo buyer", () => {
    expect(amounts(allocate({ payableTotalMinor: 4299, participants: people(5000) }))).toEqual([4299]);
  });

  it("fills caps exactly when total equals total capacity", () => {
    expect(amounts(allocate({ payableTotalMinor: 7001, participants: people(1, 5000, 2000) }))).toEqual([
      1, 5000, 2000,
    ]);
  });

  it("is infeasible when caps cannot cover the total", () => {
    expect(allocate({ payableTotalMinor: 10_000, participants: people(3000, 3000) })).toEqual({
      feasible: false,
      reason: "caps_insufficient",
    });
  });

  it("rejects invalid input", () => {
    const invalid = { feasible: false, reason: "invalid_input" };
    expect(allocate({ payableTotalMinor: 0, participants: people(100) })).toEqual(invalid);
    expect(allocate({ payableTotalMinor: -5, participants: people(100) })).toEqual(invalid);
    expect(allocate({ payableTotalMinor: 10.5, participants: people(100) })).toEqual(invalid);
    expect(allocate({ payableTotalMinor: 100, participants: [] })).toEqual(invalid);
    expect(allocate({ payableTotalMinor: 100, participants: people(-1, 200) })).toEqual(invalid);
    expect(
      allocate({
        payableTotalMinor: 100,
        participants: [
          { participantId: "a", limitMinor: 100 },
          { participantId: "a", limitMinor: 100 },
        ],
      }),
    ).toEqual(invalid);
  });

  it("always sums exactly and respects caps (randomized)", () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % max;
    };
    for (let run = 0; run < 500; run++) {
      const limits = Array.from({ length: 1 + rand(6) }, () => rand(20_000));
      const capacity = limits.reduce((a, b) => a + b, 0);
      const total = 1 + rand(25_000);
      const result = allocate({ payableTotalMinor: total, participants: people(...limits) });
      if (capacity < total) {
        expect(result.feasible).toBe(false);
        continue;
      }
      const got = amounts(result);
      expect(got.reduce((a, b) => a + b, 0)).toBe(total);
      got.forEach((amount, i) => {
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(amount).toBeLessThanOrEqual(limits[i]!);
      });
    }
  });
});

describe("sharesEqual", () => {
  it("compares participant and amount in order", () => {
    const a = [{ participantId: "x", amountMinor: 1 }];
    expect(sharesEqual(a, [{ participantId: "x", amountMinor: 1 }])).toBe(true);
    expect(sharesEqual(a, [{ participantId: "x", amountMinor: 2 }])).toBe(false);
    expect(sharesEqual(a, [{ participantId: "y", amountMinor: 1 }])).toBe(false);
    expect(sharesEqual(a, [])).toBe(false);
  });
});
