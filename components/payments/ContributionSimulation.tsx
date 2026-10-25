"use client";

import type { ContributionSimulationView, Result } from "@/lib/contracts";
import { formatMinor } from "@/lib/money";
import { useResultAction } from "@/lib/useResultAction";
import { ErrorText } from "@/components/ui/ErrorText";
import styles from "./contribution-simulation.module.css";

/** Mount in the ring map's box. Receives real revision state; never infers payment success. */
export function ContributionSimulation({ view, giftTitle, onSimulate, onWrap }: {
  view: ContributionSimulationView;
  giftTitle?: string;
  onSimulate?: () => Promise<Result<ContributionSimulationView>>;
  onWrap?: () => Promise<Result<ContributionSimulationView>>;
}) {
  const simulate = useResultAction(onSimulate);
  const wrap = useResultAction(onWrap);
  const wrapped = view.status === "wrapped";
  const pending = simulate.pending || wrap.pending;
  const waiting = view.status === "waiting_for_approvals";
  const unavailable = view.status === "no_proposal" || view.status === "unavailable";
  return (
    <section className={`${styles.card} ${wrapped ? styles.wrapped : ""}`} aria-label="Payment simulation">
      <div className={styles.topline}><span className={styles.badge}>Payment simulation</span><span>Revision-bound · USD</span></div>
      <div className={styles.box} aria-hidden="true">
        <svg viewBox="0 0 200 180"><ellipse cx="100" cy="164" rx="61" ry="8" fill="#41344c10"/>
          <path d="M40 68 100 47 162 69 100 91Z" fill="#efe2c6"/><path d="m40 68 60 23v70l-60-25Z" fill="#e7d7b5"/><path d="m100 91 62-22-2 69-60 23Z" fill="#d6c4a1"/>
          <path d="m67 79 15 6v68l-15-6Z" fill="#c58e7d"/><path d="m125 82 14-5-2 68-14 6Z" fill="#b88173"/>
          <g className={styles.lid}><path d="m32 60 68-23 70 24-70 25Z" fill="#f3e6ca" stroke="#d2bd99"/><path d="m32 60 68 24v12L32 72Z" fill="#e5d2aa"/><path d="m100 84 70-23v12l-70 23Z" fill="#cfba95"/>
          <path d="m63 49 14-5 62 23-15 6Z" fill="#c99381"/><path d="m125 45 14 5-68 24-14-5Z" fill="#d9a48e"/>
          <path d="M100 51Q60 47 69 22Q80 6 101 47Q124 9 137 26Q148 48 100 51Z" fill="none" stroke="#bb8975" strokeWidth="6"/>
          <path d="M101 48Q100 67 80 80M101 48Q119 59 128 74" fill="none" stroke="#bb8975" strokeWidth="6" strokeLinecap="round"/></g>
          <g className={styles.sparkles} fill="#d9b66f"><path d="m172 35 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/><path d="m26 100 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/></g>
        </svg>
      </div>
      <p className={styles.eyebrow}>{wrapped ? "A LITTLE OF ALL OF YOU" : "ONE GIFT. EVERYONE HAS A SAY."}</p>
      <h2>{wrapped ? "Wrapped, together." : "The last little step."}</h2>
      {giftTitle && <p className={styles.gift}>{giftTitle}</p>}
      <p className={styles.intro}>{wrapped ? "Your shared memories led here. The demo gift is ready." : "Try the contribution flow after everyone approves this proposal."}</p>
      <div className={styles.progress} aria-label={`${view.completedCount} of ${view.payerCount} simulated contributions complete`}>
        <span style={{ width: `${view.payerCount ? view.completedCount / view.payerCount * 100 : 0}%` }} />
      </div>
      <p className={styles.count} role="status">{view.completedCount} of {view.payerCount} simulated contributions complete</p>
      <div className={styles.share}><span>Your share of the estimate</span><strong>{formatMinor(view.myShareMinor)}</strong></div>
      <p className={styles.estimate}>Uses the current proposal estimate. Unknown shipping and tax are not included.</p>
      {waiting && <p className={styles.note}>Waiting for everyone to approve this revision. Changes reset demo progress.</p>}
      {unavailable && <p className={styles.note}>{view.status === "no_proposal" ? "Choose a gift and approve a proposal first." : "This proposal is not available for the contribution simulation."}</p>}
      {!unavailable && !waiting && !wrapped && <>
        {view.myShareMinor === 0 ? <p className={styles.note}>You have no share to simulate.</p> : view.myCompleted ? <p className={styles.done}>✓ Your simulated contribution is complete.</p> :
          <button className={styles.primary} disabled={!view.canSimulate || !onSimulate || pending} onClick={() => simulate.run()}>{simulate.pending ? "Simulating…" : `Simulate payment · ${formatMinor(view.myShareMinor)}`}</button>}
        {view.status === "complete" ? <p className={styles.note}>Everyone is ready. The organizer can wrap the demo gift.</p> : <p className={styles.note}>The ribbon waits for every contributor.</p>}
        <button className={styles.wrap} disabled={!view.canWrap || !onWrap || pending} onClick={() => wrap.run()}>{wrap.pending ? "Wrapping…" : "Wrap the demo gift ↗"}</button>
      </>}
      <ErrorText error={simulate.error ?? wrap.error} />
      <p className={styles.disclaimer}><strong>No money charged or gift purchased.</strong><br/>This is a simulation, not a Stripe checkout or merchant order.</p>
    </section>
  );
}
