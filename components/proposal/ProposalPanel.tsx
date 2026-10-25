"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { RoomActions } from "@/components/room/types";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/ErrorText";
import { Panel } from "@/components/ui/Panel";
import type { AppError, GiftSelection, Participant, ProposalStatus, ProposalView } from "@/lib/contracts";
import { formatMinor, parseMajorToMinor } from "@/lib/money";
import { useResultAction } from "@/lib/useResultAction";

const STATUS_LABELS: Partial<Record<ProposalStatus, string>> = {
  draft: "Draft",
  awaiting_approval: "Waiting for approvals",
  approved_pledged: "Everyone approved",
  infeasible: "Not covered yet",
  superseded: "Replaced by a newer proposal",
};

const APPROVAL_LABELS = { pending: "pending", approved: "approved", invalidated: "invalidated", withdrawn: "withdrew" } as const;

// PX-010 / PX-011 / PX-014: own cap, frozen shares, approval states, honest
// pledge copy. Never render another participant's cap.
export function ProposalPanel({
  proposal,
  participants,
  me,
  selection,
  isOrganizer,
  actions,
}: {
  proposal: ProposalView;
  participants: Participant[];
  me: Participant;
  selection: GiftSelection | null;
  isOrganizer: boolean;
  actions?: Pick<RoomActions, "setLimit" | "approve" | "withdrawApproval" | "clearSelection" | "removeGiftFromBox">;
}) {
  const { revision, approvals, myLimit } = proposal;
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.displayName ?? "Someone";
  const [limitInput, setLimitInput] = useState(myLimit ? (myLimit.amountMinor / 100).toFixed(2) : "");
  const [limitError, setLimitError] = useState<AppError | null>(null);
  const saveLimit = useResultAction(actions?.setLimit);
  const approve = useResultAction(actions?.approve);
  const withdraw = useResultAction(actions?.withdrawApproval);
  const clear = useResultAction(actions?.clearSelection);
  const remove = useResultAction(actions?.removeGiftFromBox);
  const items = revision?.items ?? selection?.items ?? (selection ? [{ listingId: selection.listingId, quantity: 1, listingSnapshot: selection.listingSnapshot }] : []);
  const currentApprovals = approvals.filter((a) => a.revisionId === revision?.id);
  const previous = useRef({ id: revision?.id, approved: 0 });
  const [reset, setReset] = useState(false);
  const approvedCount = currentApprovals.filter((a) => a.status === "approved").length;
  useEffect(() => {
    if (previous.current.id && revision?.id !== previous.current.id && previous.current.approved > 0) setReset(true);
    previous.current = { id: revision?.id, approved: approvedCount };
  }, [revision?.id, approvedCount]);
  useEffect(() => setLimitInput(myLimit ? (myLimit.amountMinor / 100).toFixed(2) : ""), [myLimit?.amountMinor]);

  async function submitLimit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const amountMinor = parseMajorToMinor(limitInput);
    if (amountMinor === null) {
      setLimitError({ code: "validation_failed", message: "Enter an amount like 40 or 40.50." });
      return;
    }
    setLimitError(null);
    await saveLimit.run(amountMinor);
  }

  const myApproval = revision ? currentApprovals.find((a) => a.participantId === me.id) : undefined;
  const collecting = revision?.status === "awaiting_approval" || revision?.status === "approved_pledged";

  return (
    <Panel title="Our gift box">
      {reset && <p role="status" className="mb-3 rounded-lg bg-gold/20 p-3 text-sm">The gift or shares changed. Everyone needs to approve this version again. <button onClick={() => setReset(false)} className="underline">Dismiss</button></p>}
      {actions ? (
        <form onSubmit={submitLimit} className="mb-3 flex flex-col gap-1.5">
          <label className="text-[12px] text-plum-soft" htmlFor="my-limit">
            Your private limit (only you can see this)
          </label>
          <div className="flex gap-2">
            <input
              id="my-limit"
              inputMode="decimal"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              placeholder="$40"
              className="w-28 rounded-lg border border-plum/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-plum/40"
            />
            <Button type="submit" disabled={saveLimit.pending || !limitInput.trim()}>
              {saveLimit.pending ? "Saving…" : myLimit ? "Update" : "Set limit"}
            </Button>
          </div>
          {myLimit && <p className="text-[12px] text-plum-soft">Saved: {formatMinor(myLimit.amountMinor)}</p>}
          <ErrorText error={limitError ?? saveLimit.error} />
        </form>
      ) : (
        myLimit && <p className="mb-2 text-sm">Your private limit: {formatMinor(myLimit.amountMinor)} (only you can see this)</p>
      )}

      {!selection && !revision ? (
        <p className="text-sm text-plum-soft">
          No gift chosen yet. {isOrganizer ? "Choose one from the shortlist." : "The organizer picks one from the shortlist."}
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {items.length > 0 && <div aria-label="Gifts in the box">
            <p className="font-medium">{items.length} {items.length === 1 ? "gift" : "gifts"} in the box</p>
            <ul className="mt-2 flex flex-col gap-3">
              {items.map((item) => <li key={item.listingId}>
                <a href={item.listingSnapshot.sourceUrl} target="_blank" rel="noreferrer" className="font-medium underline">{item.listingSnapshot.title}</a>
                <p>{item.listingSnapshot.priceStatus === "observed" && item.listingSnapshot.priceMinor !== undefined ? formatMinor(item.listingSnapshot.priceMinor) : "Price unknown"}</p>
                {isOrganizer && actions?.removeGiftFromBox && <Button disabled={remove.pending} onClick={() => remove.run(item.listingId)} aria-label={`Remove ${item.listingSnapshot.title} from box`}>Remove</Button>}
              </li>)}
            </ul>
            <p className="mt-2 text-xs text-plum-soft">Includes observed shipping. Unknown shipping and tax are excluded.</p>
          </div>}
          {revision && (
            <>
              <p>
                Total {formatMinor(revision.payableTotalMinor, revision.currency)} ·{" "}
                <span className="font-medium">{STATUS_LABELS[revision.status] ?? revision.status}</span>
                {collecting && ` (${approvedCount}/${currentApprovals.length})`}
              </p>
              {revision.status === "infeasible" ? (
                <p className="rounded-lg bg-gold/20 px-3 py-2 text-[13px]">
                  {revision.conditions[0]} Everyone needs to set a limit; unset limits count as $0.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {revision.shares.map((s) => {
                    const approval = currentApprovals.find((a) => a.participantId === s.participantId);
                    return (
                      <li key={s.participantId} className={s.participantId === me.id ? "font-medium" : ""}>
                        {s.participantId === me.id ? "You" : nameOf(s.participantId)}: {formatMinor(s.amountMinor)} ·{" "}
                        {APPROVAL_LABELS[approval?.status ?? "pending"]}
                      </li>
                    );
                  })}
                </ul>
              )}
              {revision.status !== "infeasible" &&
                revision.conditions.map((c) => (
                  <p key={c} className="text-xs break-all text-plum-soft">
                    {c}
                  </p>
                ))}
            </>
          )}

          {actions && (
            <div className="flex flex-wrap gap-2">
              {revision && collecting && myApproval && myApproval.status !== "approved" && (
                <Button variant="primary" disabled={approve.pending} onClick={() => approve.run(revision.id)}>
                  Approve my share
                </Button>
              )}
              {revision && collecting && myApproval?.status === "approved" && (
                <Button disabled={withdraw.pending} onClick={() => withdraw.run(revision.id)}>
                  Withdraw approval
                </Button>
              )}
              {isOrganizer && selection && (
                <Button variant="ghost" disabled={clear.pending} onClick={() => clear.run()}>
                  Empty the box
                </Button>
              )}
            </div>
          )}
          <ErrorText error={approve.error ?? withdraw.error ?? clear.error ?? remove.error} />

          <p className="text-xs text-plum-soft">
            Approving is a pledge. Unwrap has not charged cards and has not placed a merchant order.
          </p>
        </div>
      )}
    </Panel>
  );
}
