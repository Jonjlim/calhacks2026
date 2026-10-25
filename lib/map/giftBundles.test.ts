import { describe, expect, it } from "vitest";
import { CROWDED_AT, giftBundles, SHOWN_PER_GROUP } from "./giftBundles";

const gift = (n: number, theme?: string) => ({ key: `gift:${n}`, listingId: `${n}`, themes: theme ? [theme] : [], rank: n, x: n, z: -n });
const many = (count: number, themes: string[]) => Array.from({ length: count }, (_, i) => gift(i + 1, themes[i % themes.length]));

describe("which gifts the map draws", () => {
  it("draws every gift while the map isn't crowded", () => {
    const gifts = many(CROWDED_AT, ["a", "b"]);
    expect(giftBundles(gifts)).toEqual({ shown: gifts, bundles: [] });
  });

  it("when crowded, keeps each theme's best few and bundles the rest where they'd sit", () => {
    const gifts = many(CROWDED_AT + 4, ["a", "b"]);
    const { shown, bundles } = giftBundles(gifts);
    expect(shown).toHaveLength(SHOWN_PER_GROUP * 2);
    expect(bundles.map((b) => [b.id, b.count])).toEqual([["a", 7], ["b", 7]]);
    expect(shown.filter((g) => g.themes[0] === "a").map((g) => g.rank)).toEqual([1, 3, 5]);
    expect(shown.length + bundles.reduce((n, b) => n + b.count, 0)).toBe(gifts.length);
  });

  it("always draws the chosen gift, the branch in focus and opened bundles", () => {
    const gifts = many(CROWDED_AT + 4, ["a", "b"]);
    const { shown, bundles } = giftBundles(gifts, { selectedListingId: "19", highlight: new Set(["gift:20"]), open: new Set(["a"]) });
    expect(shown.map((g) => g.listingId)).toEqual(expect.arrayContaining(["19", "20"]));
    expect(shown.filter((g) => g.themes[0] === "a")).toHaveLength(10);
    expect(bundles.map((b) => b.id)).toEqual(["b"]);
  });
});
