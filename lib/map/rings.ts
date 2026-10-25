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
export const RING_RADII = { input: 26, theme: 19, gift: 12.8 } as const;
/** Rings are ovals: wider than deep, to fill a landscape screen from above. */
export const RING_STRETCH = 1.5;
/** Closest a gift may float to the present without sitting on the main island. */
export const GIFT_MIN_RADIUS = 9.8;
/** Releasing a dragged gift inside this ring distance drops it on the present. */
export const BOX_DROP_RADIUS = 6;
/** How far a drag must move toward or away from the present to count as a vote. */
export const VOTE_DRAG_DISTANCE = 1.6;
/** Degrees between neighbouring clues around a theme. Fixed, so a new clue never moves the others. */
export const CLUE_STEP = 16;

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
  /** A sharpen round is open and this gift is not a finalist. */
  faded?: boolean;
  /** The sharpen answer favoured this gift. */
  favored?: boolean;
}

/** A council theme: a label and the published clues it groups. */
export interface RingThemeInput {
  id: string;
  label: string;
  clueIds: string[];
}

export interface RingLayoutOptions {
  /** Council themes (MAP-008). Memories no theme holds yet float on their own (D23 trial: no kind buckets). */
  themes?: readonly RingThemeInput[];
  /** Net pull per clue or theme id: positive is toward the present (MAP-012). */
  signals?: { clue?: Readonly<Record<string, number>>; theme?: Readonly<Record<string, number>> };
}

export interface RingLayout {
  clues: { id: string; theme: string; x: number; z: number }[];
  themes: { id: string; label: string; count: number; angle: number; x: number; z: number; bucket: RingTheme | null }[];
  gifts: { listingId: string; themes: string[]; x: number; z: number; radius: number }[];
}

/** Id of the theme that collects clues no council theme picked up. */
export const OTHER_THEME = "other";
/** A memory no theme holds yet: it floats on its own until the council's next regroup (D23 trial). */
export const UNGROUPED = "";
/** Spacing for floating memories: each new one takes the next seat, so earlier ones never move. */
const GOLDEN_ANGLE = 137.508;

export function layoutRings(clues: readonly RingClueInput[], gifts: readonly RingGiftInput[], options: RingLayoutOptions = {}): RingLayout {
  const pullClue = (id: string) => clamp(options.signals?.clue?.[id] ?? 0, -2, 2);
  const pullTheme = (id: string) => clamp(options.signals?.theme?.[id] ?? 0, -2, 2);

  // Which theme each clue belongs to, and where each theme sits around the present.
  const themeOf = new Map<string, string>();
  const themeInfo: { id: string; label: string; angle: number; bucket: RingTheme | null }[] = [];
  const council = (options.themes ?? []).filter((t) => t.clueIds.length);
  // Memories show as they are until the council groups them; themes form on their own (D23 trial).
  if (council.length) {
    const visible = new Set(clues.map((c) => c.id));
    for (const t of council) for (const id of t.clueIds) if (visible.has(id) && !themeOf.has(id)) themeOf.set(id, t.id);
    const used = council.filter((t) => t.clueIds.some((id) => themeOf.get(id) === t.id));
    used.forEach((t, i) => themeInfo.push({ id: t.id, label: t.label, angle: (255 + (i * 360) / used.length) % 360, bucket: null }));
  }
  for (const c of clues) if (!themeOf.has(c.id)) themeOf.set(c.id, UNGROUPED);
  const angleOf = new Map(themeInfo.map((t) => [t.id, t.angle]));

  const outClues: RingLayout["clues"] = [];
  const outThemes: RingLayout["themes"] = [];
  for (const t of themeInfo) {
    const list = clues.filter((c) => themeOf.get(c.id) === t.id);
    // Each clue keeps its seat as more arrive: 0, +1, −1, +2, −2… steps around its theme,
    // and later ones step outward a row instead of squeezing the arc.
    list.forEach((clue, i) => {
      const slot = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      const row = Math.floor(Math.abs(slot) / 4);
      const angle = t.angle + slot * CLUE_STEP - Math.sign(slot) * row * 4 * CLUE_STEP + (row ? Math.sign(slot) * CLUE_STEP / 2 : 0);
      const [x, z] = ringPoint(angle, RING_RADII.input + row * 2.2 - pullClue(clue.id) * 0.8);
      outClues.push({ id: clue.id, theme: t.id, x, z });
    });
    const [x, z] = ringPoint(t.angle, RING_RADII.theme - pullTheme(t.id) * 0.7);
    outThemes.push({ id: t.id, label: t.label, count: list.length, angle: t.angle, x, z, bucket: t.bucket });
  }

  // Floating memories: steady seats spread round the outer ring, a little in and out so they read as separate.
  clues.filter((c) => themeOf.get(c.id) === UNGROUPED).forEach((clue, i) => {
    const [x, z] = ringPoint(255 + i * GOLDEN_ANGLE, RING_RADII.input + (i % 2 ? 1 : -0.4) - pullClue(clue.id) * 0.8);
    outClues.push({ id: clue.id, theme: UNGROUPED, x, z });
  });

  const usedAngles = new Map<number, number>();
  const outGifts = gifts.map((gift, index) => {
    const themes = [...new Set(gift.clueIds.map((id) => themeOf.get(id)).filter((t): t is string => !!t))];
    // Gifts that cite no visible clue have no direction yet, so they share the ring evenly.
    let angle = themes.length ? circularMean(themes.map((t) => angleOf.get(t) ?? 0)) : 300 + index * 47;
    // Gifts that share a direction fan out instead of stacking.
    const key = Math.round(angle / 10);
    const seen = usedAngles.get(key) ?? 0;
    usedAngles.set(key, seen + 1);
    if (seen) angle += (seen % 2 ? 1 : -1) * Math.ceil(seen / 2) * 13;
    const themePull = clamp(themes.reduce((n, t) => n + pullTheme(t), 0), -3, 3);
    const radius = gift.favored
      ? GIFT_MIN_RADIUS
      : clamp(
          RING_RADII.gift + clamp((0.6 - gift.score) * 6, -2, 3) - clamp(gift.up - gift.down, -3, 3) * 0.9 - themePull * 0.5 - (themes.length > 1 ? 1 : 0) + (gift.resting ? 3.5 : 0) + (gift.faded ? 2.5 : 0),
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
