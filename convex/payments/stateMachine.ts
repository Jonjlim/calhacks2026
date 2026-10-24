/**
 * P1-B payment state machine. Owner: Dev 2 (BE-015). Adapter: Dev 4.
 *
 * Pure functions only: no ctx, no I/O. Convex mutations in ./state.ts apply
 * them. Stripe is authoritative for provider objects, so transitions that look
 * like a "rewind" (capture_pending → authorized after a failed capture,
 * cancellation_pending → captured after losing a race) are allowed: we record
 * what the provider says, then the group status reacts.
 *
 * Group capture is never atomic. A failure during capture moves the revision
 * to recovery_pending, which cancels uncaptured authorizations and refunds
 * captured ones until every attempt is terminal.
 */
import type { PaymentAttemptStatus, ProposalStatus } from "../../lib/contracts";

export const TERMINAL_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = [
  "authorization_failed",
  "canceled",
  "refunded",
];

const ATTEMPT_TRANSITIONS: Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]> = {
  not_started: ["authorization_pending", "canceled"],
  authorization_pending: [
    "authorized",
    "authorization_failed",
    "action_required",
    "cancellation_pending",
    "canceled",
    "uncertain",
  ],
  action_required: [
    "authorization_pending",
    "authorized",
    "authorization_failed",
    "cancellation_pending",
    "canceled",
    "uncertain",
  ],
  authorized: ["capture_pending", "cancellation_pending", "canceled", "uncertain"],
  capture_pending: ["captured", "authorized", "canceled", "uncertain"],
  captured: ["refund_pending", "refunded", "uncertain"],
  cancellation_pending: ["canceled", "authorized", "captured", "uncertain"],
  refund_pending: ["refunded", "captured", "uncertain"],
  uncertain: [
    "authorization_pending",
    "authorized",
    "authorization_failed",
    "action_required",
    "capture_pending",
    "captured",
    "cancellation_pending",
    "canceled",
    "refund_pending",
    "refunded",
  ],
  authorization_failed: [],
  canceled: [],
  refunded: [],
};

export function isTerminalAttempt(status: PaymentAttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.includes(status);
}

export function canTransitionAttempt(from: PaymentAttemptStatus, to: PaymentAttemptStatus): boolean {
  return ATTEMPT_TRANSITIONS[from].includes(to);
}

/** Pre-capture payment phases. Edits are still allowed and cancel live authorizations. */
export const PRE_CAPTURE_STATUSES: readonly ProposalStatus[] = ["authorizing", "ready_to_capture", "blocked"];

/** Once capture starts the revision is frozen until it is funded or fully recovered. */
export const FROZEN_STATUSES: readonly ProposalStatus[] = ["capturing", "test_funded", "recovery_pending"];

/** Revisions whose live attempts must be unwound (cancel uncaptured, refund captured). */
const UNWIND_STATUSES: readonly ProposalStatus[] = ["superseded", "canceled", "recovery_pending"];

export interface AttemptLike {
  participantId: string;
  status: PaymentAttemptStatus;
}

export interface ShareLike {
  participantId: string;
  amountMinor: number;
}

/** Participants who owe money on the revision. Zero shares never need an attempt. */
export function payerIds(shares: readonly ShareLike[]): string[] {
  return shares.filter((s) => s.amountMinor > 0).map((s) => s.participantId);
}

/**
 * Latest attempt status per payer. `attempts` must be in creation order; a
 * payer without an attempt is `not_started`.
 */
export function latestStatusByPayer(
  shares: readonly ShareLike[],
  attempts: readonly AttemptLike[],
): Map<string, PaymentAttemptStatus> {
  const latest = new Map<string, PaymentAttemptStatus>();
  for (const id of payerIds(shares)) latest.set(id, "not_started");
  for (const a of attempts) if (latest.has(a.participantId)) latest.set(a.participantId, a.status);
  return latest;
}

/**
 * Group status implied by the attempts. Only payment-phase statuses move;
 * every other revision status is returned unchanged.
 */
export function deriveGroupStatus(
  current: ProposalStatus,
  shares: readonly ShareLike[],
  attempts: readonly AttemptLike[],
): ProposalStatus {
  const statuses = [...latestStatusByPayer(shares, attempts).values()];

  if (PRE_CAPTURE_STATUSES.includes(current)) {
    if (statuses.some((s) => s === "authorization_failed")) return "blocked";
    if (statuses.length > 0 && statuses.every((s) => s === "authorized")) return "ready_to_capture";
    return "authorizing";
  }

  if (current === "capturing") {
    if (statuses.every((s) => s === "captured")) return "test_funded";
    // Uncertain stays capturing until reconcile; anything else means capture broke.
    const healthy = statuses.every((s) => s === "capture_pending" || s === "captured" || s === "uncertain");
    return healthy ? "capturing" : "recovery_pending";
  }

  if (current === "recovery_pending") {
    return attempts.every((a) => isTerminalAttempt(a.status)) ? "canceled" : "recovery_pending";
  }

  return current;
}

/**
 * Intent to record before the adapter talks to the provider when a revision
 * is being unwound. Returns null when the attempt needs no new intent
 * (terminal, already pending a provider result, or capture in flight).
 */
export function unwindIntent(
  revisionStatus: ProposalStatus,
  attemptStatus: PaymentAttemptStatus,
): PaymentAttemptStatus | null {
  if (!UNWIND_STATUSES.includes(revisionStatus)) return null;
  switch (attemptStatus) {
    case "not_started":
      return "canceled";
    case "authorization_pending":
    case "action_required":
    case "authorized":
      return "cancellation_pending";
    case "captured":
      return "refund_pending";
    default:
      return null;
  }
}
