/**
 * Deterministic contribution allocation. Owner: Dev 2 (BE-009).
 *
 * P0 rule (docs/COMMERCE_AND_PAYMENTS.md): equal split, capped by each private
 * limit, remainder redistributed to participants with unused capacity until
 * the remainder is 0 or nobody has capacity. Shares must sum exactly to
 * payableTotalMinor. Votes and taste scores never enter this function.
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

export function allocate(_input: AllocationInput): AllocationResult {
  // TODO(BE-009): implement with unit tests for happy split and infeasible caps.
  return { feasible: false, reason: "invalid_input" };
}
