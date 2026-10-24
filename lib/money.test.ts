import { describe, expect, it } from "vitest";
import { formatMinor, isValidMinor, parseMajorToMinor, sumMinor } from "./money";

describe("money", () => {
  it("rejects negative and fractional minor amounts", () => {
    expect(isValidMinor(-1)).toBe(false);
    expect(isValidMinor(1.5)).toBe(false);
    expect(isValidMinor(0)).toBe(true);
  });

  it("parses major-unit strings to cents", () => {
    expect(parseMajorToMinor("25")).toBe(2500);
    expect(parseMajorToMinor("$25.5")).toBe(2550);
    expect(parseMajorToMinor("25.05")).toBe(2505);
    expect(parseMajorToMinor("-3")).toBeNull();
    expect(parseMajorToMinor("abc")).toBeNull();
  });

  it("formats and sums", () => {
    expect(formatMinor(2550)).toBe("$25.50");
    expect(sumMinor([100, 250])).toBe(350);
  });
});
