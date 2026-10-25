/**
 * Ring layout for the map-first room (D19). Pure geometry: given room-visible
 * clues and recommended listings, it says where each island floats around
 * the present. Positions are presentation only and never feed back into
 * ranking, selection, budgets or caps.
 *
 * Until the council suggests themes (MAP-008), the middle ring uses the
 * room's three existing clue groups, the same ones as the tower's jars.
 */

export type RingTheme = "interest" | "wish" | "moment";

export const RING_THEMES: Record<RingTheme, { label: string; angle: number }> = {
  // Loves at the top, Wishes lower right, Moments lower left: clear of the room's corner controls.
  interest: { label: "Loves", angle: 255 },
  wish: { label: "Wishes", angle: 38 },
  moment: { label: "Moments", angle: 140 },
};

/** Ring radii in world units around the present, before the sideways stretch. */
export const RING_RADII = { input: 16.5, theme: 12, gift: 8.8 } as const;
/** Rings are ovals: wider than deep, to fill a landscape screen from above. */
export const RING_STRETCH = 1.5;
/** Closest a gift may float to the present without sitting on the main island. */
export const GIFT_MIN_RADIUS = 7.6;
/** Releasing a dragged gift inside this ring distance drops it on the present. */
export const BOX_DROP_RADIUS = 6;
/** How far a drag must move toward or away from the present to count as a vote. */
export const VOTE_DRAG_DISTANCE = 1.6;

export const themeForKind = (kind: string): RingTheme =>
  kind === "explicit_wish" ? "wish" : kind === "interest" ? "interest" : "moment";

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Local (x, z) offset from the present for an angle in degrees and a ring radius. */
export function ringPoint(angle: number, radius: number): [number, number] {
  return [radius * RING_STRETCH * Math.cos(angle * DEG), radius * Math.sin(angle * DEG)];
}

/** Ring distance of a local (x, z) offset, undoing the sideways stretch. */
export function ringDistance(x: number, z: number): number {
  return Math.hypot(x / RING_STRETCH, z);
}

function circularMean(angles: number[]): number {
  let x = 0;
  let y = 0;
  for (const a of angles) {
    x += Math.cos(a * DEG);
    y += Math.sin(a * DEG);
  }
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

export interface RingClueInput {
  id: string;
  kind: string;
}

export interface RingGiftInput {
  listingId: string;
  /** Published clue ids the recommendation cites. */
  clueIds: string[];
  /** Recommendation score, 0..1. */
  score: number;
  up: number;
  down: number;
  /** Someone confirmed she owns it, or the viewer marked it too pricey. */
  resting: boolean;
}

export interface RingLayout {
  clues: { id: string; theme: RingTheme; x: number; z: number }[];
  themes: { id: RingTheme; count: number; x: number; z: number }[];
  gifts: { listingId: string; themes: RingTheme[]; x: number; z: number; radius: number }[];
}

export function layoutRings(clues: readonly RingClueInput[], gifts: readonly RingGiftInput[]): RingLayout {
  const byTheme = new Map<RingTheme, RingClueInput[]>();
  for (const clue of clues) {
    const theme = themeForKind(clue.kind);
    byTheme.set(theme, [...(byTheme.get(theme) ?? []), clue]);
  }

  const outClues: RingLayout["clues"] = [];
  const outThemes: RingLayout["themes"] = [];
  for (const [theme, list] of byTheme) {
    const n = list.length;
    // Spread a theme's clues in an arc around it; long lists also alternate between two radii.
    const step = Math.min(15, 100 / Math.max(1, n));
    list.forEach((clue, i) => {
      const [x, z] = ringPoint(RING_THEMES[theme].angle + (i - (n - 1) / 2) * step, RING_RADII.input + (n > 6 ? (i % 2) * 1.8 : 0));
      outClues.push({ id: clue.id, theme, x, z });
    });
    const [x, z] = ringPoint(RING_THEMES[theme].angle, RING_RADII.theme);
    outThemes.push({ id: theme, count: n, x, z });
  }

  const kindById = new Map(clues.map((c) => [c.id, c.kind]));
  const usedAngles = new Map<number, number>();
  const outGifts = gifts.map((gift, index) => {
    const themes = [...new Set(gift.clueIds.filter((id) => kindById.has(id)).map((id) => themeForKind(kindById.get(id)!)))];
    // Gifts that cite no visible clue have no direction yet, so they share the ring evenly.
    let angle = themes.length ? circularMean(themes.map((t) => RING_THEMES[t].angle)) : 300 + (index * 360) / gifts.length;
    // Gifts that share a direction fan out instead of stacking.
    const key = Math.round(angle / 10);
    const seen = usedAngles.get(key) ?? 0;
    usedAngles.set(key, seen + 1);
    if (seen) angle += (seen % 2 ? 1 : -1) * Math.ceil(seen / 2) * 13;
    const radius = clamp(
      RING_RADII.gift + clamp((0.6 - gift.score) * 6, -2, 3) - clamp(gift.up - gift.down, -3, 3) * 0.9 - (themes.length > 1 ? 1 : 0) + (gift.resting ? 3.5 : 0),
      GIFT_MIN_RADIUS,
      RING_RADII.theme - 1.2,
    );
    const [x, z] = ringPoint(angle, radius);
    return { listingId: gift.listingId, themes, x, z, radius };
  });

  return { clues: outClues, themes: outThemes, gifts: outGifts };
}

export type RingDragResult = "support" | "pass" | "box" | null;

/** What releasing a dragged node means, from its start and end offsets around the present. */
export function dragResult(kind: "clue" | "theme" | "gift", from: [number, number], to: [number, number]): RingDragResult {
  const start = ringDistance(from[0], from[1]);
  const end = ringDistance(to[0], to[1]);
  if (kind === "gift" && end < BOX_DROP_RADIUS) return "box";
  if (end - start < -VOTE_DRAG_DISTANCE) return "support";
  if (end - start > VOTE_DRAG_DISTANCE) return "pass";
  return null;
}

export type RingZone = "box" | "gift" | "theme" | "outer";

/** Zone boundaries, halfway between neighbouring rings. */
export const ZONE_EDGES = {
  box: BOX_DROP_RADIUS,
  gift: (RING_RADII.gift + RING_RADII.theme) / 2,
  theme: (RING_RADII.theme + RING_RADII.input) / 2,
  outer: RING_RADII.input + 3,
} as const;

/** Which zone a local (x, z) offset from the present falls in. Clicking there adds the zone's kind of thing. */
export function zoneAt(x: number, z: number): RingZone {
  const r = ringDistance(x, z);
  return r < ZONE_EDGES.box ? "box" : r < ZONE_EDGES.gift ? "gift" : r < ZONE_EDGES.theme ? "theme" : "outer";
}

/** Prefix that marks a manual clue as a friend's gift idea until the contract has its own kind (MAP-021). */
export const GIFT_IDEA_PREFIX = "Gift idea: ";
export const isGiftIdea = (text: string) => text.startsWith(GIFT_IDEA_PREFIX);
