import { describe, expect, it } from "vitest";
import type { ProductListing, PublishedClue } from "../../lib/contracts";
import {
  FIXTURE_BUDGET_MINOR,
  clueOwnsStarterKit,
  cluesAfterOwnership,
  cluesBeforeOwnership,
  fixtureListings,
} from "./fixtures/maya";
import recorded from "./fixtures/johnvc-shopping.json";
import { normalizeDataset } from "./normalize";
import { combineScore, filterListings, rankListings } from "./score";

const rank = (clues: PublishedClue[], listings: ProductListing[] = fixtureListings) =>
  rankListings({ listings, clues, budgetMinor: FIXTURE_BUDGET_MINOR });

const ids = (recs: { listingId: string }[]) => recs.map((r) => r.listingId);

describe("rankListings: Maya demo", () => {
  it("shows the starter kit before the ownership clue is published", () => {
    expect(ids(rank(cluesBeforeOwnership))).toContain("fx_starter_kit");
  });

  it("drops the starter kit once Jordan publishes that Maya owns one", () => {
    const after = ids(rank(cluesAfterOwnership));
    expect(after).not.toContain("fx_starter_kit");
    // Other pottery items, including the class, survive the ownership filter.
    expect(after).toEqual(
      expect.arrayContaining(["fx_wheel_class", "fx_trim_tools", "fx_glaze"]),
    );
  });

  it("ranks the class first because it matches both the wish and the interest", () => {
    const [top] = rank(cluesAfterOwnership);
    expect(top?.listingId).toBe("fx_wheel_class");
    expect(top?.publishedClueIds).toEqual(["c_pottery", "c_class"]);
    expect(top?.explanation).toContain('"Wants to take a wheel-throwing class this year"');
  });

  it("produces the expected full order", () => {
    expect(ids(rank(cluesAfterOwnership))).toEqual([
      "fx_wheel_class",
      "fx_trim_tools",
      "fx_glaze",
      "fx_electric_wheel",
      "fx_mugs",
    ]);
  });

  it("only attaches clues that actually matched", () => {
    const mugs = rank(cluesAfterOwnership).find((r) => r.listingId === "fx_mugs");
    expect(mugs?.publishedClueIds).toEqual([]);
    expect(mugs?.personalRelevance).toBe(0);
    expect(mugs?.explanation).toMatch(/No published clue/);
  });
});

describe("filterListings", () => {
  it("reports why each listing was removed", () => {
    const { excluded } = filterListings({ listings: fixtureListings, clues: cluesAfterOwnership });
    expect(excluded).toEqual(
      expect.arrayContaining([
        { listingId: "fx_starter_kit", reason: "excluded_by_clue", clueId: clueOwnsStarterKit.id },
        { listingId: "fx_sold_out", reason: "unavailable" },
      ]),
    );
  });

  it("ignores withdrawn ownership clues", () => {
    const withdrawn = { ...clueOwnsStarterKit, status: "withdrawn" as const };
    const { kept } = filterListings({
      listings: fixtureListings,
      clues: [...cluesBeforeOwnership, withdrawn],
    });
    expect(kept.map((l) => l.id)).toContain("fx_starter_kit");
  });

  it("drops inactive listings", () => {
    const stale = { ...fixtureListings[1]!, status: "stale" as const };
    const { excluded } = filterListings({ listings: [stale], clues: [] });
    expect(excluded).toEqual([{ listingId: stale.id, reason: "inactive" }]);
  });

  it("lets a one-word exclusion block on that word", () => {
    const hatesMugs: PublishedClue = {
      ...clueOwnsStarterKit,
      id: "c_no_mugs",
      kind: "exclusion",
      text: "Hates mugs",
    };
    const { excluded } = filterListings({ listings: fixtureListings, clues: [hatesMugs] });
    expect(excluded.map((e) => e.listingId)).toContain("fx_mugs");
  });
});

describe("budget fit", () => {
  it("never treats an unknown price as fitting the budget", () => {
    const glaze = rank(cluesAfterOwnership).find((r) => r.listingId === "fx_glaze");
    expect(glaze?.budgetFit).toBe(0.5);
    expect(glaze?.explanation).toContain("price unknown");
  });

  it("penalizes over-budget items and says by how much", () => {
    const wheel = rank(cluesAfterOwnership).find((r) => r.listingId === "fx_electric_wheel");
    expect(wheel?.budgetFit).toBeGreaterThan(0);
    expect(wheel?.budgetFit).toBeLessThan(0.2);
    expect(wheel?.explanation).toContain("$99.99 over budget");
  });

  it("counts observed shipping toward the budget", () => {
    const tools = fixtureListings.find((l) => l.id === "fx_trim_tools")!;
    const [rec] = rankListings({ listings: [tools], clues: [], budgetMinor: 3_000 });
    expect(rec?.budgetFit).toBeLessThan(1);
  });

  it("gives full budget fit to priced items when no budget is set", () => {
    const recs = rankListings({ listings: fixtureListings, clues: cluesAfterOwnership });
    expect(recs.find((r) => r.listingId === "fx_electric_wheel")?.budgetFit).toBe(1);
  });
});

