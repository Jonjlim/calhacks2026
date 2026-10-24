/**
 * P1-B payment state. Owner: Dev 2 (BE-015). Adapter: Dev 4 (RC-010+).
 *
 * Dev 2 owns documents, transitions, and freeze-on-capture. Dev 4's Stripe
 * test-mode actions call the public mutations here (with the user's identity)
 * to record intent *before* each provider call, then report provider results
 * through the internal mutations. Nothing here talks to Stripe.
 *
 * Invariants:
 *   - Disabled unless PAYMENTS_SANDBOX_ENABLED=true. P0 pledges never depend on this file.
 *   - Every attempt binds one revision and one participant, for that participant's frozen share.
 *   - Only the current revision, after every payer approved it, can collect authorizations.
 *   - beginCapture flips the revision to `capturing` before any capture call; from then
 *     on selection, cap, and gift edits are refused until funded or recovered.
 *   - Browser redirects are not success: only applyAttemptStatus moves an attempt forward.
 *   - No agent tool reaches these functions. Public mutations require a human member identity.
 */
import { v } from "convex/values";
import type { MyPaymentAttemptView, PaymentStatusView, Result } from "../../lib/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireMember } from "../lib/auth";
import { IDEMPOTENCY_KEY_MAX_CHARS } from "../lib/input";
import { recomputeProposal } from "../lib/proposalEngine";
import { err, memberError, ok } from "../lib/result";
import * as V from "../validators";
import {
  FROZEN_STATUSES,
  PRE_CAPTURE_STATUSES,
  canTransitionAttempt,
  isTerminalAttempt,
  latestStatusByPayer,
  payerIds,
} from "./stateMachine";
import { syncRevisionPayments } from "./sync";

const LAST_ERROR_MAX_CHARS = 200;
const PROVIDER_ID_MAX_CHARS = 255;

export function paymentsEnabled(): boolean {
  return process.env.PAYMENTS_SANDBOX_ENABLED === "true";
}

const DISABLED_MESSAGE = "Sandbox payments are not enabled. Approvals remain pledges.";

function toMyAttempt(a: Doc<"paymentAttempts">): MyPaymentAttemptView {
  return {
    id: a._id,
    revisionId: a.revisionId,
    status: a.status,
    amountMinor: a.amountMinor,
    currency: a.currency,
    lastError: a.lastError,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

async function attemptsFor(ctx: QueryCtx, revisionId: Id<"proposalRevisions">) {
  return await ctx.db
    .query("paymentAttempts")
    .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
    .collect();
}

async function myAttempts(
  ctx: QueryCtx,
  revisionId: Id<"proposalRevisions">,
  participantId: Id<"participants">,
) {
  return await ctx.db
    .query("paymentAttempts")
    .withIndex("by_revision_participant", (q) => q.eq("revisionId", revisionId).eq("participantId", participantId))
    .collect();
}

type CurrentTarget =
  | { ok: true; revision: Doc<"proposalRevisions">; room: Doc<"rooms">; me: Doc<"participants"> }
  | { ok: false; code: "unauthorized" | "not_found" | "invalid_revision"; message: string };

/** Loads a revision, checks membership, and requires it to be the room's current revision. */
async function loadCurrentRevision(ctx: QueryCtx, revisionId: Id<"proposalRevisions">): Promise<CurrentTarget> {
  const revision = await ctx.db.get(revisionId);
  if (!revision) return { ok: false, code: "not_found", message: "Revision not found." };
  const member = await requireMember(ctx, revision.roomId);
  if (!member.ok) {
    return {
      ok: false,
      code: member.code,
      message: member.code === "not_found" ? "Room not found." : "You are not a member of this room.",
    };
  }
  if (member.room.currentRevisionId !== revisionId) {
    return { ok: false, code: "invalid_revision", message: "This proposal changed. Review the latest revision." };
  }
  return { ok: true, revision, room: member.room, me: member.me };
}

/** Group payment status for the current revision. Peers see counts, never instruments or caps. */
export const getPaymentStatus = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<PaymentStatusView>> => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError(member.code);
    const revision = member.room.currentRevisionId ? await ctx.db.get(member.room.currentRevisionId) : null;
    const base: PaymentStatusView = {
      enabled: paymentsEnabled(),
      mode: "stripe_test",
      revisionId: revision?._id ?? null,
      groupStatus: revision?.status ?? null,
      frozen: revision ? FROZEN_STATUSES.includes(revision.status) : false,
      payerCount: 0,
      authorizedCount: 0,
      capturedCount: 0,
      attentionCount: 0,
      myAttempt: null,
      merchantOrder: { status: "not_implemented" },
    };
    if (!revision) return ok(base);

    const attempts = await attemptsFor(ctx, revision._id);
    const latest = [...latestStatusByPayer(revision.shares, attempts).values()];
    const mine = attempts.filter((a) => a.participantId === member.me._id).at(-1);
    return ok({
      ...base,
      payerCount: latest.length,
      authorizedCount: latest.filter((s) => s === "authorized" || s === "capture_pending").length,
      capturedCount: latest.filter((s) => s === "captured").length,
      attentionCount: latest.filter(
        (s) => s === "authorization_failed" || s === "action_required" || s === "uncertain",
      ).length,
      myAttempt: mine ? toMyAttempt(mine) : null,
    });
  },
});

