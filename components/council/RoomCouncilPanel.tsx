"use client";
import { useConvexConnectionState } from "convex/react";
import { useEffect, useState } from "react";
import { COUNCIL_ACTORS, reduceCouncil } from "@/lib/council/contracts";
import { COUNCIL_LABEL, COUNCIL_TINT, poseFor } from "@/lib/council/animation";
import type { RoomActions, RoomData } from "@/components/room/types";
import { useResultAction } from "@/lib/useResultAction";

export function RoomCouncilPanel({ data, actions, compact = false }: { data: RoomData; actions: RoomActions; compact?: boolean }) {
  const connection = useConvexConnectionState();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const council = data.council;
  const run = council?.run;
  const members = reduceCouncil(council?.events ?? []);
  const ask = useResultAction(actions.startResearch);
  const resume = useResultAction(actions.resumeCouncil);
  const clues = data.publishedClues.filter(c => c.status === "active");
  const interrupted = run?.status === "running" && now - run.updatedAt > 120000;
  const busy = run?.status === "running" || run?.status === "uncertain";
  const label = !connection.isWebSocketConnected ? "Reconnecting to your room…" : interrupted ? "The council was interrupted" : run?.status === "completed" ? "The gifts are ready to explore" : run?.status === "partial" ? "A charm is ready; the search needs attention" : run?.status === "uncertain" ? "Checking an interrupted request" : run?.status === "failed" ? "The council needs another try" : busy ? "A little thoughtfulness, in motion" : "Let’s find something that feels like them";
  const action = run?.status === "uncertain"
    ? <button className="btn-primary h-11 px-5 text-[15px]" disabled={resume.pending || !connection.isWebSocketConnected} onClick={() => resume.run(run.runId)}>Resume</button>
    : <button className="btn-primary h-11 px-5 text-[15px]" disabled={busy || ask.pending || clues.length === 0 || !connection.isWebSocketConnected} onClick={() => ask.run(clues.map(c => c.id))}>{busy ? "Working…" : "Ask the council"}</button>;
  if (compact) return <section className="paper-card rounded-[22px] p-4" aria-label="AI Council">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex gap-1.5" aria-hidden>{COUNCIL_ACTORS.map(actor => <span key={actor} className={`h-3 w-3 rounded-full ring-2 ring-offset-1 ring-offset-paper ${members[actor].status === "failed" ? "ring-coral" : members[actor].status === "completed" ? "ring-[#768b62]" : members[actor].status === "started" ? "ring-gold animate-pulse" : "ring-transparent"}`} style={{ background: COUNCIL_TINT[actor] }} />)}</div>
        <p role="status" className="mt-1.5 text-[14px] leading-snug text-dusk/80">{label}</p>
      </div>
      {action}
    </div>
    {!clues.length && <p className="mt-2 text-xs text-dusk/60">Add a memory first so Scout has a direction.</p>}
    {run?.error && <p className="mt-2 text-[13px] text-[#8c3b2c]">{run.error}</p>}
    {(ask.error || resume.error) && <p role="alert" className="mt-2 text-sm text-[#8c3b2c]">{(ask.error ?? resume.error)?.message}</p>}
    <ul className="sr-only">{COUNCIL_ACTORS.map(actor => <li key={actor}>{COUNCIL_LABEL[actor]}: {members[actor].summary ?? poseFor(members[actor]).caption}</li>)}</ul>
  </section>;
  return <section className="paper-card rounded-[24px] p-5" aria-label="AI Council">
    <p className="font-hand text-[23px] text-dusk/60">Small friends. Thoughtful gifts.</p>
    <h2 className="font-display text-[30px] leading-tight text-dusk">Your gift council</h2>
    <p role="status" className="mt-2 text-sm text-dusk/75">{label}</p>
    <ul className="my-4 flex flex-col gap-2">
      {COUNCIL_ACTORS.map(actor => <li key={actor} className="flex gap-3 text-sm">
        {/* Swatch in the robot's role colour; its ring shows the task state. */}
        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ring-2 ring-offset-1 ring-offset-paper ${members[actor].status === "failed" ? "ring-coral" : members[actor].status === "completed" ? "ring-[#768b62]" : members[actor].status === "started" ? "ring-gold animate-pulse" : "ring-transparent"}`} style={{ background: COUNCIL_TINT[actor] }} aria-hidden />
        <div><span className="font-semibold text-dusk">{COUNCIL_LABEL[actor]}</span><span className="ml-2 text-dusk/65">{members[actor].summary ?? poseFor(members[actor]).caption}</span><span className="sr-only"> ({members[actor].status === "started" ? "working" : members[actor].status})</span></div>
      </li>)}
    </ul>
    {run?.error && <p className="mb-3 rounded-xl bg-coral/10 p-3 text-sm text-[#8c3b2c]">{run.error}</p>}
    {run?.stale && <p className="mb-3 text-sm">The clues have changed since this request. Existing gifts are rechecked against your current clues.</p>}
    {run?.cached && <p className="mb-3 text-xs text-dusk/65">Cached research · original observation times are shown on each gift.</p>}
    {run?.status === "uncertain" ? <button className="btn-primary" disabled={resume.pending || !connection.isWebSocketConnected} onClick={() => resume.run(run.runId)}>Resume this request</button> : <button className="btn-primary" disabled={busy || ask.pending || clues.length === 0 || !connection.isWebSocketConnected} onClick={() => ask.run(clues.map(c => c.id))}>{busy ? "The council is working…" : "Ask the council"}</button>}
    {!clues.length && <p className="mt-2 text-xs text-dusk/65">Share an interest or wish below to give Scout a direction.</p>}
    {(ask.error || resume.error) && <p role="alert" className="mt-3 text-sm text-[#8c3b2c]">{(ask.error ?? resume.error)?.message}</p>}
    {!!run?.excluded.length && <details className="mt-4 text-xs text-dusk/70"><summary className="cursor-pointer">Why some ideas didn’t make the shortlist</summary><ul className="mt-2 space-y-2">{run.excluded.map((e, i) => <li key={i}><strong>{e.title}</strong>: {e.reason}</li>)}</ul></details>}
    {!!council?.decorations.length && <p className="mt-3 font-hand text-xl text-dusk/60">On the ribbon: {council.decorations.map(d => d.label).join(", ")}. These charms represent your memories.</p>}
  </section>;
}
