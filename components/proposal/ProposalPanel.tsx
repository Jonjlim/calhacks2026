"use client";

import { type FormEvent, useState } from "react";
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
  actions?: Pick<RoomActions, "setLimit" | "approve" | "withdrawApproval" | "clearSelection">;
}) {
  const { revision, approvals, myLimit } = proposal;
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.displayName ?? "Someone";
  const [limitInput, setLimitInput] = useState(myLimit ? (myLimit.amountMinor / 100).toFixed(2) : "");
  const [limitError, setLimitError] = useState<AppError | null>(null);
  const saveLimit = useResultAction(actions?.setLimit);
  const approve = useResultAction(actions?.approve);
  const withdraw = useResultAction(actions?.withdrawApproval);
  const clear = useResultAction(actions?.clearSelection);

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

  const myApproval = revision ? approvals.find((a) => a.participantId === me.id) : undefined;
  const collecting = revision?.status === "awaiting_approval" || revision?.status === "approved_pledged";
  const approvedCount = approvals.filter((a) => a.status === "approved").length;

  return (
    <Panel title="Proposal">
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
          {selection && (
            <p>
              Gift:{" "}
              <a href={selection.listingSnapshot.sourceUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                {selection.listingSnapshot.title}
              </a>
            </p>
          )}
          {revision && (
            <>
              <p>
                Total {formatMinor(revision.payableTotalMinor, revision.currency)} ·{" "}
                <span className="font-medium">{STATUS_LABELS[revision.status] ?? revision.status}</span>
                {collecting && ` (${approvedCount}/${approvals.length})`}
              </p>
              {revision.status === "infeasible" ? (
                <p className="rounded-lg bg-gold/20 px-3 py-2 text-[13px]">
                  {revision.conditions[0]} Everyone needs to set a limit; unset limits count as $0.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {revision.shares.map((s) => {
                    const approval = approvals.find((a) => a.participantId === s.participantId);
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
                  Change gift
                </Button>
              )}
            </div>
          )}
          <ErrorText error={approve.error ?? withdraw.error ?? clear.error} />

          <p className="text-xs text-plum-soft">
            Approving is a pledge. Unwrap has not charged cards and has not placed a merchant order.
          </p>
        </div>
      )}
    </Panel>
  );
}
