import type { GroupBudgetGuidance } from "./contracts";
export const MAX_MEMBER_BUDGET = 10_000_000;
export function validBudgetRange(min: number, max: number): boolean {
  return Number.isSafeInteger(min) && Number.isSafeInteger(max) && min >= 0 && max >= min && max <= MAX_MEMBER_BUDGET;
}
export function groupBudgetGuidance(ranges: readonly { minMinor: number; maxMinor: number }[], participantCount: number): GroupBudgetGuidance | undefined {
  if (!ranges.length || !participantCount) return undefined;
  const lowerMinor = Math.round(ranges.reduce((sum, r) => sum + r.minMinor, 0) / ranges.length);
  const upperMinor = Math.min(...ranges.map(r => r.maxMinor)) * participantCount;
  return { lowerMinor, upperMinor, currency: "USD", responseCount: ranges.length, participantCount, conflicting: lowerMinor > upperMinor };
}