export interface AuthorizationIntent {
  attemptId: Id<"paymentAttempts">;
  revisionId: Id<"proposalRevisions">;
  amountMinor: number;
  currency: "USD";
  /** Send this to Stripe as the idempotency key. */
  idempotencyKey: string;
  status: Doc<"paymentAttempts">["status"];
  created: boolean;
}

function intentOf(a: Doc<"paymentAttempts">, created: boolean): AuthorizationIntent {
  return {
    attemptId: a._id,
    revisionId: a.revisionId,
    amountMinor: a.amountMinor,
    currency: a.currency,
    idempotencyKey: a.idempotencyKey,
    status: a.status,
    created,
  };
}

/**
 * Records `authorization_pending` for the caller's share of the current
 * revision. Dev 4's createAuthorization action calls this first, then opens
 * hosted Checkout with the returned amount and idempotency key. Retries with
 * the same key, or while a live attempt exists, return the existing attempt.
 */
export const beginAuthorization = mutation({
  args: { revisionId: v.id("proposalRevisions"), idempotencyKey: v.string() },
  handler: async (ctx, { revisionId, idempotencyKey }): Promise<Result<AuthorizationIntent>> => {
    if (!paymentsEnabled()) return err("refused", DISABLED_MESSAGE);
    const target = await loadCurrentRevision(ctx, revisionId);
    if (!target.ok) return err(target.code, target.message);
    const { revision, me } = target;

    const clientKey = idempotencyKey.trim();
    if (!clientKey || clientKey.length > IDEMPOTENCY_KEY_MAX_CHARS) {
      return err("validation_failed", "A valid idempotency key is required.");
    }
    const share = revision.shares.find((s) => s.participantId === me._id);
    if (!share || share.amountMinor <= 0) return err("unauthorized", "You do not have a share to pay in this revision.");

    const mine = await myAttempts(ctx, revisionId, me._id);
    const sameKey = mine.find((a) => a.clientIdempotencyKey === clientKey);
    if (sameKey) return ok(intentOf(sameKey, false));
    const live = mine.find((a) => !isTerminalAttempt(a.status));
    if (live) return ok(intentOf(live, false));

    if (revision.status !== "approved_pledged" && !PRE_CAPTURE_STATUSES.includes(revision.status)) {
      return err(
        "invalid_revision",
        revision.status === "awaiting_approval"
          ? "Everyone must approve this revision before sandbox payment."
          : "This revision is not collecting payments.",
      );
    }

    const now = Date.now();
    const attemptId = await ctx.db.insert("paymentAttempts", {
      roomId: revision.roomId,
      revisionId,
      participantId: me._id,
      provider: "stripe_test",
      idempotencyKey: `unwrap_${revisionId}_${me._id}_${mine.length + 1}`,
      clientIdempotencyKey: clientKey,
      amountMinor: share.amountMinor,
      currency: "USD",
      status: "authorization_pending",
      createdAt: now,
      updatedAt: now,
    });
    if (revision.status === "approved_pledged") await ctx.db.patch(revisionId, { status: "authorizing" });
    await syncRevisionPayments(ctx, revisionId, now);
    return ok(intentOf((await ctx.db.get(attemptId))!, true));
  },
});

export interface CaptureIntent {
  revisionId: Id<"proposalRevisions">;
  attempts: Array<{
    attemptId: Id<"paymentAttempts">;
    providerObjectId: string;
    amountMinor: number;
    idempotencyKey: string;
  }>;
}

/**
 * Organizer starts capture. Freezes the revision (`capturing`) and records
 * `capture_pending` on every authorization before Dev 4's adapter calls
 * Stripe. Repeating the call while capturing returns the same work list.
 */
