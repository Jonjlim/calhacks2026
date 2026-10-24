import type { Participant, ProposalView } from "@/lib/contracts";
import { formatMinor } from "@/lib/money";
import { Panel } from "@/components/ui/Panel";

// PX-010 / PX-011 / PX-014: own cap, frozen shares, approval states, honest
// pledge copy. Never render another participant's cap.
export function ProposalPanel({
  proposal,
  participants,
  me,
}: {
  proposal: ProposalView;
  participants: Participant[];
  me: Participant;
}) {
  const { revision, approvals, myLimit } = proposal;
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.displayName ?? "Someone";

  return (
    <Panel title="Proposal">
      {myLimit && (
        <p className="mb-2 text-sm">
          Your private limit: {formatMinor(myLimit.amountMinor)} (only you can see this)
        </p>
      )}
      {!revision ? (
        <p className="text-sm text-plum-soft">No proposal yet. Pick a gift first.</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Total {formatMinor(revision.payableTotalMinor, revision.currency)} · status{" "}
            <span className="font-medium">{revision.status}</span>
          </p>
          <ul>
            {revision.shares.map((s) => {
              const approval = approvals.find((a) => a.participantId === s.participantId);
              return (
                <li key={s.participantId}>
                  {s.participantId === me.id ? "You" : nameOf(s.participantId)}:{" "}
                  {formatMinor(s.amountMinor)} · {approval?.status ?? "pending"}
                </li>
              );
            })}
          </ul>
          {revision.conditions.map((c) => (
            <p key={c} className="text-xs text-plum-soft">
              {c}
            </p>
          ))}
          <p className="text-xs text-plum-soft">
            Approving is a pledge. Unwrap has not charged cards and has not placed a merchant
            order.
          </p>
        </div>
      )}
    </Panel>
  );
}
