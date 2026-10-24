import { describe, expect, it } from "vitest";
import { MOCK_QR_SIZE, mockQrModules } from "./mockQr";

describe("mockQrModules", () => {
  it("is a deterministic square grid", () => {
    const a = mockQrModules("Maya · Her 25th birthday");
    expect(a).toHaveLength(MOCK_QR_SIZE);
    expect(a.every((row) => row.length === MOCK_QR_SIZE)).toBe(true);
    expect(mockQrModules("Maya · Her 25th birthday")).toEqual(a);
  });

  it("draws the three finder patterns", () => {
    const g = mockQrModules("x");
    const n = MOCK_QR_SIZE;
    for (const [r0, c0] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ] as const) {
      expect(g[r0]![c0]).toBe(true); // outer ring
      expect(g[r0 + 1]![c0 + 1]).toBe(false); // light ring
      expect(g[r0 + 3]![c0 + 3]).toBe(true); // centre
    }
  });

  it("varies the data area with the seed", () => {
    expect(mockQrModules("a")).not.toEqual(mockQrModules("b"));
  });
});

import { inviteQrModules } from "./realQr";

describe("inviteQrModules", () => {
  it("encodes a real invite URL as a square, finder-marked grid", () => {
    const g = inviteQrModules("https://unwrap.example/join/6a7901ad5141a0e52db4e66cc6c0056d");
    expect(g.length).toBeGreaterThanOrEqual(21);
    expect(g.every((row) => row.length === g.length)).toBe(true);
    expect(g[0]![0] && g[3]![3] && !g[1]![1]).toBe(true);
  });
});
