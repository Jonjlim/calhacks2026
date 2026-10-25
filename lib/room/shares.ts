import type { AllocationShare } from "@/lib/contracts";

/**
 * What an equal split of a total looks like, to the cent. The leftover cents go
 * one each to the first people in the list (the same rule the room's own
 * allocation uses, organizer first), so the parts always add back to the total.
 * Display math only: the shares that count come from the room's allocation.
 */
export function equalSplit(totalMinor: number, ids: readonly string[]): AllocationShare[] {
  if (!ids.length || !Number.isSafeInteger(totalMinor) || totalMinor < 0) return [];
  const base = Math.floor(totalMinor / ids.length);
  const extra = totalMinor - base * ids.length;
  return ids.map((participantId, i) => ({ participantId, amountMinor: base + (i < extra ? 1 : 0) }));
}

export interface SharesSummary {
  sumMinor: number;
  /** The shares add up to the total exactly. */
  adds: boolean;
  /** Every share is within one cent of an equal split. */
  isEqual: boolean;
  /** For each person, how far their share is from an equal one (positive: pays more). */
  deltas: Record<string, number>;
}

export function summarizeShares(totalMinor: number, shares: readonly AllocationShare[]): SharesSummary {
  const sumMinor = shares.reduce((n, s) => n + s.amountMinor, 0);
  const equal = equalSplit(totalMinor, shares.map((s) => s.participantId));
  const deltas: Record<string, number> = {};
  let isEqual = shares.length > 0;
  shares.forEach((s, i) => {
    const d = s.amountMinor - Math.floor(totalMinor / shares.length);
    deltas[s.participantId] = d;
    if (Math.abs(s.amountMinor - (equal[i]?.amountMinor ?? 0)) > 1) isEqual = false;
  });
  return { sumMinor, adds: sumMinor === totalMinor, isEqual, deltas };
}
