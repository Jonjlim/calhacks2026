import type { CouncilActor } from "./contracts";

/**
 * Where the council robots stand and walk on the main island of the gift map.
 * Pure geometry in the island's local plane (x, z offsets from the present).
 *
 * Friends stand round the present at radius 2.45-2.8 (stageLayout gardenSpots)
 * with their mini spirits, so robots keep outside BAND_OUTER: they have homes
 * on an outer ring, travel along an orbit just beyond the friends, and leave
 * it on a straight spoke to whatever they are working on.
 */

export type P2 = readonly [number, number];

/** Nothing a robot walks may come closer to the present than this. */
export const BAND_OUTER = 3.0;
/** Inner edge of the friends' band; the present and its pedestal are inside it. */
export const BAND_INNER = 2.3;
export const ORBIT_RADIUS = 3.4;
export const ORBIT_NODES = 8;
/** Two work targets closer than this are one node: only one robot may stand there. */
export const SAME_NODE = 1.0;

/** Island landmarks robots step round, local to the present: x, z, radius. Tower body (its door is ~0.8 out), cottage. */
export const OBSTACLES: readonly (readonly [number, number, number])[] = [
  [-4.1, -2.1, 1.0],
  [4.3, -2.0, 1.2],
];

const DEG = Math.PI / 180;
const polar = (deg: number, r: number): P2 => [Math.cos(deg * DEG) * r, Math.sin(deg * DEG) * r];

/**
 * Home perches, each in its role's sector: Archivist toward the memories on
 * the left, Muse back left toward the top themes, Scout front right toward
 * the gifts, Keeper behind the present, Courier by the tower door.
 */
export const HOMES: Record<CouncilActor, P2> = {
  archivist: polar(155, 4.4),
  muse: polar(240, 4.2),
  scout: polar(30, 4.4),
  keeper: polar(275, 4.2),
  courier: polar(185, 4.1),
};

/** Where the Keeper stands "at the box": just behind the present, outside the friends' band. */
export const BOX_SPOT: P2 = polar(270, ORBIT_RADIUS);

export const ORBIT: readonly P2[] = Array.from({ length: ORBIT_NODES }, (_, i) => polar(22.5 + (360 / ORBIT_NODES) * i, ORBIT_RADIUS));

/** A wider ring, only so a walk can step round the far side of a landmark. */
const OUTER: readonly P2[] = Array.from({ length: 12 }, (_, i) => polar(15 + 30 * i, 6.2));

const len = (p: P2) => Math.hypot(p[0], p[1]);
export const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Closest distance from point c to the segment a-b. */
export function segmentDistance(a: P2, b: P2, c: P2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dz) / l2)) : 0;
  return Math.hypot(a[0] + dx * t - c[0], a[1] + dz * t - c[1]);
}

/** A straight walk that stays outside the friends' band and clear of every landmark. */
export function segmentClear(a: P2, b: P2): boolean {
  if (segmentDistance(a, b, [0, 0]) < BAND_OUTER - 1e-9) return false;
  return OBSTACLES.every(([x, z, r]) => segmentDistance(a, b, [x, z]) >= r);
}

/** A point robots may stand on: pushed out of the band along its own bearing, and out of landmarks. */
export function standable(p: P2, fallbackDeg = 90): P2 {
  let q: P2 = p;
  const r = len(q);
  if (r < ORBIT_RADIUS) q = r < 1e-3 ? polar(fallbackDeg, ORBIT_RADIUS) : [(q[0] / r) * ORBIT_RADIUS, (q[1] / r) * ORBIT_RADIUS];
  for (const [x, z, rad] of OBSTACLES) {
    const d = dist(q, [x, z]);
    if (d < rad + 0.15) {
      const k = (rad + 0.15) / Math.max(d, 1e-3);
      q = [x + (q[0] - x) * k, z + (q[1] - z) * k];
    }
  }
  return q;
}

/**
 * Shortest walk from one point to another over the waypoint graph (homes,
 * orbit nodes, plus the two ends). Every leg passes `segmentClear`; the
 * result starts at `from` and ends at `to`. An end inside the band or a
 * landmark is first moved out with `standable`.
 */
export function routeTo(from: P2, to: P2): P2[] {
  const a = segmentClear(from, from) ? from : standable(from);
  const b = segmentClear(to, to) ? to : standable(to);
  const nodes: P2[] = [a, b, ...ORBIT, ...Object.values(HOMES), ...OUTER];
  const n = nodes.length;
  const best = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  best[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      const w = dist(nodes[u]!, nodes[v]!);
      if (best[u]! + w < best[v]! && segmentClear(nodes[u]!, nodes[v]!)) {
        best[v] = best[u]! + w;
        prev[v] = u;
      }
    }
  }
  const out: P2[] = [];
  if (best[1] === Infinity) return [a, b];
  for (let i = 1; i >= 0; i = prev[i]!) out.unshift(nodes[i]!);
  if (a !== from) out.unshift(from);
  return out;
}

export const pathLength = (path: readonly P2[]) => path.slice(1).reduce((n, p, i) => n + dist(path[i]!, p), 0);

export interface TargetRequest {
  actor: CouncilActor;
  target: P2;
  /** When the claim began (event sequence or time); earlier claims keep the node. */
  since: number;
}

/**
 * One robot per work node: the earliest claim stands at its target; anyone
 * whose target is the same node waits at the closest free orbit node instead.
 */
export function assignTargets(requests: readonly TargetRequest[]): Partial<Record<CouncilActor, { at: P2; waiting: boolean }>> {
  const out: Partial<Record<CouncilActor, { at: P2; waiting: boolean }>> = {};
  const taken: P2[] = [];
  const sorted = [...requests].sort((x, y) => x.since - y.since || x.actor.localeCompare(y.actor));
  for (const r of sorted) {
    const at = standable(r.target);
    if (!taken.some((t) => dist(t, at) < SAME_NODE)) {
      taken.push(at);
      out[r.actor] = { at, waiting: false };
      continue;
    }
    const free = ORBIT.filter((o) => !taken.some((t) => dist(t, o) < SAME_NODE)).sort((p, q) => dist(p, at) - dist(q, at))[0];
    const wait = free ?? standable(HOMES[r.actor]);
    taken.push(wait);
    out[r.actor] = { at: wait, waiting: true };
  }
  return out;
}

/** Walks a path: the point at `s` units along it and the heading of that leg. */
export function pointAlong(path: readonly P2[], s: number): { p: P2; dir: P2; end: boolean } {
  let left = Math.max(0, s);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const d = dist(a, b);
    if (left <= d && d > 0) {
      const k = left / d;
      return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], dir: [(b[0] - a[0]) / d, (b[1] - a[1]) / d], end: false };
    }
    left -= d;
  }
  const last = path[path.length - 1]!;
  const pre = path[path.length - 2] ?? last;
  const d = dist(pre, last) || 1;
  return { p: last, dir: [(last[0] - pre[0]) / d, (last[1] - pre[1]) / d], end: true };
}
