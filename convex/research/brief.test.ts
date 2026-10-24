import { describe, expect, it } from "vitest";
import { buildSearchBrief } from "./brief";
import { FIXTURE_ROOM_ID, cluesAfterOwnership, clueLikesPottery } from "./fixtures";
import { cluePhrase, contentTokens } from "./text";

describe("buildSearchBrief", () => {
  it("turns the Maya clues into query terms and exclusions", () => {
    const brief = buildSearchBrief({
      roomId: FIXTURE_ROOM_ID,
      knowledgeRevision: 3,
      clues: cluesAfterOwnership,
      budgetMinor: 12_000,
      occasion: "birthday",
    });
    expect(brief).toEqual({
      roomId: FIXTURE_ROOM_ID,
      knowledgeRevision: 3,
      queryTerms: ["wheel-throwing class", "pottery"],
      mustExclude: ["pottery starter kit"],
      budgetMinor: 12_000,
      occasion: "birthday",
      listingLimit: 12,
    });
  });

  it("skips withdrawn clues and returns no terms when nothing is searchable", () => {
    const brief = buildSearchBrief({
      roomId: FIXTURE_ROOM_ID,
      knowledgeRevision: 1,
      clues: [{ ...clueLikesPottery, status: "withdrawn" }],
    });
    expect(brief.queryTerms).toEqual([]);
    expect(brief).not.toHaveProperty("budgetMinor");
  });

  it("ignores timing and uncertain clues", () => {
    const brief = buildSearchBrief({
      roomId: FIXTURE_ROOM_ID,
      knowledgeRevision: 1,
      clues: [
        { id: "t", kind: "timing", text: "Birthday is in November", status: "active" },
        { id: "u", kind: "uncertain", text: "Might like hiking", status: "active" },
      ],
    });
    expect(brief.queryTerms).toEqual([]);
    expect(brief.mustExclude).toEqual([]);
  });

  it("dedupes phrases and caps query terms at three", () => {
    const clues = ["Likes pottery", "Loves pottery", "Into hiking", "Likes jazz", "Likes tea"].map(
      (text, i) => ({ id: `c${i}`, kind: "interest" as const, text, status: "active" as const }),
    );
    const brief = buildSearchBrief({ roomId: FIXTURE_ROOM_ID, knowledgeRevision: 1, clues });
    expect(brief.queryTerms).toEqual(["pottery", "hiking", "jazz"]);
  });

  it("clamps the listing limit", () => {
    const base = { roomId: FIXTURE_ROOM_ID, knowledgeRevision: 1, clues: [] };
    expect(buildSearchBrief({ ...base, listingLimit: 500 }).listingLimit).toBe(24);
    expect(buildSearchBrief({ ...base, listingLimit: 0 }).listingLimit).toBe(1);
  });
});

describe("text helpers", () => {
  it("strips clue framing", () => {
    expect(cluePhrase("Already owns a pottery starter kit.")).toBe("pottery starter kit");
    expect(cluePhrase("She doesn't like scented candles")).toBe("scented candles");
    expect(cluePhrase("Wants to try rock climbing this year")).toBe("rock climbing");
  });

  it("merges simple synonyms and plurals", () => {
    expect(contentTokens("Beginner Ceramics Lessons")).toEqual(["starter", "pottery", "class"]);
  });
});
