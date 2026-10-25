import { CONVERGENCE_TIMES } from "./timeline";

/**
 * Turns what the room really published into the little objects that fly into
 * the present. Only published, active memories and friends' gift ideas appear,
 * plus the real product ideas the room considered; nothing is invented. The
 * same room data always produces the same artifacts, with the same timing.
 */

export type ArtifactShape = "heart" | "note" | "letter" | "charm" | "star" | "brush" | "tag" | "leaf";
export type ArtifactSource = "memory" | "wish" | "idea" | "gift";

export interface ArtifactInput {
  /** Matches the ring node key: `clue:<id>`, `idea:<id>`, `gift:<listingId>`. */
  key: string;
  source: ArtifactSource;
  text: string;
  /** Where its island floats, as an offset from the present on the map (world units). */
  x: number;
  z: number;
  /** Cited by the selected gift's recommendation. */
  supports?: boolean;
}

export interface Artifact {
  key: string;
  shape: ArtifactShape;
  wave: 1 | 2 | 3;
  color: string;
  label: string;
  x: number;
  z: number;
  supports: boolean;
  /** Seconds on the convergence timeline: lifts off, and drops into the box. */
  start: number;
  arrive: number;
  /** Seeded variation, 0..1, for the arc's height, sideways swing and spin. */
  swing: number;
  lift: number;
  spin: number;
}

/** Most artifacts shown at once; the rest are counted, not drawn. */
export const MAX_ARTIFACTS = 24;

const COLORS = ["#f2d27a", "#f3b9c4", "#a9cde6", "#d9c8ff", "#ffc2b3", "#fff1c2"];

/** A small symbolic object for what the text is about; a folded note when nothing fits. */
export function symbolFor(text: string, source: ArtifactSource): ArtifactShape {
  if (source === "idea" || source === "gift") return "tag";
  if (source === "wish") return "letter";
  const t = text.toLowerCase();
  if (/(pott|ceram|clay|mug|vase|wheel)/.test(t)) return "charm";
  if (/(paint|draw|sketch|art\b|brush|watercolor|illustrat)/.test(t)) return "brush";
  if (/(plant|garden|flower|leaf|tree|herb|succulent)/.test(t)) return "leaf";
  if (/(star|moon|night|stargaz|astro|space)/.test(t)) return "star";
  return "note";
}

/** Deterministic hash → 0..1. */
export function seeded(key: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const waveOf = (source: ArtifactSource): 1 | 2 | 3 => (source === "memory" ? 1 : source === "wish" ? 2 : 3);
/** When the arrivals of each wave begin and end. They overlap a little. */
const WAVE_WINDOWS: Record<1 | 2 | 3, [number, number]> = { 1: [1.3, 2.4], 2: [1.9, 3.0], 3: [2.5, CONVERGENCE_TIMES.wallsClose[0] - 0.12] };
/** Seconds a flight takes, from a short hop to a long arc across the map. */
const flight = (distance: number) => Math.min(1.9, 0.85 + distance * 0.04);
const EARLIEST = 0.45;

export function buildArtifacts(inputs: readonly ArtifactInput[]): { artifacts: Artifact[]; total: number } {
  const total = inputs.length;
  // Everything the chosen gift's reasoning cites is kept, then the rest are spread evenly.
  const must = inputs.filter((i) => i.supports);
  const rest = inputs.filter((i) => !i.supports);
  const room = Math.max(0, MAX_ARTIFACTS - must.length);
  const stride = rest.length > room && room > 0 ? rest.length / room : 1;
  const picked = [...must, ...(room > 0 ? Array.from({ length: Math.min(room, rest.length) }, (_, k) => rest[Math.floor(k * stride)]!) : [])];

  const byWave: Record<1 | 2 | 3, ArtifactInput[]> = { 1: [], 2: [], 3: [] };
  for (const item of picked) byWave[waveOf(item.source)].push(item);

  const artifacts: Artifact[] = [];
  for (const wave of [1, 2, 3] as const) {
    // Nearest first, so a wave rolls in from the middle outward.
    const items = byWave[wave].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || a.key.localeCompare(b.key));
    const [from, to] = WAVE_WINDOWS[wave];
    items.forEach((item, i) => {
      const n = items.length;
      const share = n === 1 ? 0.5 : i / (n - 1);
      const jitter = (seeded(item.key, 3) - 0.5) * Math.min(0.12, (to - from) / (n + 1));
      const arrive = Math.min(to, Math.max(from, from + share * (to - from) + jitter));
      const distance = Math.hypot(item.x, item.z);
      const start = Math.max(EARLIEST + wave * 0.05, arrive - flight(distance));
      artifacts.push({
        key: item.key,
        shape: symbolFor(item.text, item.source),
        wave,
        color: COLORS[Math.floor(seeded(item.key, 1) * COLORS.length)]!,
        label: item.text,
        x: item.x,
        z: item.z,
        supports: !!item.supports,
        start,
        arrive,
        swing: seeded(item.key, 5) * 2 - 1,
        lift: 0.7 + seeded(item.key, 7) * 0.6,
        spin: (seeded(item.key, 9) * 2 - 1) * 4,
      });
    });
  }
  return { artifacts, total };
}

/** Share of the artifacts that have landed by `t` (0..1). 1 when there are none. */
export function filledAt(artifacts: readonly Artifact[], t: number): number {
  if (!artifacts.length) return 1;
  let n = 0;
  for (const a of artifacts) if (t >= a.arrive) n++;
  return n / artifacts.length;
}
