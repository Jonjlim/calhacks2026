/**
 * Directions on the gift map (D23 trial). Pure placement and fading rules,
 * shared by the server's catalog and the map so both agree on what is gone.
 * A direction is a council suggestion that combines memories; trend clouds are
 * sourced searches people can catch into the next directions.
 */
import type { TrendDiscoverySample, TrendSuggestion } from "@/lib/contracts";
import { RING_RADII, ringPoint } from "./rings";
import { signalLabel, trendKey } from "./trendIdeas";

/** Passes and pulls on one direction, gift or cloud. */
export interface Tally { up: number; down: number }

/**
 * Passing fades something; it leaves the map once at least half the room has
 * passed and nobody pulled it in. Nothing is deleted, and a pull brings it back.
 */
export function fadeOf(tally: Tally | undefined, members: number): "shown" | "faded" | "gone" {
  if (!tally || tally.down === 0 || tally.up >= tally.down) return "shown";
  return tally.up === 0 && tally.down >= Math.max(1, Math.ceil(members / 2)) ? "gone" : "faded";
}

const DEG = Math.PI / 180;
const angleOf = (x: number, z: number) => ((Math.atan2(z, x / 1.5) / DEG) + 360) % 360;

/** A direction floats between the theme ring and the gifts, at the mean angle of the memories it combines. */
export function directionPoint(memories: readonly { x: number; z: number }[], index: number): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const m of memories) {
    const a = angleOf(m.x, m.z) * DEG;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const angle = memories.length ? ((Math.atan2(sy, sx) / DEG) + 360) % 360 : 300 + index * 40;
  // Neighbouring directions on the same memories step apart instead of stacking.
  return ringPoint(angle + (index % 2 ? 9 : -9) * Math.floor(index / 2), (RING_RADII.theme + RING_RADII.gift) / 2 + 0.3);
}

export interface TrendCloud {
  key: string;
  trendJobId: string;
  query: string;
  sourceUrl: string;
  signal: string;
  publishedClueId: string;
  caught: boolean;
  x: number;
  z: number;
}

/** Clouds in the sky at once: enough to notice, few enough to read. */
export const MAX_DRIFTING = 3;
/** Degrees a drifting cloud travels per second. */
const DRIFT_PER_SECOND = 1.1;

/**
 * Up to three uncaught, unpassed suggestions drift around the outer sky; caught
 * ones rest beside their memory until a direction weaves them in. Passed ones
 * are gone. `now` moves the drift; the same inputs always place the same clouds.
 */
export function trendClouds(
  samples: readonly (Pick<TrendDiscoverySample, "publishedClueId" | "suggestions"> & { jobId: string })[],
  netByKey: Readonly<Record<string, number>>,
  memoryAt: (clueId: string) => { x: number; z: number } | null,
  now: number,
  usedKeys: ReadonlySet<string> = new Set(),
): TrendCloud[] {
  const drifting: TrendCloud[] = [];
  const caught: TrendCloud[] = [];
  const cloud = (sample: (typeof samples)[number], s: TrendSuggestion) => ({
    key: trendKey(sample.jobId, s.query), trendJobId: sample.jobId, query: s.query, sourceUrl: s.sourceUrl,
    signal: signalLabel(s.signals), publishedClueId: sample.publishedClueId,
  });
  // Round-robin across memories, so one memory's searches can't fill the sky.
  const depth = Math.max(0, ...samples.map((sample) => sample.suggestions.length));
  for (let i = 0; i < depth; i++) {
    for (const sample of samples) {
      const s = sample.suggestions[i];
      if (!s) continue;
      const base = cloud(sample, s);
      const net = netByKey[base.key] ?? 0;
      if (net < 0 || usedKeys.has(base.key)) continue;
      if (net > 0) {
        const at = memoryAt(sample.publishedClueId);
        const [x, z] = at
          ? ringPoint(angleOf(at.x, at.z) + 8 + caught.length * 7, RING_RADII.input + 2.6)
          : ringPoint(200 + caught.length * 12, RING_RADII.input + 2.6);
        caught.push({ ...base, caught: true, x, z });
      } else if (drifting.length < MAX_DRIFTING) {
        const angle = (drifting.length * (360 / MAX_DRIFTING) + 20 + (now / 1000) * DRIFT_PER_SECOND) % 360;
        const [x, z] = ringPoint(angle, RING_RADII.input + 3.4 + (drifting.length % 2) * 0.8);
        drifting.push({ ...base, caught: false, x, z });
      }
    }
  }
  return [...caught.slice(0, MAX_DRIFTING), ...drifting];
}

/** Enough threads to read as considering, few enough to stay calm. */
export const MAX_REACH = 14;
export const MAX_FRAYED = 3;

export interface WeaveThreadSpec { from: string; to: string; mode: "reach" | "kept" | "frayed"; label?: string; delay?: number }
export interface WeaveState { id: number; phase: "reaching" | "weaving"; since: number; fresh: string[] }

/**
 * The weave's threads, by node key (D23 trial). Every thread is a real link:
 * while the council thinks, memories reach toward two neighbours each; when it
 * answers, each new direction gathers the memories it actually combines, and
 * up to three refused ideas fray between the memories they cited, labelled
 * with the checks' reason. Opening a direction grows its own threads again.
 */
export function weaveThreads({ weave, memoryKeys, directions, trail, selectedKey }: {
  weave: WeaveState | null;
  memoryKeys: readonly string[];
  directions: readonly { id: string; key: string; clueIds: readonly string[] }[];
  trail: readonly { actor: string; outcome: string; at: number; text: string; clueIds?: readonly string[] }[];
  selectedKey: string | null;
}): { id: number; threads: WeaveThreadSpec[] } | null {
  if (weave?.phase === "reaching") {
    if (memoryKeys.length < 2) return null;
    const threads: WeaveThreadSpec[] = [];
    const seen = new Set<string>();
    memoryKeys.forEach((from, i) => {
      for (const step of [1, 2]) {
        const to = memoryKeys[(i + step) % memoryKeys.length]!;
        const pair = [from, to].sort().join("|");
        if (to === from || seen.has(pair) || threads.length >= MAX_REACH) continue;
        seen.add(pair);
        threads.push({ from, to, mode: "reach", delay: (i % 5) * 0.15 });
      }
    });
    return { id: weave.id, threads };
  }
  if (weave?.phase === "weaving") {
    const threads: WeaveThreadSpec[] = [];
    directions.filter((d) => weave.fresh.includes(d.id)).forEach((d, i) => {
      d.clueIds.forEach((id, j) => threads.push({ from: `clue:${id}`, to: d.key, mode: "kept", delay: i * 0.35 + j * 0.12 }));
    });
    trail.filter((e) => e.actor === "checks" && e.outcome === "rejected" && e.at >= weave.since - 2000 && (e.clueIds?.length ?? 0) >= 2)
      .slice(-MAX_FRAYED).forEach((e, i) => {
        const [a, b] = e.clueIds!;
        threads.push({ from: `clue:${a}`, to: `clue:${b}`, mode: "frayed", delay: 0.6 + i * 0.4, label: e.text.replace(/^Threw out “[^”]*”: /, "").replace(/\.$/, "") });
      });
    return { id: weave.id, threads };
  }
  if (selectedKey?.startsWith("direction:")) {
    const d = directions.find((n) => n.key === selectedKey);
    if (d) return { id: d.clueIds.length * 7919 + d.key.length, threads: d.clueIds.map((id, j) => ({ from: `clue:${id}`, to: d.key, mode: "kept", delay: j * 0.12 })) };
  }
  return null;
}

