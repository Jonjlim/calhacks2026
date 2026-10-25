"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatMinor, parseMajorToMinor } from "@/lib/money";
import { validBudgetRange } from "@/lib/budgets";
import styles from "./MemberBudgetRail.module.css";

export function MemberBudgetRail({ roomId }: { roomId: Id<"rooms"> }) {
  const result = useQuery(api.budgets.state, { roomId });
  if (!result?.ok) return null;
  return <BudgetEditor key={result.value.range ? "saved" : "new"} roomId={roomId} initial={result.value.range} guidance={result.value.guidance} />;
}

function BudgetEditor({ roomId, initial, guidance }: {
  roomId: Id<"rooms">;
  initial: { minMinor: number; maxMinor: number } | null;
  guidance: { lowerMinor: number; upperMinor: number; responseCount: number; participantCount: number; conflicting: boolean } | null;
}) {
  const save = useMutation(api.budgets.setRange);
  const [open, setOpen] = useState(!initial);
  const [min, setMin] = useState(String((initial?.minMinor ?? 1000) / 100));
  const [max, setMax] = useState(String((initial?.maxMinor ?? 5000) / 100));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!dirty && initial) { setMin(String(initial.minMinor / 100)); setMax(String(initial.maxMinor / 100)); }
  }, [initial?.minMinor, initial?.maxMinor, dirty]);
  const lo = parseMajorToMinor(min);
  const hi = parseMajorToMinor(max);
  const valid = lo !== null && hi !== null && validBudgetRange(lo, hi);
  const ceiling = Math.max(10000, Math.ceil((hi ?? 5000) / 5000) * 5000);
  async function commit() {
    if (!valid || saving) return;
    setSaving(true); setError("");
    try {
      const response = await save({ roomId, minMinor: lo, maxMinor: hi });
      if (!response.ok) setError(response.error.message);
      else setDirty(false);
    } catch { setError("Couldn’t save your range. Try again."); }
    finally { setSaving(false); }
  }
  return <aside className={styles.rail} aria-label="Your gift budget">
    <button className={styles.tab} onClick={() => setOpen(!open)} aria-expanded={open}>Your budget {initial ? `${formatMinor(initial.minMinor)}–${formatMinor(initial.maxMinor)}` : "＋"}</button>
    {open && <div className={styles.panel}>
      <h2 className="font-display text-xl">{initial ? "Your budget range" : "What’s comfortable for you?"}</h2>
      <p className="text-sm opacity-70">Your suggested contribution, not a pledge. Only you can see your range.</p>
      <fieldset disabled={saving}>
        <div className={styles.values}>
          <label>Minimum ($)<input aria-label="Minimum contribution in dollars" type="number" min="0" max="100000" step="0.01" value={min} onChange={e => { setMin(e.target.value); setDirty(true); }} /></label>
          <label>Maximum ($)<input aria-label="Maximum contribution in dollars" type="number" min="0" max="100000" step="0.01" value={max} onChange={e => { setMax(e.target.value); setDirty(true); }} /></label>
        </div>
        <div className={styles.slider} style={{ background: `linear-gradient(to right, #d9cfbd ${(lo ?? 0) / ceiling * 100}%, #8b9c78 ${(lo ?? 0) / ceiling * 100}%, #8b9c78 ${(hi ?? 0) / ceiling * 100}%, #d9cfbd ${(hi ?? 0) / ceiling * 100}%)` }}>
          <input aria-label="Minimum contribution" type="range" min="0" max={ceiling} step="100" value={lo ?? 0} onChange={e => { setMin(String(Math.min(Number(e.target.value), hi ?? ceiling) / 100)); setDirty(true); }} onPointerUp={() => { if (initial) void commit(); }} onKeyUp={() => { if (initial) void commit(); }} />
          <input aria-label="Maximum contribution" type="range" min="0" max={ceiling} step="100" value={hi ?? 5000} onChange={e => { setMax(String(Math.max(Number(e.target.value), lo ?? 0) / 100)); setDirty(true); }} onPointerUp={() => { if (initial) void commit(); }} onKeyUp={() => { if (initial) void commit(); }} />
        </div>
        <button className="btn-primary w-full" onClick={() => void commit()} disabled={!valid || saving}>{saving ? "Saving…" : !initial ? "Use this range" : dirty ? "Save range" : "Range saved"}</button>
      </fieldset>
      {!valid && <p className="text-sm" role="status">Choose a minimum at or below your maximum, up to $100,000.</p>}
      {error && <p className="text-sm" role="alert">{error}</p>}
      {guidance && <p className="text-sm opacity-75">Group gift guidance: {formatMinor(guidance.lowerMinor)}–{formatMinor(guidance.upperMinor)}. {guidance.responseCount} of {guidance.participantCount} ranges shared. {guidance.conflicting ? "Ranges differ widely; discuss what feels comfortable." : "Flexible guidance — gifts outside this range can still appear."}</p>}
    </div>}
  </aside>;
}
