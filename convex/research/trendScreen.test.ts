import { describe, expect, it } from "vitest";
import { keepsTrendSuggestion } from "../../lib/research/trends";
import { screenTrendQueries } from "./trendScreen";

describe("screenTrendQueries", () => {
  it("keeps only buyable kinds and exact phrases the scraper returned", async () => {
    const transport = async () => ({ items: [
      { query: "bowling ball bag", kind: "product" },
      { query: "bowling alley shooting", kind: "not_gift" },
      { query: "cosmic bowling party", kind: "experience" },
      { query: "invented bowling thing", kind: "product" },
    ] });
    const kept = await screenTrendQueries(transport, "bowling", ["bowling ball bag", "bowling alley shooting", "cosmic bowling party"]);
    expect(kept).toEqual(["bowling ball bag", "cosmic bowling party"]);
  });

  it("returns null so callers fall back to the word filter", async () => {
    const kept = await screenTrendQueries(async () => { throw new Error("down"); }, "bowling", ["bowling ball bag"]);
    expect(kept).toBeNull();
  });
});

describe("keepsTrendSuggestion", () => {
  it("model-screened samples still drop news", () => {
    expect(keepsTrendSuggestion("model", "bowling alley shooting")).toBe(false);
    expect(keepsTrendSuggestion("model", "bowling shirt")).toBe(true);
    expect(keepsTrendSuggestion("model", "cosmic bowling")).toBe(true);
    expect(keepsTrendSuggestion(undefined, "cosmic bowling")).toBe(false);
  });
});
