"use client";

import { type CSSProperties, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MapIcon } from "@/components/world/room/MapIcon";
import type { RingAction, RingDetail, RingsWorld } from "@/components/world/room/GiftRings";
import s from "./gift-orbit.module.css";

/** Four main choices around the real product; rare actions stay out of its orbit. */
export function GiftOrbitMenu({ gift, detail, evaluations, onClose }: {
  gift: RingsWorld["gifts"][number];
  detail: RingDetail;
  evaluations?: NonNullable<RingsWorld["evaluations"]>[string];
  onClose(): void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const [primary, support, pass] = [detail.actions.find(a => a.tone === "gold"), detail.actions.find(a => a.icon === "heart"), detail.actions.find(a => a.label === "Pass")];
  const why = detail.actions.find(a => a.label === "How we got here") ?? detail.actions.find(a => a.label === "Why?");
  const source = detail.actions.find(a => a.label === "Open the listing");
  const main = [why, support, pass, primary].filter((a): a is RingAction => !!a);
  const extra = detail.actions.filter(a => !main.includes(a) && a !== source && a.label !== "Why?");
  const choosingReason = !primary;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [gift.key]);
  const action = (a: RingAction, i: number, orbit = true) => <button key={a.label} type="button"
    className={`${orbit ? s.action : s.secondary} ${a.tone ? s[a.tone] : ""}`} style={{ "--slot": i } as CSSProperties}
    aria-pressed={a.on} disabled={a.disabled} onClick={a.run}>
    <MapIcon name={a.icon} size={21} /><span>{a === why ? "Why this gift?" : a.label}</span>
  </button>;
  return createPortal(<div className={s.backdrop} onPointerDown={e => e.stopPropagation()} onClick={onClose}>
    <section className={s.stage} role="dialog" aria-modal="true" aria-label={`Gift: ${gift.title}`}
      onClick={e => e.stopPropagation()} onKeyDown={e => {
        if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        if (e.key !== "Tab") return;
        const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), summary'));
        const first = focusable[0], last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }}>
      <header className={s.header}><small>A closer look</small><h2 title={gift.title}>{gift.title}</h2></header>
      <button ref={close} type="button" className={s.close} aria-label="Back to the map" onClick={onClose}>×</button>
      <div className={s.item}>
        <div className={s.photo}>{gift.imageUrl ? <img src={gift.imageUrl} alt={gift.title} /> : <MapIcon name="present" size={48} />}</div>
        <strong>{gift.price}</strong>
        <span className={s.tally} aria-live="polite">{gift.up} feels right · {gift.down} {gift.down === 1 ? "pass" : "passes"}</span>
        {(support?.on || pass?.on) && <span className={s.feedback} key={`${support?.on}-${pass?.on}`}>{support?.on ? "You pulled this gift in" : "You passed on this gift"}</span>}
      </div>
      {!choosingReason && <nav className={s.orbit} aria-label="Gift actions">{main.map((a, i) => action(a, i))}</nav>}
      <footer className={s.footer}>
        {detail.note && <div className={s.reason}>{detail.note}</div>}
        {choosingReason ? <div className={s.reason}><div>{detail.caption}</div><div className={s.extra}>{detail.actions.map((a, i) => action(a, i, false))}</div></div> : <>
          {source && <button type="button" className={s.link} onClick={source.run}>View source listing <MapIcon name="open" size={13} /></button>}
          {(extra.length > 0 || !!evaluations?.length) && <details className={s.more}><summary>More options</summary><div className={s.extra}>{extra.map((a, i) => action(a, i, false))}</div>
            {evaluations?.map(e => <p key={e.id}><b>{e.author} · AI advice:</b> {e.text}</p>)}
          </details>}
        </>}
      </footer>
    </section>
  </div>, document.body);
}
