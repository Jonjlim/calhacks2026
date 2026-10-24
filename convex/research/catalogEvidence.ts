/**
 * Reviewed product identities, not a seller/query classifier. No runtime I/O.
 * Only category/manufacturer/tool facts live here; never price/stock/trend facts.
 */
import type { ProductListing } from "../../lib/contracts";

export interface CatalogEvidence {
  readonly productKey: string;
  readonly manufacturer: string;
  readonly category: "pottery";
  readonly terms: readonly string[];
  readonly handsOn: true;
  readonly sourceUrl: string;
  readonly checkedOn: string;
  readonly basis: string;
}

interface CatalogEntry extends CatalogEvidence {
  readonly title: string;
}

const CATALOG: readonly CatalogEntry[] = [
  {
    productKey: "mkm-bhr-051", title: "BHR-051 Big Hand Roller – Zig Zag Spiral",
    manufacturer: "MKM", category: "pottery", terms: ["pottery", "tool", "mkm"], handsOn: true,
    sourceUrl: "https://mkmpotterytools.com/product/bhr-051-big-handroller-zig-zag-spiral/",
    checkedOn: "2026-10-24",
    basis: "MKM describes this model as a tool for adding patterns to clay and thrown pots",
  },
  {
    productKey: "mkm-dd-10", title: "DD-10 MKM Decorating Disk - 10 inch (25.4 cm) diameter",
    manufacturer: "MKM", category: "pottery", terms: ["pottery", "tool", "mkm"], handsOn: true,
    sourceUrl: "https://mkmpotterytools.com/product/dd-10-mkm-decorating-disk-10-inch-25-4-cm-diameter/",
    checkedOn: "2026-10-24",
    basis: "MKM describes this model as a tool for dividing and marking thrown pottery",
  },
];

function titleKey(title: string): string {
  return title.toLowerCase()
    .replace(/\b(bhr|dd)\s*[-–—]?\s*(\d+)\b/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

const BY_TITLE = new Map(CATALOG.map(entry => [titleKey(entry.title), entry]));

/** Entire title must match; no prefix/substring matching or inherited variant facts. */
export function catalogEvidenceFor(listing: Pick<ProductListing, "title" | "variant">): CatalogEvidence | undefined {
  if (listing.variant?.trim()) return undefined;
  const entry = BY_TITLE.get(titleKey(listing.title));
  if (!entry) return undefined;
  const { title: _, ...evidence } = entry;
  return evidence;
}
