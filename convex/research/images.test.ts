import { describe, expect, it } from "vitest";
import type { ProductListing } from "../../lib/contracts";
import { hasProductImageUrl } from "../../lib/research/images";
import { clueLikesPottery, fixtureListings } from "./fixtures/maya";
import { rankListings } from "./score";

// Two different kits with the same words, so relevance ties without one hiding the other as a duplicate.
const item = (id: string, imageUrl?: string): ProductListing => ({
  ...fixtureListings[0]!, id, title: id === "z" ? "Tool Kit for Pottery" : "Pottery Tool Kit", priceMinor: 3000,
  priceStatus: "observed", availability: "unknown", imageUrl,
});
const rank = (listings: ProductListing[], limit?: number) => rankListings({
  listings, clues: [clueLikesPottery], budgetMinor: 8000, limit,
});

describe("product photo preference", () => {
  it("prefers a valid image only after relevance and budget fit tie", () => {
    const listings = [item("a"), item("z", "https://images.example.com/tools.jpg")];
    const results = rank(listings, 1);
    expect(results[0]?.listingId).toBe("z");
    const full = rank(listings);
    expect(full).toHaveLength(2);
    expect(full[0]?.score).toBe(full[1]?.score);
    expect(full[0]?.publishedClueIds).toEqual(full[1]?.publishedClueIds);
  });

  it("never lets an irrelevant pictured gift outrank a matching gift", () => {
    const results = rank([
      item("z"), { ...item("a", "https://images.example.com/mug.jpg"), title: "Generic Mug" },
    ]);
    expect(results[0]?.listingId).toBe("z");
  });

  it("never hides budget differences with an image bonus", () => {
    const results = rank([
      item("z"), { ...item("a", "https://images.example.com/tools.jpg"), priceMinor: 20000 },
    ]);
    expect(results[0]?.listingId).toBe("z");
    expect(results[0]?.budgetFit).toBeGreaterThan(results[1]!.budgetFit);
  });

  it.each([
    undefined, "", "javascript:alert(1)", "http://images.example.com/image.jpg",
    "https://user:pass@example.com/image.jpg", "https://localhost/image.jpg",
    "https://127.0.0.1/image.jpg", "not-a-url",
  ])("does not prefer missing or invalid image URL %s", imageUrl => {
    expect(hasProductImageUrl({ imageUrl })).toBe(false);
    expect(rank([item("z", imageUrl), item("a")])[0]?.listingId).toBe("a");
  });

  it("still applies exclusions to gifts with images", () => {
    const results = rankListings({
      listings: [item("a", "https://images.example.com/tools.jpg")],
      clues: [{ ...clueLikesPottery, kind: "exclusion", text: "No more pottery tool kits" }],
    });
    expect(results).toEqual([]);
  });

  it("keeps deterministic ID order when both images qualify", () => {
    const listings = [item("z", "https://images.example.com/z.jpg"), item("a", "https://images.example.com/a.jpg")];
    expect(rank(listings).map(row => row.listingId)).toEqual(["a", "z"]);
    expect(rank([...listings].reverse())).toEqual(rank(listings));
  });
});
