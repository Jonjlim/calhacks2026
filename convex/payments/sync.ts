/**
 * Applies the pure payment state machine to stored documents. Owner: Dev 2
 * (BE-015). Used by the proposal engine (supersede) and payments/state.ts.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { canTransitionAttempt, deriveGroupStatus, unwindIntent } from "./stateMachine";

export interface SyncResult {
  revision: Doc<"proposalRevisions">;
  /** True when this sync finished recovery and the revision is now canceled. */
  becameCanceled: boolean;
}

/**
 * Re-derives the revision's group status from its attempts and records unwind
 * intents (cancel uncaptured, refund captured) for dead revisions. Intents are
 * written before the adapter calls the provider; the adapter reports results
 * through applyAttemptStatus.
 */
export async function syncRevisionPayments(
  ctx: MutationCtx,
  revisionId: Id<"proposalRevisions">,
  now: number,
): Promise<SyncResult> {
  const revision = await ctx.db.get(revisionId);
  if (!revision) throw new Error("syncRevisionPayments: revision missing");
  const startStatus = revision.status;
  const attempts = await ctx.db
    .query("paymentAttempts")
    .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
    .collect();

  // Two passes: unwinding can make every attempt terminal, which changes the group status again.
  for (let pass = 0; pass < 2; pass++) {
    const next = deriveGroupStatus(revision.status, revision.shares, attempts);
    if (next !== revision.status) {
      await ctx.db.patch(revision._id, { status: next });
      revision.status = next;
    }
    for (const attempt of attempts) {
      const intent = unwindIntent(revision.status, attempt.status);
      if (intent && canTransitionAttempt(attempt.status, intent)) {
        await ctx.db.patch(attempt._id, { status: intent, updatedAt: now });
        attempt.status = intent;
        attempt.updatedAt = now;
      }
    }
  }

  const becameCanceled = startStatus !== "canceled" && revision.status === "canceled";
  if (becameCanceled) {
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
      .collect();
    for (const approval of approvals) {
      if (approval.status === "pending" || approval.status === "approved") {
        await ctx.db.patch(approval._id, { status: "invalidated", updatedAt: now });
      }
    }
  }
  return { revision, becameCanceled };
}
