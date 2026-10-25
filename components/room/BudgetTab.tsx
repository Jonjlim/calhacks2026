"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatMinor } from "@/lib/money";
import s from "./budget-tab.module.css";

/**
 * The gift budget. A new friend sees it first, in the middle of the screen: a
 * range from the lowest to the highest amount they are comfortable with. When they
 * confirm, it slides away to the right and leaves a small tab with an arrow; the
 * tab peeks out when the pointer comes near it, and opens the page again when
 * pressed, so the range can be changed at any time. The group's soft range (the
 * lowest highest-amount times the friends, and the mean lowest amount) only steers
 * which gifts rank higher; it never hides or refuses a gift, and no one else's own
 * figures are shown.
 */
const STEP = 500;
const TOP = 50_000;

export function BudgetTab({ roomId }: { roomId: string }) {
  const res = useQuery(api.budgets.state, { roomId: roomId as Id<"rooms"> });
  const save = useMutation(api.budgets.setRange);
  const [range, setRange] = useState<[number, number]>([2000, 8000]);
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);
  const view = res?.ok ? res.value : null;

  // A friend who has not answered yet is asked straight away; one who has just sees the tab.
  useEffect(() => {
    if (!view || seeded.current) return;
    seeded.current = true;
    if (view.range) setRange([view.range.minMinor, view.range.maxMinor]);
    else setOpen(true);
  }, [view]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && view?.range && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, view?.range]);

  if (!view) return null;
  const [lo, hi] = range;
  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      const r = await save({ roomId: roomId as Id<"rooms">, minMinor: lo, maxMinor: Math.max(hi, STEP) });
      if (!r.ok) setError(r.error.message);
      else setOpen(false);
    } catch {
      setError("That didn’t save. Check the connection and try again.");
    } finally {
      setPending(false);
    }
  };
  const pct = (v: number) => `${(v / TOP) * 100}%`;
  const soft = view.guidance;
  return (
    <>
      {open && <div className={s.veil} onClick={() => view.range && setOpen(false)} aria-hidden />}
      <aside className={`${s.panel} ${open ? s.open : s.shut} ${!open && peek ? s.peek : ""}`} aria-label="Gift budget" onPointerEnter={() => setPeek(true)} onPointerLeave={() => setPeek(false)}>
        <button type="button" className={s.tab} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Tuck the budget away" : "Open the gift budget"}>
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden><path d={open ? "M5 3l6 5-6 5" : "M11 3L5 8l6 5"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {!open && <span>Budget</span>}
        </button>
        <div className={s.body} inert={!open || undefined}>
          <p className={s.kicker}>{view.range ? "Your budget" : "First, a budget"}</p>
          <h2>What feels right for this gift?</h2>
          <p className={s.lede}>Give a range you would be happy to chip in toward. It guides which gifts we look for; it is never a hard limit, and nobody sees your numbers.</p>

          <div className={s.readout}>
            <div><small>Lowest</small><b>{formatMinor(lo)}</b></div>
            <i aria-hidden>to</i>
            <div><small>Highest</small><b>{formatMinor(hi)}</b></div>
          </div>
          <div className={s.bar}>
            <span className={s.track} />
            <span className={s.fill} style={{ left: pct(lo), right: `calc(100% - ${pct(hi)})` }} />
            <input type="range" aria-label="Lowest amount" min={0} max={TOP} step={STEP} value={lo} onChange={(e) => setRange([Math.min(+e.target.value, hi), hi])} />
            <input type="range" aria-label="Highest amount" min={0} max={TOP} step={STEP} value={hi} onChange={(e) => setRange([lo, Math.max(+e.target.value, lo)])} />
          </div>
          <div className={s.scale} aria-hidden><span>$0</span><span>$250</span><span>$500+</span></div>

          <div className={s.groupBox} aria-label="The group's budget range">
            <p className={s.groupHead}><b>The whole group</b><span>{soft ? `${soft.responseCount} of ${view.participantCount} have answered` : "no one has answered yet"}</span></p>
            {soft ? (
              <>
                <div className={s.groupBar} aria-hidden>
                  <span className={s.track} />
                  <span className={s.groupFill} style={{ left: pct(Math.min(soft.lowerMinor, TOP)), right: `calc(100% - ${pct(Math.min(soft.upperMinor, TOP))})` }} />
                  {view.range && <i className={s.mineDot} style={{ left: pct(Math.min(hi, TOP)) }} title="Your highest" />}
                </div>
                <p className={s.groupRead}><b>{formatMinor(soft.lowerMinor)}</b> <i>to</i> <b>{formatMinor(soft.upperMinor)}</b></p>
                <p className={s.groupNote}>Built from everyone’s ranges: the lowest of the highest amounts times {view.participantCount}, and the average of the lowest amounts. Gifts in this range rank highest; others are only ranked lower, never hidden.</p>
              </>
            ) : (
              <p className={s.groupNote}>As friends answer, you will see the range gifts are ranked around.</p>
            )}
          </div>
          {error && <p role="alert" className={s.err}>{error}</p>}
          <button type="button" className={s.go} onClick={confirm} disabled={pending || hi < STEP}>{pending ? "Saving…" : view.range ? "Update my budget" : "Confirm my budget"}</button>
        </div>
      </aside>
    </>
  );
}
