import { describe, expect, it } from "vitest";
import fixture from "./fixtures/scrapewise-no-results.json";
import { normalizeDataset, providerNotice } from "./normalize";
import { shoppingPhrases } from "./text";

describe("Scrapewise NO_RESULTS row (recorded live)", () => {
  it("keeps no listing and says the search was empty", () => {
    expect(normalizeDataset(fixture, 1_790_000_000_000)).toEqual([]);
    expect(providerNotice(fixture)).toBe("Google Shopping has no products for this search in this country (not charged)");
  });

  it("searches the hobby, not the story sentence that returned nothing", () => {
    expect(shoppingPhrases("She throws pots at the community studio every Sunday and just started on the wheel.")[0]).toBe("pottery");
  });
});
