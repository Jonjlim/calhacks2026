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
 * halfway between the theme ring and the gift ring. Passed ideas stay; the map fades them.
 */
export function layoutTrendIdeas(
  trendJobId: string,
  suggestions: readonly TrendSuggestion[],
  source: { x: number; z: number } | null,
): TrendIdeaNode[] {
  const visible = suggestions.slice(0, 5);
  const angle = source ? (Math.atan2(source.z, source.x / 1.5) * 180) / Math.PI : 300;
  const radius = (RING_RADII.theme + RING_RADII.gift) / 2 + 0.6;
  return visible.map((s, i) => {
    const [x, z] = ringPoint(angle + (i - (visible.length - 1) / 2) * 14, radius + (i % 2) * 1.1);
    return { key: trendKey(trendJobId, s.query), trendJobId, query: s.query, sourceUrl: s.sourceUrl, signal: signalLabel(s.signals), x, z };
  });
}
