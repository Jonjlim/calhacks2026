export type TreePoint = [number, number, number];
const MEMORY: TreePoint[] = [[-5.4, 1.8, -1.2], [-5.4, -1.2, 2.4], [-3.1, 3.7, -3.7]];
const PRODUCT: TreePoint[] = [[6, 3, -3.2], [5.7, 1, .1], [5.8, -1.4, 3.2]];
const SPROUT: TreePoint[] = [[1.4, 4.8, -5.8], [-.2, 3.4, -.9]];
export const ROOT: TreePoint = [0, -1.8, 3];
export const JUNCTION: TreePoint = [0, 1.1, .1];
export const TREE_PAGE_SIZE = 3;
export function pageItems<T>(rows: readonly T[], page: number, size = TREE_PAGE_SIZE): T[] {
  const last = Math.max(0, Math.ceil(rows.length / size) - 1);
  const start = Math.max(0, Math.min(page, last)) * size;
  return rows.slice(start, start + size);
}
export function treePoint(kind: "memory" | "product" | "sprout", index: number, pulled = false): TreePoint {
  const points = kind === "memory" ? MEMORY : kind === "product" ? PRODUCT : SPROUT;
  const point = points[index % points.length]!;
  return kind === "product" && pulled ? [point[0] - .8, point[1] + .2, point[2]] : [...point];
}
export const VIBES: Record<string, readonly string[]> = {
  handmade: ["hand", "craft", "ceramic", "pottery", "clay", "workshop"],
  cozy: ["cozy", "warm", "soft", "knit", "blanket", "tea", "slipper"],
  outdoorsy: ["hike", "trail", "camp", "outdoor", "park", "mountain"],
  experiences: ["class", "workshop", "session", "lesson", "ticket", "tour"],
};
/** A visual heuristic only. It never changes ranking, evidence, or anyone's budget. */
export function matchesVibe(title: string, vibe: string | null): boolean {
  return !!vibe && (VIBES[vibe] ?? []).some(word => title.toLowerCase().includes(word));
}
