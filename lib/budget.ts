/**
 * The group's gift budget, worked out from what each friend is comfortable
 * with. Each friend gives a range (a lowest and a highest amount). The room's
 * SOFT maximum is the lowest of everyone's highest amounts, times the number of
 * friends (so nobody is asked to stretch past their own highest figure), and the
 * SOFT minimum is the average of everyone's lowest amounts. Both are soft: they
 * steer which gifts are ranked higher and are never used to hide a gift or to
 * refuse one. Pure, so the server, the page and the tests agree.
 */
export interface BudgetRange {
  minMinor: number;
  maxMinor: number;
}

export interface SoftBudget {
  minMinor: number;
  maxMinor: number;
  /** Friends whose range counted. */
  count: number;
}

export function validRange(r: BudgetRange): boolean {
  return Number.isSafeInteger(r.minMinor) && Number.isSafeInteger(r.maxMinor) && r.minMinor >= 0 && r.maxMinor > 0 && r.minMinor <= r.maxMinor && r.maxMinor <= 10_000_000;
}

/** `friends` is how many people are in the room; `ranges` are those who have given one (a subset). */
export function softBudget(ranges: readonly BudgetRange[], friends: number): SoftBudget | null {
  const given = ranges.filter(validRange);
  if (!given.length) return null;
  const n = Math.max(friends, given.length);
  const maxMinor = Math.min(...given.map((r) => r.maxMinor)) * n;
  const mean = given.reduce((sum, r) => sum + r.minMinor, 0) / given.length;
  // The soft minimum can never sit above the soft maximum.
  return { minMinor: Math.min(Math.round(mean), maxMinor), maxMinor, count: given.length };
}
