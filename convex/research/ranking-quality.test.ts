import { describe, expect, it } from "vitest";
import type { ProductListing, PublishedClue } from "../../lib/contracts";
import { clueLikesPottery, fixtureListings } from "./fixtures/maya";
import { rankListings } from "./score";
import { isHandsOnItem, withoutBrandPhrases } from "./text";

// Titles observed in the live Apify run on 2026-10-24 for "Maya likes pottery".
const photo = "https://images.example.com/p.jpg";
const item = (id: string, title: string, fields: Partial<ProductListing> = {}): ProductListing => ({
  ...fixtureListings[0]!, id, title, priceMinor: 3000, priceStatus: "observed",
  availability: "unknown", imageUrl: photo, ...fields,
});
const clue = (id: string, text: string, kind: PublishedClue["kind"]): PublishedClue => ({
  ...clueLikesPottery, id, text, kind, status: "active",
});
const rank = (listings: ProductListing[], clues: PublishedClue[] = [clueLikesPottery]) =>
  rankListings({ listings, clues, budgetMinor: 8000 });

describe("brand names are not hobby evidence", () => {
  it("does not cite the pottery clue for Pottery Barn decor", () => {
    const results = rank([
      item("a_barn", "Pottery Barn Emery Ceramic Vase"),
      item("z_mug", "Turtle Farm Pottery handmade Ceramic Mug"),
    ]);
    expect(results[0]?.listingId).toBe("z_mug");
    expect(results.find(r => r.listingId === "a_barn")?.publishedClueIds).toEqual([]);
    expect(results.find(r => r.listingId === "z_mug")?.publishedClueIds).toEqual([clueLikesPottery.id]);
  });

  it("keeps studio names and genuine pottery words matchable", () => {
    expect(withoutBrandPhrases("Farmhouse Pottery Silo Mug")).toContain("pottery");
    expect(withoutBrandPhrases("Pottery Barn Kids Pottery Wheel")).toContain("pottery wheel");
    expect(withoutBrandPhrases("Pottery Barn Artisan Bowl")).not.toContain("pottery");
  });

  it("still lets ownership and exclusions read the literal title", () => {
    const results = rank(
      [item("barn", "Pottery Barn Ceramic Vase")],
      [clueLikesPottery, clue("no_barn", "No more Pottery Barn", "exclusion")],
    );
    expect(results).toEqual([]);
  });
});

describe("hands-on gifts break ties for a hobby interest", () => {
  it("puts kits, tools, and classes ahead of decor with the same score", () => {
    const listings = [
      item("a_vase", "Blue Rose Polish Pottery Small Vase"),
      item("b_bowl", "Palm Springs Studio Pottery Bowl"),
      item("y_kit", "Journey of Something Handmade Pottery Kit"),
      item("z_class", "Intro to Wheel Throwing Pottery Class"),
    ];
    const results = rank(listings);
    expect(new Set(results.map(r => r.score)).size).toBe(1);
    expect(results.slice(0, 2).map(r => r.listingId).sort()).toEqual(["y_kit", "z_class"]);
    expect(rank([...listings].reverse())).toEqual(results);
  });

  it("never lets a hands-on item beat a better score or budget fit", () => {
    const results = rank([
      item("kit", "Pottery Tool Kit", { priceMinor: 20_000 }),
      item("vase", "Handmade Pottery Vase"),
      item("other_kit", "Knitting Starter Kit"),
    ]);
    expect(results.map(r => r.listingId)).toEqual(["vase", "kit", "other_kit"]);
  });

  it("ranks hands-on before photo presence among exact ties", () => {
    const results = rank([
      item("a_decor", "Pottery Vase"),
      item("z_kit", "Pottery Kit", { imageUrl: undefined }),
    ]);
    expect(results[0]?.listingId).toBe("z_kit");
  });

  it("hides owned kits even though kits are preferred", () => {
    const results = rank(
      [item("kit", "Sculpd Kids Pottery Kit"), item("mug", "Handmade Pottery Mug")],
      [clueLikesPottery, clue("owned", "Maya already owns a pottery kit", "ownership")],
    );
    expect(results.map(r => r.listingId)).toEqual(["mug"]);
  });

  it.each([
    ["Pottery Trimming Tool Set", true], ["Pottery Glaze Supplies", true],
    ["Beginner Pottery Starter Kit", true], ["Wheel Throwing Classes", true],
    ["Ceramic Vase", false], ["Pottery Mug", false],
  ])("classifies %s as hands-on=%s", (title, expected) => {
    expect(isHandsOnItem(title)).toBe(expected);
  });
});
