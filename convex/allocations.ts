/**
 * Deterministic contribution allocation. Owner: Dev 2 (BE-009).
 *
 * P0 rule (docs/COMMERCE_AND_PAYMENTS.md): equal split, capped by each private
 * limit, remainder redistributed to participants with unused capacity until
 * the remainder is 0 or nobody has capacity. Shares must sum exactly to
 * payableTotalMinor. Votes and taste scores never enter this function.
 *
 * Leftover cents that cannot be split evenly go one at a time in participant
 * order: organizer first, then join order. Callers must pass participants in
 * that order.
 *
 * Pure function: no ctx, no I/O, unit-testable.
 */
import type { AllocationShare } from "../lib/contracts";

export interface AllocationInput {
  payableTotalMinor: number;
  /** Ordered by remainder priority: organizer first, then join order. */
  participants: Array<{ participantId: string; limitMinor: number }>;
}

export type AllocationResult =
  | { feasible: true; shares: AllocationShare[] }
  | { feasible: false; reason: "caps_insufficient" | "invalid_input" };

function isMinor(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

export function allocate(input: AllocationInput): AllocationResult {
  const { payableTotalMinor, participants } = input;
  if (!isMinor(payableTotalMinor) || payableTotalMinor === 0) {
    return { feasible: false, reason: "invalid_input" };
  }
  if (participants.length === 0) return { feasible: false, reason: "invalid_input" };
  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.participantId) || !isMinor(p.limitMinor)) {
      return { feasible: false, reason: "invalid_input" };
    }
    seen.add(p.participantId);
  }

  const totalCapacity = participants.reduce((sum, p) => sum + p.limitMinor, 0);
  if (totalCapacity < payableTotalMinor) return { feasible: false, reason: "caps_insufficient" };

  const amounts = participants.map(() => 0);
  let remaining = payableTotalMinor;

  while (remaining > 0) {
    const open: number[] = [];
    participants.forEach((p, i) => {
      if (p.limitMinor - amounts[i]! > 0) open.push(i);
    });
    // Unreachable given the capacity check above; guards against an infinite loop.
    if (open.length === 0) return { feasible: false, reason: "caps_insufficient" };

    const perHead = Math.floor(remaining / open.length);
    if (perHead === 0) {
      for (const i of open) {
        if (remaining === 0) break;
        amounts[i]! += 1;
        remaining -= 1;
      }
      continue;
    }
    for (const i of open) {
      const give = Math.min(perHead, participants[i]!.limitMinor - amounts[i]!);
      amounts[i]! += give;
      remaining -= give;
    }
  }

  return {
    feasible: true,
    shares: participants.map((p, i) => ({ participantId: p.participantId, amountMinor: amounts[i]! })),
  };
}

/** True when two share lists assign the same amounts to the same participants in the same order. */
export function sharesEqual(a: readonly AllocationShare[], b: readonly AllocationShare[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (share, i) => share.participantId === b[i]!.participantId && share.amountMinor === b[i]!.amountMinor,
  );
}
