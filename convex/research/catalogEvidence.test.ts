import { describe, expect, it } from "vitest";
import type { ProductListing, PublishedClue } from "../../lib/contracts";
import shopping from "../../lib/research/fixtures/trend-shopping.json";
import { catalogEvidenceFor } from "./catalogEvidence";
import { normalizeDataset } from "./normalize";
import { filterListings, rankListings } from "./score";
import { clueLikesPottery, clueOwnsStarterKit, fixtureListings } from "./fixtures/maya";

const recorded: ProductListing[] = normalizeDataset(shopping.data, shopping.provenance.retrievedAt)
  .map((row, index) => ({ ...row, id: `recorded_${index}`, roomId: "room_maya", jobId: "recorded", status: "active" }));
const roller = recorded[1]!;
const disk = recorded[2]!;
const rank = (listings = recorded, clues = [clueLikesPottery], budgetMinor = 12000) => rankListings({ listings, clues, budgetMinor, limit: 30 });
const clue = (text: string, kind: PublishedClue["kind"]): PublishedClue => ({ ...clueLikesPottery, id: `${kind}_${text}`, kind, text });

describe("reviewed catalog identities", () => {
  it("recognizes the recorded full models, tolerating typography without relying on seller names", () => {
    expect(catalogEvidenceFor(roller)).toMatchObject({ productKey: "mkm-bhr-051", category: "pottery", manufacturer: "MKM", checkedOn: "2026-10-24" });
    expect(catalogEvidenceFor(disk)).toMatchObject({ productKey: "mkm-dd-10", category: "pottery" });
    expect(catalogEvidenceFor({ title: " BHR 051 BIG HAND ROLLER - ZIG-ZAG SPIRAL " })?.productKey).toBe("mkm-bhr-051");
    expect(catalogEvidenceFor({ ...roller, sellerName: "Another merchant" } as ProductListing)).toEqual(catalogEvidenceFor(roller));
  });

  it("does not classify unknown models, brand merchandise, truncated titles, appended accessories or variants", () => {
    for (const title of ["MKM Sticker", "BHR-051", "Big Hand Roller", "BHR-052 Big Hand Roller – Zig Zag Spiral", "BHR-051 Big Hand Roller – Zig Zag Spiral Sticker", "DD-10 MKM Decorating Disk", "MKM Tools Scl002 Large Round Stamp", "SCL-002 Hedge Trimmer"]) {
      expect(catalogEvidenceFor({ title })).toBeUndefined();
    }
    expect(catalogEvidenceFor({ ...roller, variant: "replacement handle" })).toBeUndefined();
  });
});

describe("category-backed recommendation matching", () => {
  it("puts real reviewed tools ahead of the sticker and explains the manufacturer evidence", () => {
    const results = rank();
    for (const listing of [roller, disk]) {
      const result = results.find(row => row.listingId === listing.id)!;
      expect(result.personalRelevance).toBe(0.7);
      expect(result.publishedClueIds).toEqual([clueLikesPottery.id]);
      expect(result.explanation).toContain(catalogEvidenceFor(listing)!.sourceUrl);
      expect(result.explanation).toContain("Category evidence:");
      expect(result.explanation).toContain("checked 2026-10-24");
      expect(result.trendSignal).toBe(0);
      expect(results.findIndex(row => row.listingId === listing.id)).toBeLessThan(results.findIndex(row => row.listingId === recorded[0]!.id));
    }
    expect(results.find(row => row.listingId === recorded[0]!.id)?.personalRelevance).toBe(0);
    expect(results.find(row => row.listingId === recorded[3]!.id)?.personalRelevance).toBe(0); // Unreviewed stamp.
  });

  it("does not turn category evidence into a wish match, preference, trend, or price fact", () => {
    for (const text of ["Wants a pottery wheel", "Likes vintage denim", "Likes pottery starter kits"]) {
      expect(rank([roller, disk], [clue(text, "explicit_wish")]).every(row => row.personalRelevance === 0)).toBe(true);
    }
    expect(rank([roller, disk], []).every(row => row.personalRelevance === 0 && !row.explanation.includes("Category evidence"))).toBe(true);
    expect(rank([roller], [{ ...clueLikesPottery, kind: "uncertain" }])[0]?.personalRelevance).toBe(0);
    expect(rank([roller], [{ ...clueLikesPottery, status: "withdrawn" }])[0]?.personalRelevance).toBe(0);
    expect(rank([roller], [clue("Might like pottery", "interest")])[0]?.personalRelevance).toBe(0);
  });

  it("uses reviewed hands-on evidence only as a tie-break, with no score boost", () => {
    const vase = { ...roller, id: "a_vase", title: "Handmade Pottery Vase" };
    const reviewed = { ...roller, id: "z_roller" };
    const results = rank([vase, reviewed]);
    expect(results[0]?.listingId).toBe("z_roller");
    expect(results[0]?.score).toBe(results[1]?.score);
    expect(rank([reviewed, vase])).toEqual(results);
  });

  it("keeps price unknown/over-budget penalties and observed shipping independent of category matching", () => {
    const unknown = { ...roller, priceMinor: undefined, priceStatus: "unknown" as const };
    expect(rank([unknown])[0]).toMatchObject({ personalRelevance: 0.7, budgetFit: 0.5 });
    expect(rank([unknown])[0]?.explanation).toContain("price unknown");
    const withShipping = { ...roller, shippingStatus: "observed" as const, shippingMinor: 1000 };
    const results = rank([withShipping, { ...disk, id: "cheap", priceMinor: 1000 }], [clueLikesPottery], 2500);
    expect(results[0]?.listingId).toBe("cheap");
    expect(results.find(row => row.listingId === roller.id)?.budgetFit).toBeLessThan(1);
  });
});

describe("ownership and explicit exclusions", () => {
  it("keeps separate tools when a starter kit is owned, but hides the kit and an exactly owned model", () => {
    const results = rank([...recorded, ...fixtureListings], [clueLikesPottery, clueOwnsStarterKit]);
    expect(results.some(row => row.listingId === "fx_starter_kit")).toBe(false);
    expect(results.map(row => row.listingId)).toEqual(expect.arrayContaining([roller.id, disk.id]));
    expect(rank([roller], [clueLikesPottery, clue(`Already owns ${roller.title}`, "ownership")])).toEqual([]);
    expect(rank([roller], [clueLikesPottery, clue("Already owns pottery tools", "ownership")])).toHaveLength(1);
  });

  it.each(["No more pottery", "No MKM", "Hates pottery tools"])("honors the explicit exclusion %s even when title words are missing", text => {
    const blocked = clue(text, "exclusion");
    const result = filterListings({ listings: [roller, disk], clues: [blocked] });
    expect(result.kept).toEqual([]);
    expect(result.excluded.every(row => row.clueId === blocked.id && row.reason === "excluded_by_clue")).toBe(true);
  });

  it("still respects unavailable/invalid state and ignores withdrawn or tentative exclusions", () => {
    expect(rank([{ ...roller, availability: "unavailable" }])).toEqual([]);
    expect(rank([{ ...roller, status: "invalid" }])).toEqual([]);
    expect(rank([roller], [clueLikesPottery, { ...clue("No more pottery", "exclusion"), status: "withdrawn" }])).toHaveLength(1);
    expect(rank([roller], [clueLikesPottery, clue("Might dislike pottery", "exclusion")])).toHaveLength(1);
  });
});