export const beginCapture = mutation({
  args: { revisionId: v.id("proposalRevisions") },
  handler: async (ctx, { revisionId }): Promise<Result<CaptureIntent>> => {
    if (!paymentsEnabled()) return err("refused", DISABLED_MESSAGE);
    const target = await loadCurrentRevision(ctx, revisionId);
    if (!target.ok) return err(target.code, target.message);
    const { revision, me } = target;
    if (me.role !== "organizer") return err("unauthorized", "Only the organizer can start capture.");

    const attempts = await attemptsFor(ctx, revisionId);
    const payers = new Set(payerIds(revision.shares));
    const workList = (rows: Doc<"paymentAttempts">[]): CaptureIntent => ({
      revisionId,
      attempts: rows
        .filter((a) => payers.has(a.participantId) && a.status === "capture_pending" && a.providerObjectId)
        .map((a) => ({
          attemptId: a._id,
          providerObjectId: a.providerObjectId!,
          amountMinor: a.amountMinor,
          idempotencyKey: `${a.idempotencyKey}_capture`,
        })),
    });

    if (revision.status === "capturing") return ok(workList(attempts));
    if (revision.status !== "ready_to_capture") {
      return err("infeasible", "Every contributor must authorize before capture.");
    }
    // Defensive: ready_to_capture implies this, but never capture without a provider object.
    const latest = new Map<string, Doc<"paymentAttempts">>();
    for (const a of attempts) if (payers.has(a.participantId)) latest.set(a.participantId, a);
    if (latest.size !== payers.size || [...latest.values()].some((a) => a.status !== "authorized" || !a.providerObjectId)) {
      return err("infeasible", "Every contributor must authorize before capture.");
    }

    const now = Date.now();
    await ctx.db.patch(revisionId, { status: "capturing" });
    for (const a of latest.values()) {
      await ctx.db.patch(a._id, { status: "capture_pending", updatedAt: now });
    }
    return ok(workList(await attemptsFor(ctx, revisionId)));
  },
});

/**
 * Organizer abandons sandbox payment before capture. The revision becomes
 * `canceled`, live authorizations get `cancellation_pending`, and a fresh
 * revision is minted for new approvals. Captures cannot be canceled here;
 * they go through recovery.
 */
export const cancelPayments = mutation({
  args: { revisionId: v.id("proposalRevisions") },
  handler: async (ctx, { revisionId }): Promise<Result<{ canceledRevisionId: Id<"proposalRevisions">; currentRevisionId: Id<"proposalRevisions"> | null }>> => {
    if (!paymentsEnabled()) return err("refused", DISABLED_MESSAGE);
    const target = await loadCurrentRevision(ctx, revisionId);
    if (!target.ok) return err(target.code, target.message);
    const { revision, me } = target;
    if (me.role !== "organizer") return err("unauthorized", "Only the organizer can cancel sandbox payment.");
    if (!PRE_CAPTURE_STATUSES.includes(revision.status)) {
      return err(
        "invalid_revision",
        FROZEN_STATUSES.includes(revision.status)
          ? "Capture already started. Recovery handles any refunds."
          : "This revision has no sandbox payment to cancel.",
      );
    }
    const now = Date.now();
    await ctx.db.patch(revisionId, { status: "canceled" });
    await syncRevisionPayments(ctx, revisionId, now);
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
      .collect();
    for (const approval of approvals) {
      if (approval.status === "pending" || approval.status === "approved") {
        await ctx.db.patch(approval._id, { status: "invalidated", updatedAt: now });
      }
    }
    const recomputed = await recomputeProposal(ctx, revision.roomId);
    return ok({ canceledRevisionId: revisionId, currentRevisionId: recomputed.revision?._id ?? null });
  },
});

/** A contributor withdraws their own authorization before capture. */
export const cancelMyAuthorization = mutation({
  args: { attemptId: v.id("paymentAttempts") },
  handler: async (ctx, { attemptId }): Promise<Result<MyPaymentAttemptView>> => {
    if (!paymentsEnabled()) return err("refused", DISABLED_MESSAGE);
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) return err("not_found", "Payment attempt not found.");
    const member = await requireMember(ctx, attempt.roomId);
    if (!member.ok || member.me._id !== attempt.participantId) {
      return err("unauthorized", "You can only cancel your own authorization.");
    }
    const revision = await ctx.db.get(attempt.revisionId);
    if (!revision || !PRE_CAPTURE_STATUSES.includes(revision.status)) {
      return err("invalid_revision", "This authorization can no longer be canceled here.");
    }
    if (attempt.status === "cancellation_pending" || isTerminalAttempt(attempt.status)) return ok(toMyAttempt(attempt));
    const next = attempt.status === "not_started" ? "canceled" : "cancellation_pending";
    if (!canTransitionAttempt(attempt.status, next)) {
      return err("invalid_revision", "This authorization can no longer be canceled here.");
    }
    const now = Date.now();
    await ctx.db.patch(attemptId, { status: next, updatedAt: now });
    await syncRevisionPayments(ctx, attempt.revisionId, now);
    return ok(toMyAttempt((await ctx.db.get(attemptId))!));
  },
});

// ---------- Adapter-facing (server only) ----------

export const getAttempt = internalQuery({
  args: { attemptId: v.id("paymentAttempts") },
  handler: async (ctx, { attemptId }) => await ctx.db.get(attemptId),
});

