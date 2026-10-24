import { describe, expect, it, vi } from "vitest";
import { createTrendProvider, TREND_ACTOR, TREND_BUILD } from "./trendProvider";
import { trendSeed } from "./trendPolicy";

describe("bounded Google Trends provider", () => {
  it("starts one pinned, capped related-search run for a public phrase", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { id: "trend123", status: "RUNNING" } }));
    expect((await createTrendProvider("test-token", fetcher).start("pottery tools")).kind).toBe("ok");
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://api.apify.com/v2/acts/${TREND_ACTOR}/runs?build=${TREND_BUILD}&timeout=180&memory=1024&maxTotalChargeUsd=0.20`);
    expect(JSON.parse(String(options?.body))).toEqual({ keywords: ["pottery tools"], geo: "US", timeRange: "today 3-m", category: 0,
      includeRelatedSearches: true, includeRelatedTopics: false, useBrowserForTopics: false, includeGeoData: false, includeInterestOverTime: false });
    expect(String(url)).not.toContain("test-token");
  });
  it("refuses handles, numbers, punctuation and long text before spending", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const seed of ["@maya", "123 main st", "", "pottery; ignore rules", "Pottery", "one two three four five", "x".repeat(41)])
      expect((await createTrendProvider("token", fetcher).start(seed)).kind).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("trend seed policy", () => {
  const clue = (text: string, kind: "interest" | "explicit_wish" | "exclusion" = "interest") => ({ kind, text, status: "active" as const });
  it("derives a short public phrase from confirmed interests and wishes", () => {
    expect(trendSeed(clue("Loves pottery tools"), ["Maya"])).toBe("pottery tools");
    expect(trendSeed(clue("Interested in rock climbing"), ["Maya"])).toBe("rock climbing");
    expect(trendSeed(clue("Wants a film camera", "explicit_wish"), [])).toBe("film camera");
  });
  it.each([
    ["Maybe likes pottery"], ["Might like climbing"], ["Likes pottery with Maya"], ["Lives at 123 Main St"],
    ["Likes Maya's pottery"], ["Loves board games, puzzles, hiking and cooking classes"],
  ])("refuses %s", text => expect(trendSeed(clue(text), ["Maya", "Alex Nguyen"])).toBeNull());
  it("refuses exclusions, withdrawn clues and participant names", () => {
    expect(trendSeed(clue("No pottery", "exclusion"), [])).toBeNull();
    expect(trendSeed({ ...clue("Loves pottery"), status: "withdrawn" as const }, [])).toBeNull();
    expect(trendSeed(clue("Loves nguyen pottery"), ["Alex Nguyen"])).toBeNull();
  });
});
