/**
 * Which gifts the map draws (D23 trial). Pure.
 *
 * Normally every gift is on the map. Only when it gets crowded do gifts fold:
 * each theme keeps its best few, and the rest become one "+N" bundle sitting
 * where they would be. Gifts on the branch in focus, the chosen gift, and any
 * bundle someone opened are always drawn. Nothing is removed from the room.
 */
export const CROWDED_AT = 16;
export const SHOWN_PER_GROUP = 3;
/** Gifts that cite no theme share one group. */
export const LOOSE = "loose";

export interface BundleGift { key: string; listingId: string; themes: readonly string[]; rank: number; x: number; z: number }
export interface GiftBundle { id: string; count: number; x: number; z: number }

export function giftBundles<G extends BundleGift>(gifts: readonly G[], options: {
  selectedListingId?: string;
  highlight?: ReadonlySet<string> | null;
  /** Bundles someone tapped open. */
  open?: ReadonlySet<string>;
} = {}): { shown: G[]; bundles: GiftBundle[] } {
  if (gifts.length <= CROWDED_AT) return { shown: [...gifts], bundles: [] };
  const groups = new Map<string, G[]>();
  for (const g of [...gifts].sort((a, b) => a.rank - b.rank)) {
    const id = g.themes[0] ?? LOOSE;
    groups.set(id, [...(groups.get(id) ?? []), g]);
  }
  const shown: G[] = [];
  const bundles: GiftBundle[] = [];
  for (const [id, list] of groups) {
    const folded: G[] = [];
    list.forEach((g, i) => {
      const keep = i < SHOWN_PER_GROUP || options.open?.has(id) || g.listingId === options.selectedListingId || !!options.highlight?.has(g.key);
      (keep ? shown : folded).push(g);
    });
    if (folded.length) {
      bundles.push({
        id, count: folded.length,
        x: folded.reduce((n, g) => n + g.x, 0) / folded.length,
        z: folded.reduce((n, g) => n + g.z, 0) / folded.length,
      });
    }
  }
  return { shown, bundles };
}