describe("determinism and limits", () => {
  it("returns the same order for shuffled input", () => {
    const shuffled = [...fixtureListings].reverse();
    expect(ids(rank(cluesAfterOwnership, shuffled))).toEqual(ids(rank(cluesAfterOwnership)));
  });

  it("respects the limit", () => {
    const recs = rankListings({ listings: fixtureListings, clues: cluesAfterOwnership, limit: 2 });
    expect(recs).toHaveLength(2);
  });

  it("keeps trendSignal at 0 and score within 0..1", () => {
    for (const r of rank(cluesAfterOwnership)) {
      expect(r.trendSignal).toBe(0);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("combineScore applies the documented weights", () => {
    expect(combineScore({ personalRelevance: 1, budgetFit: 1, trendSignal: 1 })).toBeCloseTo(1);
    expect(combineScore({ personalRelevance: 1, budgetFit: 0, trendSignal: 0 })).toBeCloseTo(0.7);
  });
});

describe("ownership matching on recorded Apify data", () => {
  const listings: ProductListing[] = normalizeDataset(recorded.pages, recorded.retrievedAt).map(
    (l, i) => ({ ...l, id: `rec_${i}`, roomId: "room_maya", jobId: "rj_recorded", status: "active" }),
  );
  const titles = (recs: { listingId: string }[]) =>
    recs.map((r) => listings.find((l) => l.id === r.listingId)?.title);

  it("normalizes the recorded sample", () => {
    expect(listings.length).toBe(4);
  });

  it("keeps pottery tool kits when she owns a starter kit", () => {
    const kept = titles(rank(cluesAfterOwnership, listings));
    expect(kept).toEqual(
      expect.arrayContaining(["Kemper Pottery Tool Kit", "Amaco Pottery Tool Kit", "Mudtools Do All Trim Tool"]),
    );
  });

  it("does not treat a ceramic mug as matching a pottery interest", () => {
    const mug = rank(cluesAfterOwnership, listings).find((r) =>
      listings.find((l) => l.id === r.listingId)?.title.includes("Mug"),
    );
    expect(mug?.publishedClueIds).toEqual([]);
  });
});

describe("ownership matching variants", () => {
  const kit = (id: string, title: string): ProductListing => ({ ...fixtureListings[0]!, id, title });

  it("excludes starter kits worded differently but keeps other kits", () => {
    const listings = [
      kit("a", "Pottery Kit for Beginners"),
      kit("b", "Complete Pottery Starter Kit, 20 Piece"),
      kit("c", "Pottery Tool Kit"),
      kit("d", "Pottery Wheel Starter Class"),
    ];
    const { kept, excluded } = filterListings({ listings, clues: [clueOwnsStarterKit] });
    expect(excluded.map((e) => e.listingId).sort()).toEqual(["a", "b"]);
    expect(kept.map((l) => l.id).sort()).toEqual(["c", "d"]);
  });
});

it("uses both group budget bounds as soft ranking signals, retaining every eligible listing", () => {
  // Different products: ranking keeps one listing per product, so copies of one title would collapse to one.
  const titles = ["Ceramic mug", "Linen apron", "Walnut cutting board"];
  const listings = [1000,5000,20000].map((priceMinor,i) => ({...fixtureListings[0],id:`budget-${i}`,title:titles[i]!,priceMinor,priceStatus:"observed" as const,shippingMinor:0,shippingStatus:"observed" as const})) as ProductListing[];
  const ranked = rankListings({listings,clues:[],budgetGuidance:{lowerMinor:3000,upperMinor:10000,currency:"USD",responseCount:2,participantCount:2,conflicting:false}});
  expect(ranked).toHaveLength(3);
  expect(ranked[0]?.listingId).toBe("budget-1");
  expect(ranked.find(r=>r.listingId==="budget-0")?.budgetFit).toBeLessThan(1);
  expect(ranked.find(r=>r.listingId==="budget-2")?.budgetFit).toBeLessThan(1);
});
