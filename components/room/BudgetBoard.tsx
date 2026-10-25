"use client";

import { type FormEvent, useState } from "react";
import type { AppError } from "@/lib/contracts";
import { formatMinor, parseMajorToMinor } from "@/lib/money";
import { avatarFor, portraitUrl } from "@/lib/room/avatars";
import { useResultAction } from "@/lib/useResultAction";
import type { RoomActions, RoomData } from "./types";
import s from "./budget-board.module.css";

/**
 * A small carved board hung on the right of the map: how the group's shares will
 * work, early. Before a gift is shortlisted it only says that planning starts
 * then. Afterwards it shows the estimated total, the number of friends, and
 * either an equal split or, in custom mode, each friend's share of the current
 * proposal. Shares come from the room's own allocation (deterministic code, not
 * guessed here); a person's own limit is theirs alone and is never shown to the
 * others. It is a plan, not a charge.
 */
export function BudgetBoard({ data, actions }: { data: RoomData; actions?: Pick<RoomActions, "setLimit"> }) {
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [open, setOpen] = useState(true);
  const { participants, me, room } = data.view;
  const selection = data.selection?.status === "active" ? data.selection : null;
  const revision = data.proposal.revision && data.proposal.revision.status !== "superseded" ? data.proposal.revision : null;
  const listing = selection ? data.listings.find((l) => l.id === selection.listingId) : undefined;
  const currency = revision?.currency ?? listing?.currency ?? "USD";
  // The proposal's frozen total when there is one; otherwise the shortlisted gift's observed price, labelled as an estimate.
  const total = revision?.payableTotalMinor ?? (selection?.listingSnapshot.priceStatus === "observed" ? selection.listingSnapshot.priceMinor : undefined);
  const n = revision?.shares.length || participants.length;
  const equal = total !== undefined && n > 0 ? Math.ceil(total / n) : undefined;
  const name = (id: string) => (id === me.id ? "You" : participants.find((p) => p.id === id)?.displayName ?? "A friend");
  const myShare = revision?.shares.find((x) => x.participantId === me.id);
  const maxShare = Math.max(1, ...(revision?.shares.map((x) => x.amountMinor) ?? [1]));

  const [limit, setLimit] = useState(data.proposal.myLimit ? (data.proposal.myLimit.amountMinor / 100).toFixed(2) : "");
  const [limitError, setLimitError] = useState<AppError | null>(null);
  const save = useResultAction(actions?.setLimit);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minor = parseMajorToMinor(limit);
    if (minor === null) return setLimitError({ code: "validation_failed", message: "Enter an amount like 40 or 40.50." });
    setLimitError(null);
    await save.run(minor);
  };

  if (!open) {
    return (
      <button type="button" className={`${s.tag} paper-grain`} onClick={() => setOpen(true)} aria-label="Open the shares board">
        <i aria-hidden className={s.nail} />
        <b>Shares</b>
        {equal !== undefined && <span>{formatMinor(equal, currency)} each</span>}
      </button>
    );
  }
  return (
    <aside className={s.board} aria-label="How the shares will work">
      <i aria-hidden className={s.nail} />
      <i aria-hidden className={`${s.nail} ${s.right}`} />
      <header>
        <h2>Shares</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Fold the shares board away">Hide</button>
      </header>

      {!selection || total === undefined ? (
        <p className={s.soft}>
          {!selection ? "Budget planning begins after a gift is shortlisted." : "Estimated split coming soon."}
          <small>{participants.length} {participants.length === 1 ? "friend" : "friends"} in the room{room.budgetMinor !== undefined ? ` · room budget ${formatMinor(room.budgetMinor, currency)}` : ""}</small>
        </p>
      ) : (
        <>
          <div className={s.modes} role="group" aria-label="How to split">
            <button type="button" aria-pressed={mode === "equal"} onClick={() => setMode("equal")}>Equal split</button>
            <button type="button" aria-pressed={mode === "custom"} onClick={() => setMode("custom")}>Custom split</button>
          </div>
          <dl className={s.facts}>
            <div><dt>{revision ? "Total" : "Estimated total"}</dt><dd>{formatMinor(total, currency)}</dd></div>
            <div><dt>Friends</dt><dd>{n}</dd></div>
          </dl>

          {mode === "equal" ? (
            <p className={s.big}>
              <strong>{formatMinor(equal!, currency)}</strong> each
              <small>{formatMinor(total, currency)} shared by {n} {n === 1 ? "friend" : "friends"}, rounded up to the cent.</small>
            </p>
          ) : revision && revision.status !== "infeasible" ? (
            <>
              <ul className={s.people}>
                {revision.shares.map((share) => (
                  <li key={share.participantId}>
                    <img src={portraitUrl(avatarFor(participants, share.participantId))} alt="" />
                    <span>{name(share.participantId)}</span>
                    <i style={{ ["--w" as string]: `${(share.amountMinor / maxShare) * 100}%` }} aria-hidden />
                    <b>{formatMinor(share.amountMinor, currency)}</b>
                  </li>
                ))}
              </ul>
              {actions && (
                <form onSubmit={submit} className={s.limit}>
                  <label htmlFor="board-limit">Your limit <small>only you see it</small></label>
                  <div>
                    <input id="board-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="$40" />
                    <button type="submit" disabled={save.pending || !limit.trim()}>{save.pending ? "Saving…" : data.proposal.myLimit ? "Update" : "Set"}</button>
                  </div>
                  {(limitError ?? save.error) && <p role="alert">{(limitError ?? save.error)!.message}</p>}
                </form>
              )}
              {myShare && <p className={s.mine}>Your share: {formatMinor(myShare.amountMinor, currency)}</p>}
            </>
          ) : (
            <p className={s.soft}>{revision?.status === "infeasible" ? (revision.conditions[0] ?? "The limits don’t cover this gift yet.") : "Custom shares appear once the gift has a proposal."}</p>
          )}
        </>
      )}
      <p className={s.fine}>A plan, not a charge. Nobody pays until everyone agrees.</p>
    </aside>
  );
}
