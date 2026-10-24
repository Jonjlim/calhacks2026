import { describe, expect, it } from "vitest";
import { discoverShoppingQueries, normalizeTrendDataset } from "./trends";
import type { TrendContext } from "../contracts";
import recorded from "./fixtures/google-trends.json";

const context: TrendContext = { seedTerm: "pottery", geo: "US", timeRange: "today 3-m", retrievedAt: 1792836576646 };
const page = {
  searchTerm: "pottery",
  relatedQueries_top: [{ query: "pottery tools", value: 80 }, { query: "pottery near me", value: 100 }],
  relatedQueries_rising: [{ query: "pottery trimming tools", value: 250, formattedValue: "+250%" },
    { query: "pottery glaze", value: 999999, formattedValue: "Breakout" }],
};

describe("trend observations", () => {
  it("keeps distinct search metrics and contextual source links, never invents exact breakout growth", () => {
    const rows = normalizeTrendDataset([page], context);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ kind: "top_search", popularityIndex: 80, ...context });
    expect(rows[2]).toMatchObject({ kind: "rising_search", growthPercent: 250 });
    expect(rows[3]).toMatchObject({ kind: "breakout_search" });
    expect(rows[3]).not.toHaveProperty("growthPercent");
    const url = new URL(rows[0]!.sourceUrl);
    expect(url.hostname).toBe("trends.google.com");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "pottery", geo: "US", date: "today 3-m" });
  });

  it("rejects mismatched pages, missing context, and invalid metrics rather than coercing them", () => {
    expect(normalizeTrendDataset([{ ...page, searchTerm: "bitcoin" }], context)).toEqual([]);
    expect(normalizeTrendDataset([page], { ...context, retrievedAt: 0 })).toEqual([]);
    expect(normalizeTrendDataset([page], { ...context, geo: "GB" } as unknown as TrendContext)).toEqual([]);
    const invalid = { searchTerm: "pottery", relatedQueries_top: [
      { query: "pottery tools", value: "80" }, { query: "pottery glaze", value: 101 },
      { query: "pottery wheel", value: NaN }, { query: "", value: 50 },
    ], relatedQueries_rising: [{ query: "pottery tools", value: -1 }] };
    expect(normalizeTrendDataset([invalid], context)).toEqual([]);
    expect(normalizeTrendDataset(null, context)).toEqual([]);
  });

  it("deduplicates observations without inflating evidence", () => {
    expect(normalizeTrendDataset([page, page], context)).toHaveLength(4);
  });

  it("adapts the observed alternate-actor window label but rejects a different window or geo", () => {
    const alternate = { keyword: "pottery", geo: "US", timeRange: "Past 90 days", relatedSearches: { top: page.relatedQueries_top } };
    expect(normalizeTrendDataset([alternate], context)).toHaveLength(2);
    expect(normalizeTrendDataset([{ ...alternate, timeRange: "Past day" }], context)).toEqual([]);
    expect(normalizeTrendDataset([{ ...alternate, geo: "GB" }], context)).toEqual([]);
  });

  it("keeps a malformed child from discarding other valid queries", () => {
    expect(normalizeTrendDataset([{ ...page, relatedQueries_top: [null, {}, ...page.relatedQueries_top] }], context)).toHaveLength(4);
  });
});

describe("category-conditioned shopping discovery", () => {
  it("uses recorded searches without promoting Pottery Barn or informational queries", () => {
    const broad = recorded[0]!;
    const broadRows = normalizeTrendDataset(broad.data, broad.context as TrendContext);
    expect(broadRows).toHaveLength(8);
    expect(broadRows.some(row => row.kind === "breakout_search")).toBe(true);
    const candidates = discoverShoppingQueries(broadRows);
    expect(candidates.some(row => /barn|near me|how to/i.test(row.query))).toBe(false);
    expect(candidates.some(row => row.query === "pottery clay")).toBe(true);
    const narrow = recorded[1]!;
    const narrowRows = normalizeTrendDataset(narrow.data, narrow.context as TrendContext);
    const tools = discoverShoppingQueries(narrowRows);
    expect(tools.map(row => row.query)).toEqual(["dirty girls pottery tools", "mkm pottery tools", "pottery tools and supplies", "xiem pottery tools"]);
    expect(tools.find(row => row.query === "mkm pottery tools")?.evidence).toContainEqual(expect.objectContaining({ kind: "rising_search", growthPercent: 300 }));
  });

  it("retains evidence, screens local intent, and prioritizes rising discoveries deterministically", () => {
    const rows = normalizeTrendDataset([page], context);
    const candidates = discoverShoppingQueries(rows);
    expect(candidates.map(item => item.query)).toEqual(["pottery glaze", "pottery trimming tools", "pottery tools"]);
    expect(candidates.every(item => item.evidence.every(row => rows.includes(row)))).toBe(true);
    expect(discoverShoppingQueries([...rows].reverse())).toEqual(candidates);
  });

  it("does not promote unrelated, partial-seed, or informational searches", () => {
    const rows = normalizeTrendDataset([{ searchTerm: "pottery", relatedQueries_top: [
      { query: "celebrity gossip", value: 100 }, { query: "how to make pottery", value: 90 },
      { query: "pottery", value: 80 }, { query: "pottery museum", value: 75 },
      { query: "pottery barn chair", value: 100 }, { query: "potterybarn rug", value: 100 },
    ] }], context);
    expect(discoverShoppingQueries(rows)).toEqual([]);
    const twoWords = { ...context, seedTerm: "vintage denim" };
    const fashion = normalizeTrendDataset([{ searchTerm: "vintage denim", relatedQueries_top: [
      { query: "vintage camera", value: 90 }, { query: "vintage denim jacket", value: 70 },
    ] }], twoWords);
    expect(discoverShoppingQueries(fashion).map(row => row.query)).toEqual(["vintage denim jacket"]);
  });

  it("bounds suggestions and merges top/rising evidence for the same phrase", () => {
    const rows = normalizeTrendDataset([{ ...page, relatedQueries_rising: [{ query: "pottery tools", value: 100 }] }], context);
    expect(discoverShoppingQueries(rows)[0]?.evidence).toHaveLength(2);
    expect(discoverShoppingQueries(rows, 0)).toEqual([]);
    expect(discoverShoppingQueries(rows, -1)).toEqual([]);
  });
});
