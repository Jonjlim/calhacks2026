/**
 * Deterministic recommendation scoring. Owner: Dev 4 (RC-005).
 * score = personalRelevance * 0.7 + budgetFit * 0.2 + trendSignal * 0.1
 * trendSignal stays 0 unless a sourced TrendObservation exists.
 * Exclusion clues filter a listing out or force score 0.
 */

export const SCORE_WEIGHTS = {
  personalRelevance: 0.7,
  budgetFit: 0.2,
  trendSignal: 0.1,
} as const;

export function combineScore(parts: {
  personalRelevance: number;
  budgetFit: number;
  trendSignal: number;
}): number {
  return (
    parts.personalRelevance * SCORE_WEIGHTS.personalRelevance +
    parts.budgetFit * SCORE_WEIGHTS.budgetFit +
    parts.trendSignal * SCORE_WEIGHTS.trendSignal
  );
}
