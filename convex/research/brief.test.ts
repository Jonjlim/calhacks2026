import { describe, expect, it } from "vitest";
import { buildSearchBrief } from "./brief";
import { searchBriefSchema } from "../../lib/validation";
import { FIXTURE_ROOM_ID, cluesAfterOwnership, clueLikesPottery } from "./fixtures/maya";
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

  it("keeps budget and occasion wording out of the search when an interest exists", () => {
    const clues = [
      "Budget is around $80 for her birthday gift",
      "Loves pottery, budget $80",
      "Anniversary gift under 100 dollars",
      "Into hiking",
    ].map((text, i) => ({ id: `b${i}`, kind: "interest" as const, text, status: "active" as const }));
    const brief = buildSearchBrief({ roomId: FIXTURE_ROOM_ID, knowledgeRevision: 1, clues });
    expect(brief.queryTerms).toEqual(["pottery", "hiking"]);
  });

  it("falls back to the original phrase when only budget wording exists", () => {
    const clues = [{ id: "b", kind: "interest" as const, text: "Budget is around $80 for her birthday gift", status: "active" as const }];
    expect(buildSearchBrief({ roomId: FIXTURE_ROOM_ID, knowledgeRevision: 1, clues }).queryTerms)
      .toEqual(["budget is around $80 for her birthday gift"]);
  });

  it("dedupes phrases and caps query terms at three", () => {
    const clues = ["Likes pottery", "Loves pottery", "Into hiking", "Likes jazz", "Likes tea"].map(
      (text, i) => ({ id: `c${i}`, kind: "interest" as const, text, status: "active" as const }),
    );
    const brief = buildSearchBrief({ roomId: FIXTURE_ROOM_ID, knowledgeRevision: 1, clues });
    expect(brief.queryTerms).toEqual(["pottery", "hiking", "jazz"]);
  });

  it.each([
    [500, 12], [13, 12], [0, 1], [-4, 1], [2.9, 2],
    [Number.NaN, 12], [Number.POSITIVE_INFINITY, 12],
    [Number.NEGATIVE_INFINITY, 12], [undefined, 12],
  ])("keeps listing limit %s within the shared boundary contract", (listingLimit, expected) => {
    const brief = buildSearchBrief({
      roomId: FIXTURE_ROOM_ID,
      knowledgeRevision: 1,
      clues: [clueLikesPottery],
      listingLimit,
    });
    expect(brief.listingLimit).toBe(expected);
    expect(searchBriefSchema.safeParse(brief).success).toBe(true);
  });
});

describe("text helpers", () => {
  it("strips clue framing", () => {
    expect(cluePhrase("Already owns a pottery starter kit.")).toBe("pottery starter kit");
    expect(cluePhrase("She doesn't like scented candles")).toBe("scented candles");
    expect(cluePhrase("Wants to try rock climbing this year")).toBe("rock climbing");
  });

  it("merges simple synonyms and plurals", () => {
    expect(contentTokens("Beginner Pottery Lessons")).toEqual(["starter", "pottery", "class"]);
  });
});
