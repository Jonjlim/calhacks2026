import { describe, expect, it } from "vitest";
import type { ProductListing, PublishedClue } from "../../lib/contracts";
import { fixtureListings } from "./fixtures/maya";
import { MAX_PER_SELLER, rankListings } from "./score";

// Titles observed in live Google Shopping results on October 24, 2026.
const listing = (id: string, title: string, sellerName: string, priceMinor = 3000): ProductListing => ({
  ...fixtureListings[0]!, id, title, sellerName, priceMinor, priceStatus: "observed", availability: "unknown",
});
const likes = (text: string): PublishedClue => ({
  id: "c1", roomId: "room", publisherId: "p1", kind: "interest", text,
  sourceKind: "manual", sourceMessageIds: [], status: "active", publishedAt: 1,
});
const ids = (rows: { listingId: string }[]) => rows.map((row) => row.listingId);

describe("one product per family, a few per seller", () => {
  it("shows one of each jean style, not every size", () => {
    const rows = rankListings({ clues: [likes("Loves jeans")], listings: [
      listing("baggy10", "AE Low-Rise Baggy Straight Jean Women's Black Blaze 10 Regular", "American Eagle"),
      listing("baggy4", "AE Low-Rise Baggy Straight Jean Women's Black Blaze 4 Regular", "American Eagle"),
      listing("baggy", "AE Low-Rise Baggy Straight Jean Women's", "American Eagle"),
      listing("curvy1", "AE Curvy Super High-Waisted Baggy Jean 0043136571", "American Eagle"),
      listing("curvy2", "AE Curvy Super High-Waisted Baggy Jean 0043136514", "American Eagle"),
      listing("kick6", "AE Super Low-Rise Kick Boot Jean Women's Dark Wash 6 Regular", "American Eagle"),
      listing("kick2", "AE Super Low-Rise Kick Boot Jean Women's Dark Wash 2 Long", "American Eagle"),
    ] });
    expect(rows).toHaveLength(3);
    expect(new Set(ids(rows))).toEqual(new Set(["baggy", "curvy1", "kick2"]));
  });

  it("drops an exact repeat of the same product", () => {
    const rows = rankListings({ clues: [likes("Loves hiking")], listings: [
      listing("atom1", "Arc'teryx Atom Hoody Men's", "REI"),
      listing("atom2", "Arc'teryx Atom Hoody Men's", "Backcountry"),
      listing("fleece", "REI Co-op Women's Trailmade Fleece Jacket", "REI"),
    ] });
    expect(ids(rows).filter((id) => id.startsWith("atom"))).toHaveLength(1);
    expect(ids(rows)).toContain("fleece");
  });

  it("keeps men's and women's versions apart", () => {
    const rows = rankListings({ clues: [likes("Loves hiking")], listings: [
      listing("mens", "Patagonia Men's Torrentshell 3L Rain Jacket", "Patagonia"),
      listing("womens", "Patagonia Women's Torrentshell 3L Jacket | Weatherproof Protection", "Patagonia"),
    ] });
    expect(ids(rows).sort()).toEqual(["mens", "womens"]);
  });

  it(`lets other sellers go first after ${MAX_PER_SELLER} from one, then fills spare slots`, () => {
    const shop = Array.from({ length: 5 }, (_, i) =>
      listing(`ae${i}`, `AE ${["Mom", "Baggy", "Flare", "Skinny", "Straight"][i]} Jean`, "American Eagle", 2000));
    const other = listing("levis", "Levi's 501 Original Jean", "Levi's", 9000);
    const rows = rankListings({ clues: [likes("Loves jeans")], budgetMinor: 3000, listings: [...shop, other] });
    expect(ids(rows).slice(0, MAX_PER_SELLER + 1)).toContain("levis");
    expect(rows).toHaveLength(6);
    expect(rankListings({ clues: [likes("Loves jeans")], budgetMinor: 3000, listings: [...shop, other], limit: 4 }))
      .toHaveLength(4);
  });

  it("never changes scores or citations, only which rows are shown", () => {
    const listings = [
      listing("a", "Pottery Tool Kit", "Shop A"), listing("b", "Pottery Tool Kit", "Shop B"),
    ];
    const [row] = rankListings({ clues: [likes("Loves pottery")], listings });
    const [alone] = rankListings({ clues: [likes("Loves pottery")], listings: [listings[0]!] });
    expect(row).toEqual(alone);
  });
});
