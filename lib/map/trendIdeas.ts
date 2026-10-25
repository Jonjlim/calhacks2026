/**
 * Trend sprouts on the gift map. Pure placement and labels: a sourced Google
 * Trends suggestion floats between the memory it came from and the gift ring.
 * It is a search direction, never a recipient clue or a claim that a product trends.
 */
import type { TrendSignal, TrendSuggestion } from "@/lib/contracts";
import { RING_RADII, ringPoint } from "./rings";

export const TREND_KEY_PREFIX = "trend:";
export const trendKey = (trendJobId: string, query: string) => `${TREND_KEY_PREFIX}${trendJobId}:${query}`;
export const isTrendKey = (key: string) => key.startsWith(TREND_KEY_PREFIX);

export interface TrendIdeaNode {
  key: string;
  trendJobId: string;
  query: string;
  sourceUrl: string;
  signal: string;
  x: number;
  z: number;
}

/** Short, honest label for the strongest observed signal. Search interest, not sales. */
export function signalLabel(signals: readonly TrendSignal[]): string {
  if (signals.some((s) => s.kind === "breakout_search")) return "breakout search";
  const growth = Math.max(...signals.map((s) => s.growthPercent ?? 0));
  if (growth > 0) return `searches +${growth}%`;
  return signals.some((s) => s.kind === "rising_search") ? "rising search" : "related search";
}

/**
 * Places up to five suggestions in a small fan at the source memory's angle,
 * between the theme ring and the gift ring. They step to either side of that
 * angle rather than sitting on it, because the theme's label cloud sits right
 * there; a fifth goes nearer the gift ring. Passed ideas stay; the map fades them.
 */
const FAN = [[-13, 0], [13, 0], [-19.5, 0.4], [19.5, 0.4], [0, -0.9]] as const;
export function layoutTrendIdeas(
  trendJobId: string,
  suggestions: readonly TrendSuggestion[],
  source: { x: number; z: number } | null,
): TrendIdeaNode[] {
  const visible = suggestions.slice(0, 5);
  const angle = source ? (Math.atan2(source.z, source.x / 1.5) * 180) / Math.PI : 300;
  const radius = RING_RADII.gift + 0.9;
  return visible.map((s, i) => {
    const [offset, step] = FAN[i]!;
    const [x, z] = ringPoint(angle + offset, radius + step);
    return { key: trendKey(trendJobId, s.query), trendJobId, query: s.query, sourceUrl: s.sourceUrl, signal: signalLabel(s.signals), x, z };
  });
}
