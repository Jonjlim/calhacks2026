"use client";

import { useState } from "react";
import { ContributionSimulation } from "@/components/payments/ContributionSimulation";
import type { ContributionSimulationView } from "@/lib/contracts";

/** Local fixture preview of the reusable box component, not a real room or payment. */
export default function ContributionPreview() {
  const [person, setPerson] = useState<"alex" | "sam">("alex");
  const [completed, setCompleted] = useState<string[]>([]);
  const [wrapped, setWrapped] = useState(false);
  const [revision, setRevision] = useState(1);
  const [approved, setApproved] = useState(true);
  const allDone = completed.length === 2;
  const view: ContributionSimulationView = {
    mode: "simulation", revisionId: `fixture-revision-${revision}`,
    status: !approved ? "waiting_for_approvals" : wrapped ? "wrapped" : allDone ? "complete" : completed.length ? "collecting" : "ready",
    payerCount: 2, completedCount: approved ? completed.length : 0,
    myShareMinor: person === "alex" ? (revision === 1 ? 2500 : 3000) : (revision === 1 ? 1500 : 1000),
    myCompleted: completed.includes(person), canSimulate: approved && !completed.includes(person),
    canWrap: approved && allDone && !wrapped && person === "alex",
  };
  return <main className="min-h-screen bg-ivory px-5 py-10 text-dusk">
    <div className="mx-auto max-w-[950px]">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-dusk/10 pb-5">
        <span className="font-display text-3xl">unwrap.</span><span className="text-xs text-plum-soft">Local component preview · sample gift and shares · no backend writes</span>
      </header>
      <div className="grid items-start gap-12 md:grid-cols-[1fr_440px]">
        <div className="pt-8"><p className="text-[10px] tracking-[.18em] text-plum-soft">THE GIFT BOX / CONTRIBUTION ENDING</p>
          <h1 className="mt-4 font-display text-5xl leading-[1.05]">A little bit<br/>of <em>all of you.</em></h1>
          <p className="mt-5 max-w-[330px] text-sm leading-7 text-plum-soft">Memories become one gift. Everyone approves their share, tries the payment simulation, and the organizer ties the ribbon.</p>
          <div className="mt-9 space-y-4 rounded-2xl border border-dusk/10 bg-white/30 p-5 text-xs">
            <p className="font-medium">Fixture controls — play both people in this tab</p>
            <div className="flex gap-2">{(["alex", "sam"] as const).map(p => <button key={p} aria-pressed={person === p} onClick={() => setPerson(p)} className={`rounded-full border px-4 py-2 ${person === p ? "bg-dusk text-ivory" : "border-dusk/20"}`}>{p === "alex" ? "Alex · organizer" : "Sam · contributor"}</button>)}</div>
            <p>Sample total: $40. Shipping and tax unknown.</p>
            <button className="block underline underline-offset-4" onClick={() => { setRevision(revision === 1 ? 2 : 1); setCompleted([]); setWrapped(false); setApproved(false); }}>Change shares → reset approvals and progress</button>
            {!approved && <button className="block underline underline-offset-4" onClick={() => setApproved(true)}>Simulate both people approving the new revision</button>}
            <button className="block underline underline-offset-4" onClick={() => { setPerson("alex"); setCompleted([]); setWrapped(false); setRevision(1); setApproved(true); }}>Reset fixture</button>
          </div>
          <p className="mt-5 max-w-[330px] text-xs leading-6 text-plum-soft">This preview uses local sample state. In a real room, the connected component uses membership-checked Convex functions so each person can complete only their own simulation.</p>
        </div>
        <ContributionSimulation key={`${person}-${revision}`} view={view} giftTitle="A Sunday morning pottery set · sample"
          onSimulate={async () => { if (view.canSimulate) setCompleted(c => [...new Set([...c, person])]); return { ok: true, value: view }; }}
          onWrap={async () => { if (view.canWrap) setWrapped(true); return { ok: true, value: view }; }} />
      </div>
    </div>
  </main>;
}
