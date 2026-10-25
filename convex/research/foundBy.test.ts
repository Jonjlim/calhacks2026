import { describe, expect, it } from "vitest";
import { searchOrigin, withSearchNote } from "./foundBy";

const hiking = { id: "c_hike", text: "we hiked mt hood", status: "active" as const };
const matcha = { id: "c_matcha", text: "matcha drinker", status: "active" as const };

describe("which search found a listing", () => {
  it("names the memory whose search phrase was used", () => {
    expect(searchOrigin({ query: "hiking", clues: [matcha, hiking], poolClueIds: ["c_hike", "c_matcha"] }))
      .toEqual({ query: "hiking", source: "memory", publishedClueId: "c_hike" });
  });

  it("credits the memory inside a query the buyer agent wrote around it", () => {
    const tennis = { id: "c_tennis", text: "tennis", status: "active" as const };
    expect(searchOrigin({ query: "hiking gifts", clues: [tennis, hiking], poolClueIds: ["c_tennis", "c_hike"] }))
      .toEqual({ query: "hiking gifts", source: "memory", publishedClueId: "c_hike" });
    expect(searchOrigin({ query: "trail gifts", clues: [tennis, hiking], poolClueIds: ["c_tennis", "c_hike"] }))
      .toEqual({ query: "trail gifts", source: "discovery" });
  });

  it("credits the trend's memory for a chosen trend search", () => {
    expect(searchOrigin({ query: "matcha whisk set", clues: [matcha], poolClueIds: ["c_matcha"], trendClueId: "c_matcha" }))
      .toEqual({ query: "matcha whisk set", source: "trend", publishedClueId: "c_matcha" });
  });

  it("names no memory once it is withdrawn, or when no memory produced the query", () => {
    expect(searchOrigin({ query: "hiking", clues: [{ ...hiking, status: "withdrawn" }], poolClueIds: ["c_hike"] }))
      .toEqual({ query: "hiking", source: "discovery" });
    expect(searchOrigin({ query: "denim jacket", clues: [hiking], poolClueIds: ["c_hike"] }))
      .toEqual({ query: "denim jacket", source: "discovery" });
    expect(searchOrigin({ query: "hiking", clues: [hiking], poolClueIds: [] }))
      .toEqual({ query: "hiking", source: "discovery" });
    expect(searchOrigin({ query: " ", clues: [hiking], poolClueIds: ["c_hike"] })).toBeUndefined();
  });
});

describe("explaining an unmatched find", () => {
  const origin = { query: "hiking", source: "memory" as const, publishedClueId: "c_hike" };

  it("adds how it was found, keeping the honest no-match wording", () => {
    expect(withSearchNote("No published clue matches this directly", [], origin, [hiking]))
      .toBe("Found by searching “hiking” from “we hiked mt hood”. No published clue matches this directly");
  });

  it("leaves matched listings and trend finds alone", () => {
    expect(withSearchNote("Matches: \"Loves hiking\"", ["c_hike"], origin, [hiking])).toBe("Matches: \"Loves hiking\"");
    expect(withSearchNote("No published clue matches this directly", [], { ...origin, source: "trend" }, [hiking]))
      .toBe("No published clue matches this directly");
  });
});
