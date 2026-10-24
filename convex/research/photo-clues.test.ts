import { describe, expect, it } from "vitest";
import type { ProductListing, PublishedClue } from "../../lib/contracts";
import { buildSearchBrief } from "./brief";
import { filterListings, rankListings } from "./score";
import { isUnconfirmedObservation } from "./text";
import { fixtureListings, clueLikesPottery } from "./fixtures/maya";

const item = (id: string, title: string): ProductListing => ({
  ...fixtureListings[0]!, id, title, priceMinor: 3000,
});
const clue = (id: string, text: string, kind: PublishedClue["kind"] = "interest"): PublishedClue => ({
  ...clueLikesPottery, id, text, kind, status: "active",
});
const brief = (clues: PublishedClue[]) => buildSearchBrief({
  roomId: "room_maya", knowledgeRevision: 1, clues,
});
const rank = (clues: PublishedClue[], listings: ProductListing[]) => rankListings({
  clues, listings, budgetMinor: 8000,
});

describe("confirmed visual preferences → gift candidates", () => {
  it("matches vintage denim precisely instead of citing a vintage mug", () => {
    const evidence = clue("vintage", "Likes vintage denim style");
    const results = rank([evidence], [
      item("mug", "Vintage Coffee Mug"), item("jeans", "Retro Denim Jeans"),
      item("jacket", "Vintage Denim Jacket"),
    ]);
    expect(results[0]?.personalRelevance).toBeGreaterThan(0);
    expect(results.find(row => row.listingId === "jacket")?.publishedClueIds).toEqual(["vintage"]);
    expect(results.find(row => row.listingId === "jeans")?.publishedClueIds).toEqual(["vintage"]);
    expect(results.find(row => row.listingId === "mug")?.publishedClueIds).toEqual([]);
    expect(results.at(-1)?.listingId).toBe("mug");
    expect(brief([evidence]).queryTerms).toEqual(["vintage denim"]);
  });

  it("matches earth-tone goods without confusing olive oil or earth science with style", () => {
    const results = rank([clue("palette", "Prefers earth tones")], [
      item("tote", "Olive Green Canvas Tote"), item("scarf", "Beige Cotton Scarf"),
      item("vase", "Terracotta Vase"), item("oil", "Extra Virgin Olive Oil"),
      item("book", "Earth Science Textbook"),
    ]);
    for (const id of ["tote", "scarf", "vase"]) {
      expect(results.find(row => row.listingId === id)?.publishedClueIds).toEqual(["palette"]);
    }
    for (const id of ["oil", "book"]) {
      expect(results.find(row => row.listingId === id)?.publishedClueIds).toEqual([]);
    }
    expect(brief([clue("palette", "Prefers earth tones")]).queryTerms).toEqual(["earth tones"]);
  });

  it("maps minimal gold jewelry to necklaces and earrings, not arbitrary gold goods", () => {
    const results = rank([clue("jewelry", "Likes minimal gold jewelry")], [
      item("earrings", "Minimalist Gold Earrings"),
      item("necklace", "Minimal Gold Necklace"),
      item("adapter", "Gold USB Adapter"),
      item("silver", "Minimalist Silver Necklace"),
    ]);
    expect(results.find(row => row.listingId === "earrings")?.publishedClueIds).toEqual(["jewelry"]);
    expect(results.find(row => row.listingId === "necklace")?.publishedClueIds).toEqual(["jewelry"]);
    expect(results.find(row => row.listingId === "adapter")?.publishedClueIds).toEqual([]);
    expect(results.find(row => row.listingId === "silver")?.publishedClueIds).toEqual([]);
  });

  it("matches rock climbing to climbing goods but not rock music", () => {
    const results = rank([clue("activity", "Likes rock climbing")], [
      item("chalk", "Climbing Chalk Bag"), item("poster", "Rock Music Poster"),
    ]);
    expect(results[0]?.listingId).toBe("chalk");
    expect(results[0]?.publishedClueIds).toEqual(["activity"]);
    expect(results[1]?.publishedClueIds).toEqual([]);
  });

  it("cites each matching clue and ranks a two-clue fit above a one-clue fit", () => {
    const results = rank([
      clue("style", "Likes vintage denim"),
      clue("palette", "Likes earth tones"),
    ], [
      item("both", "Vintage Brown Denim Jacket"), item("style", "Vintage Blue Denim Jacket"),
      item("neither", "Generic Gift Card"),
    ]);
    expect(results[0]?.listingId).toBe("both");
    expect(results[0]?.publishedClueIds).toEqual(["style", "palette"]);
    expect(results[0]?.explanation).toContain("Likes vintage denim");
    expect(results[0]?.explanation).toContain("Likes earth tones");
    expect(results.find(row => row.listingId === "style")?.publishedClueIds).toEqual(["style"]);
  });

  it.each([
    "Holding a film camera", "She is wearing a denim jacket",
    "Seen holding a film camera", "Might own a camera",
    "In the photo, she has a camera",
  ])("does not turn unconfirmed observation into search or ownership: %s", text => {
    expect(isUnconfirmedObservation(text)).toBe(true);
    const observation = clue("observation", text, "ownership");
    const camera = item("camera", "Film Camera");
    expect(filterListings({ clues: [observation], listings: [camera] }).kept).toHaveLength(1);
    expect(brief([clue("observation", text)]).queryTerms).toEqual([]);
    expect(brief([observation]).mustExclude).toEqual([]);
    expect(rank([clue("observation", text)], [camera])[0]?.publishedClueIds).toEqual([]);
  });

  it("still applies explicit confirmed ownership and literal exclusions", () => {
    const camera = item("camera", "Film Camera");
    expect(filterListings({
      clues: [clue("owned", "Already owns a film camera", "ownership")], listings: [camera],
    }).kept).toEqual([]);
    // Positive style aliases must not broaden negative constraints to unrelated goods.
    const denimJacket = item("jacket", "Vintage Denim Jacket");
    expect(filterListings({
      clues: [clue("owned", "Already owns jeans", "ownership")], listings: [denimJacket],
    }).kept).toHaveLength(1);
  });

  it("ignores uncertain and withdrawn preferences, and uses the same path as text clues", () => {
    const listings = [item("jacket", "Vintage Denim Jacket")];
    const clues = [
      clue("guess", "Might like vintage denim", "uncertain"),
      { ...clue("withdrawn", "Likes vintage denim"), status: "withdrawn" as const },
    ];
    expect(brief(clues).queryTerms).toEqual([]);
    expect(rank(clues, listings)[0]?.publishedClueIds).toEqual([]);
    expect(rank([clue("confirmed", "Likes vintage denim")], listings)[0]?.publishedClueIds)
      .toEqual(["confirmed"]);
  });

  it("keeps ranking deterministic for shuffled product inputs", () => {
    const clues = [clue("confirmed", "Likes vintage denim")];
    const listings = [item("a", "Vintage Denim Jacket"), item("b", "Vintage Denim Jeans")];
    expect(rank(clues, listings)).toEqual(rank(clues, [...listings].reverse()));
  });
  it("does not inflate relevance when repeated photos produce the same confirmed preference", () => {
    const listings = [item("jacket", "Vintage Denim Jacket")];
    const single = rank([clue("one", "Likes vintage denim")], listings)[0]!;
    const repeated = rank([
      clue("one", "Likes vintage denim"),
      clue("two", "Likes vintage denim"),
      clue("three", "Likes vintage denim"),
    ], listings)[0]!;
    expect(repeated.personalRelevance).toBe(single.personalRelevance);
    expect(repeated.publishedClueIds).toEqual(["one", "two", "three"]);
  });

});
