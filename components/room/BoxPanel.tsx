"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { AvatarId } from "@/components/characters/StorybookAvatar";
import s from "@/components/world/room/gift-rings.module.css";
import type { AppError, GiftSelection, Participant, ProductListing, ProposalView } from "@/lib/contracts";
import { formatMinor, parseMajorToMinor } from "@/lib/money";
import { portraitUrl } from "@/lib/room/avatars";
import { useResultAction } from "@/lib/useResultAction";
import { GiftIcon } from "@/components/ui/Icons";
import type { RoomActions } from "./types";

/**
 * The shared yes, at the present itself (D19): the chosen gift, everyone's
 * share of this exact revision, your private limit, and one approve button.
 * Same rules as ProposalPanel: never shows anyone else's limit, and an
 * approval is a pledge, not a charge.
 */
export function BoxPanel({ proposal, selection, listing, participants, me, isOrganizer, actions, avatarOf, colorOf, why, onWhy, onClose, onReveal, revealLabel }: {
  proposal: ProposalView;
  selection: GiftSelection | null;
  listing?: ProductListing;
  participants: Participant[];
  me: Participant;
  isOrganizer: boolean;
  actions?: Pick<RoomActions, "setLimit" | "approve" | "withdrawApproval" | "clearSelection">;
  avatarOf(id: string): AvatarId;
  colorOf(id: string): string;
  why: boolean;
  onWhy(): void;
  onClose(): void;
  /** The cinematic reveal of the chosen gift (see components/convergence). */
  onReveal?(): void;
  revealLabel?: string;
}) {
  const { revision, approvals, myLimit } = proposal;
  const [limitInput, setLimitInput] = useState(myLimit ? (myLimit.amountMinor / 100).toFixed(2) : "");
  const [limitError, setLimitError] = useState<AppError | null>(null);
  const saveLimit = useResultAction(actions?.setLimit);
  const approve = useResultAction(actions?.approve);
  const withdraw = useResultAction(actions?.withdrawApproval);
  const clear = useResultAction(actions?.clearSelection);

  // A new revision after approvals were given means the deal changed: say so instead of silently resetting.
  const lastRevision = useRef<{ id?: string; approved: number }>({ id: revision?.id, approved: 0 });
  const [reset, setReset] = useState(false);
  const approvedNow = approvals.filter((a) => a.revisionId === revision?.id && a.status === "approved").length;
  useEffect(() => {
    const before = lastRevision.current;
    // Only worth saying when someone had already said yes to the old version.
    if (revision?.id && before.id && revision.id !== before.id && before.approved > 0) setReset(true);
    lastRevision.current = { id: revision?.id, approved: approvedNow };
  }, [revision?.id, approvedNow]);

  const name = (id: string) => (id === me.id ? "You" : participants.find((p) => p.id === id)?.displayName ?? "A friend");
  const myApproval = revision ? approvals.find((a) => a.participantId === me.id && a.revisionId === revision.id) : undefined;
  const myShare = revision?.shares.find((x) => x.participantId === me.id);
  const collecting = revision?.status === "awaiting_approval" || revision?.status === "approved_pledged";
  const approvedIds = new Set(approvals.filter((a) => a.revisionId === revision?.id && a.status === "approved").map((a) => a.participantId));
  const pledgedMinor = revision ? revision.shares.filter((x) => approvedIds.has(x.participantId)).reduce((n, x) => n + x.amountMinor, 0) : 0;
  const everyone = revision?.status === "approved_pledged";

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

  return (
    <section className={`${s.boxPanel} ${everyone ? s.boxDone : ""}`} data-map-token aria-label="Our gift">
      <header>
        <span>{revision ? (revision.status === "approved_pledged" ? "Our gift · everyone approved" : "Our gift · waiting for approvals") : "Our gift box"}</span>
        <button type="button" onClick={onClose} aria-label="Close">×</button>
      </header>

      {reset && (
        <p className={s.boxReset} role="status">The gift or a share changed, so this is a new version. Everyone approves again. <button type="button" onClick={() => setReset(false)}>OK</button></p>
      )}

      {selection ? (
        <div className={s.boxGift}>
          {listing?.imageUrl ? <img src={listing.imageUrl} alt="" /> : <i aria-hidden><GiftIcon size={30} /></i>}
          <div>
            <b>{selection.listingSnapshot.title}</b>
            <a href={selection.listingSnapshot.sourceUrl} target="_blank" rel="noreferrer">{revision ? formatMinor(revision.payableTotalMinor, revision.currency) : selection.listingSnapshot.priceMinor !== undefined ? formatMinor(selection.listingSnapshot.priceMinor) : "Price unknown"} · see listing ↗</a>
          </div>
        </div>
      ) : (
        <p className={s.boxEmpty}>{isOrganizer ? "Drag a gift onto the present to choose it." : "The organizer puts one gift here. Pull the ones you like closer."}</p>
      )}

      {revision && revision.status === "infeasible" && (
        <p className={s.boxWarn} role="alert">{revision.conditions[0] ?? "The limits don’t cover this gift yet."} Raise a limit or choose a cheaper gift. Unset limits count as $0.</p>
      )}

      {revision && revision.status !== "infeasible" && (
        <>
          <div className={s.boxMeter} aria-label={`${formatMinor(pledgedMinor)} of ${formatMinor(revision.payableTotalMinor)} pledged`}>
            <i style={{ width: `${revision.payableTotalMinor ? (pledgedMinor / revision.payableTotalMinor) * 100 : 0}%` }} />
            <span>{everyone ? "Everyone’s in ✓" : `${formatMinor(pledgedMinor)} of ${formatMinor(revision.payableTotalMinor)} pledged`}</span>
          </div>
          <ul className={s.boxPeople}>
            {revision.shares.map((share) => {
              const yes = approvedIds.has(share.participantId);
              return (
                <li key={share.participantId} className={yes ? s.boxYes : ""} style={{ ["--who" as string]: colorOf(share.participantId) }}>
                  <img src={portraitUrl(avatarOf(share.participantId))} alt="" />
                  <b>{name(share.participantId)}</b>
                  <span>{formatMinor(share.amountMinor)}</span>
                  <small>{yes ? "✓ yes" : "waiting"}</small>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {actions && revision && collecting && (
        myApproval?.status === "approved" ? (
          <div className={s.boxActions}>
            <p className={s.boxMine}>You’re in{myShare ? ` for ${formatMinor(myShare.amountMinor)}` : ""} ✓</p>
            <button type="button" className={s.boxGhost} disabled={withdraw.pending} onClick={() => withdraw.run(revision.id)}>Take back my yes</button>
          </div>
        ) : (
          <button type="button" className={s.boxApprove} disabled={approve.pending || !myShare} onClick={() => approve.run(revision.id)}>
            {approve.pending ? "Saving…" : myShare ? `Approve my ${formatMinor(myShare.amountMinor)} share` : "You have no share in this version"}
          </button>
        )
      )}

      {actions && (
        <form onSubmit={submitLimit} className={s.boxLimit}>
          <label htmlFor="box-limit">Your limit <small>only you see this</small></label>
          <div>
            <input id="box-limit" inputMode="decimal" value={limitInput} onChange={(e) => setLimitInput(e.target.value)} placeholder="$40" />
            <button type="submit" disabled={saveLimit.pending || !limitInput.trim()}>{saveLimit.pending ? "Saving…" : myLimit ? "Update" : "Set"}</button>
          </div>
        </form>
      )}

      {(limitError ?? saveLimit.error ?? approve.error ?? withdraw.error ?? clear.error) && (
        <p className={s.boxWarn} role="alert">{(limitError ?? saveLimit.error ?? approve.error ?? withdraw.error ?? clear.error)!.message}</p>
      )}

      {selection && onReveal && <button type="button" className={s.boxApprove} onClick={onReveal}>{revealLabel ?? "Reveal our gift"}</button>}

      <footer>
        {selection && <button type="button" className={s.boxGhost} aria-pressed={why} onClick={onWhy}>{why ? "Hide the path" : "Why this gift?"}</button>}
        {actions && isOrganizer && selection && <button type="button" className={s.boxGhost} disabled={clear.pending} onClick={() => clear.run()}>Change gift</button>}
      </footer>
      <small className={s.boxFine}>Approving is a pledge. No card is charged and no order is placed.</small>
    </section>
  );
}