export const findAttemptByProviderObject = internalQuery({
  args: { providerObjectId: v.string() },
  handler: async (ctx, { providerObjectId }) =>
    await ctx.db
      .query("paymentAttempts")
      .withIndex("by_provider_object", (q) => q.eq("providerObjectId", providerObjectId))
      .first(),
});

/** Attempts that still need a provider call (cancel, refund) or a reconcile. */
export const listPendingProviderWork = internalQuery({
  args: { revisionId: v.id("proposalRevisions") },
  handler: async (ctx, { revisionId }) =>
    (await attemptsFor(ctx, revisionId)).filter((a) =>
      ["authorization_pending", "capture_pending", "cancellation_pending", "refund_pending", "uncertain"].includes(
        a.status,
      ),
    ),
});

/** Binds a Stripe PaymentIntent (or Checkout Session) ID to an attempt once. */
export const attachProviderObject = internalMutation({
  args: { attemptId: v.id("paymentAttempts"), providerObjectId: v.string() },
  handler: async (ctx, { attemptId, providerObjectId }): Promise<Result<null>> => {
    const id = providerObjectId.trim();
    if (!id || id.length > PROVIDER_ID_MAX_CHARS) return err("validation_failed", "Invalid provider object ID.");
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) return err("not_found", "Payment attempt not found.");
    if (attempt.providerObjectId === id) return ok(null);
    if (attempt.providerObjectId) return err("validation_failed", "Attempt is already bound to another provider object.");
    const other = await ctx.db
      .query("paymentAttempts")
      .withIndex("by_provider_object", (q) => q.eq("providerObjectId", id))
      .first();
    if (other) return err("validation_failed", "Provider object is already bound to another attempt.");
    await ctx.db.patch(attemptId, { providerObjectId: id, updatedAt: Date.now() });
    return ok(null);
  },
});

async function applyStatus(
  ctx: MutationCtx,
  attempt: Doc<"paymentAttempts">,
  status: Doc<"paymentAttempts">["status"],
  lastError: string | undefined,
) {
  const now = Date.now();
  if (attempt.status !== status) {
    await ctx.db.patch(attempt._id, {
      status,
      updatedAt: now,
      lastError: lastError?.slice(0, LAST_ERROR_MAX_CHARS),
    });
  }
  const { revision, becameCanceled } = await syncRevisionPayments(ctx, attempt.revisionId, now);
  if (becameCanceled) {
    const room = await ctx.db.get(revision.roomId);
    if (room?.currentRevisionId === revision._id) await recomputeProposal(ctx, room._id);
  }
  return { attempt: (await ctx.db.get(attempt._id))!, groupStatus: revision.status };
}

/**
 * Records a provider-reported attempt status (Stripe is authoritative), then
 * re-derives the group status. Repeating the same status is a no-op success,
 * so duplicate webhooks and retries are safe. Illegal transitions are refused.
 */
export const applyAttemptStatus = internalMutation({
  args: {
    attemptId: v.id("paymentAttempts"),
    status: V.paymentAttemptStatus,
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, { attemptId, status, lastError }) => {
    type Out = { attempt: Doc<"paymentAttempts">; groupStatus: Doc<"proposalRevisions">["status"] };
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) return err<Out>("not_found", "Payment attempt not found.");
    if (attempt.status !== status && !canTransitionAttempt(attempt.status, status)) {
      return err<Out>("validation_failed", `Illegal payment transition ${attempt.status} → ${status}.`);
    }
    return ok<Out>(await applyStatus(ctx, attempt, status, lastError));
  },
});

/**
 * Webhook dedupe ledger. Insert before processing; a duplicate returns
 * `{ duplicate: true }` and the caller must stop. Signature verification and
 * PaymentIntent retrieval happen in Dev 4's HTTP action.
 */
export const recordProviderEvent = internalMutation({
  args: {
    providerEventId: v.string(),
    type: v.string(),
    providerObjectId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Result<{ duplicate: boolean }>> => {
    const eventId = args.providerEventId.trim();
    if (!eventId || eventId.length > PROVIDER_ID_MAX_CHARS || args.type.length > PROVIDER_ID_MAX_CHARS) {
      return err("validation_failed", "Invalid provider event.");
    }
    const existing = await ctx.db
      .query("providerEvents")
      .withIndex("by_provider_event", (q) => q.eq("provider", "stripe_test").eq("providerEventId", eventId))
      .first();
    if (existing) return ok({ duplicate: true });
    await ctx.db.insert("providerEvents", {
      provider: "stripe_test",
      providerEventId: eventId,
      type: args.type,
      providerObjectId: args.providerObjectId,
      receivedAt: Date.now(),
    });
    return ok({ duplicate: false });
  },
});
