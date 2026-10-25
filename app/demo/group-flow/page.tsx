"use client";

import { useState } from "react";
import { ConvergenceOverlay } from "@/components/convergence/ConvergenceOverlay";
import { convergence } from "@/components/convergence/convergenceClock";
import { BoxPanel } from "@/components/room/BoxPanel";
import { QuestionPoll } from "@/components/room/QuestionPoll";
import type { GiftSelection, ProposalView, QuestionPollView } from "@/lib/contracts";
import type { TrailEntry } from "@/components/room/types";
import { mockListings, mockParticipants, mockPublishedClues, mockRecommendations } from "@/lib/mocks/fixtures";
import { formatMinor } from "@/lib/money";
import { allocate } from "@/convex/allocations";

/** Offline UI rehearsal using the same components as the room. No backend/provider writes. */
export default function GroupFlowPreview() {
  const [person, setPerson] = useState(0);
  const [ballots, setBallots] = useState<Record<string, number>>({});
  const [closed, setClosed] = useState(false);
  const [questionVisible, setQuestionVisible] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [revision, setRevision] = useState(1);
  const [approved, setApproved] = useState<string[]>([]);
  const [caps, setCaps] = useState<Record<string, number>>({ p_alex: 20000, p_jordan: 20000 });
  const [giftVotes, setGiftVotes] = useState<Record<string, Record<string, number>>>({});
  const [boxOpen, setBoxOpen] = useState(true);
  const me = mockParticipants[person]!;
  const gifts = mockListings.slice(0, 2);
  const items = gifts.filter(l => selected.includes(l.id)).map(l => ({ listingId: l.id, quantity: 1 as const, listingSnapshot: {
    title: l.title, sourceUrl: l.sourceUrl, priceMinor: l.priceMinor, priceStatus: l.priceStatus,
    currency: l.currency, shippingMinor: l.shippingMinor, shippingStatus: l.shippingStatus, imageUrl: l.imageUrl, retrievedAt: l.retrievedAt,
  } }));
  const total = items.reduce((n, i) => n + (i.listingSnapshot.priceMinor ?? 0) + (i.listingSnapshot.shippingStatus === "observed" ? i.listingSnapshot.shippingMinor ?? 0 : 0), 0);
  const allocation = allocate({ payableTotalMinor: total, participants: mockParticipants.map(p => ({ participantId: p.id, limitMinor: caps[p.id] ?? 0 })) });
  const first = items[0];
  const selection: GiftSelection | null = first ? { id: `fixture-box-${revision}`, roomId: "room_demo", items,
    listingId: first.listingId, quantity: 1, listingSnapshot: first.listingSnapshot, status: "active", selectedBy: "p_alex", selectedAt: 1 } : null;
  const revisionId = `fixture-revision-${revision}`;
  const proposal: ProposalView = { feasible: allocation.feasible, myLimit: { participantId: me.id, roomId: "room_demo", amountMinor: caps[me.id] ?? 0, updatedAt: 1 },
    shares: allocation.feasible ? allocation.shares : [],
    approvals: approved.map(id => ({ id: `approval-${id}`, roomId: "room_demo", revisionId, participantId: id, status: "approved", updatedAt: 1 })),
    revision: first ? { id: revisionId, roomId: "room_demo", selectionId: selection!.id, items, listingId: first.listingId, quantity: 1,
      payableTotalMinor: total, currency: "USD", shares: allocation.feasible ? allocation.shares : [],
      conditions: allocation.feasible ? ["Sample prices only. Unknown shipping and tax are excluded."] : ["The group's limits don't cover the estimate."],
      status: !allocation.feasible ? "infeasible" : approved.length === 2 ? "approved_pledged" : "awaiting_approval", createdAt: 1 } : null };
  const counts = [0, 1].map(i => Object.values(ballots).filter(v => v === i).length);
  const leader = counts[0] === counts[1] ? null : counts[0]! > counts[1]! ? 0 : 1;
  const poll: QuestionPollView = { questionId: "fixture-question", counts, votedCount: Object.keys(ballots).length,
    memberCount: 2, myOption: ballots[me.id] ?? null, leader, tied: leader === null && Object.keys(ballots).length > 0,
    stale: false, open: !closed, canFinish: !closed && person === 0 && leader !== null };
  const net = (id: string) => Object.values(giftVotes[id] ?? {}).reduce((n, v) => n + v, 0);
  const order = [...gifts].sort((a, b) => net(b.id) - net(a.id) || counts[gifts.indexOf(b)]! - counts[gifts.indexOf(a)]! || a.id.localeCompare(b.id));
  // Clearly labelled sample history, not live agent/provider activity.
  const sampleAt = gifts[0]!.retrievedAt;
  const sampleTrail: TrailEntry[] = [
    { _id: "sample-memories" as TrailEntry["_id"], stage: "memories", actor: "person", outcome: "kept", who: "Alex", text: "Sample: shared an interest in pottery; Jordan shared that she already owns a starter kit.", clueIds: ["c1", "c2"] as NonNullable<TrailEntry["clueIds"]>, at: sampleAt - 3000 },
    { _id: "sample-council" as TrailEntry["_id"], stage: "council", actor: "council", outcome: "kept", text: "Sample: considered a pottery experience and tools that build on her hobby.", clueIds: ["c1"] as NonNullable<TrailEntry["clueIds"]>, at: sampleAt - 2000 },
    { _id: "sample-checks" as TrailEntry["_id"], stage: "council", actor: "checks", outcome: "rejected", text: "Sample: ruled out another starter kit because she already owns one.", clueIds: ["c2"] as NonNullable<TrailEntry["clueIds"]>, at: sampleAt - 1500 },
    { _id: "sample-search" as TrailEntry["_id"], stage: "search", actor: "search", outcome: "kept", text: "Sample: loaded two fixture gifts. No live product search was run.", at: sampleAt - 1000 },
    ...items.map((it, i): TrailEntry => ({ _id: `sample-choice-${i}` as TrailEntry["_id"], stage: "choice", actor: "person", outcome: "kept", who: "Alex", listingId: it.listingId as NonNullable<TrailEntry["listingId"]>, text: `Added ${it.listingSnapshot.title} to the local demo box.`, at: sampleAt + i })),
  ];
  const reveal = () => { if (selection) { convergence.abort(); convergence.start({ selectionId: selection.id, inputs: [], total: 0, instant: true }); } };
  const resetDeal = () => { setRevision(r => r + 1); setApproved([]); };
  return <main className="min-h-screen bg-ivory p-5 text-dusk md:p-10">
    <div className="mx-auto max-w-[1100px]">
      <h1 className="font-display text-4xl">unwrap. · group flow</h1>
      <p className="my-3 max-w-2xl text-sm">Local fixture rehearsal. Play two people, vote on the question and gifts, and add multiple sample products. No backend calls, charges, or purchases.</p>
      <div className="my-5 flex flex-wrap gap-3">{mockParticipants.map((p, i) => <button key={p.id} type="button" className="btn-secondary px-4 py-2" aria-pressed={person === i} onClick={() => setPerson(i)}>{p.displayName} · {p.role}</button>)}
        <button className="btn-secondary px-4 py-2" onClick={() => setBoxOpen(true)}>Open box · {items.length} gifts</button></div>
      <div className="flex flex-wrap items-start gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {questionVisible && <QuestionPoll question={{ question: "An experience together, or tools for her hobby?", options: [{ label: "Experience" }, { label: "Equipment" }] }} poll={poll} pending={false}
            onVote={option => setBallots(old => { const next = { ...old }; if (option === null) delete next[me.id]; else next[me.id] = option; return next; })}
            onFinish={person === 0 ? () => setClosed(true) : undefined} onSkip={() => setQuestionVisible(false)} />}
          <div className="flex flex-col gap-4" aria-label="Ranked sample gifts">{order.map((gift, rank) => <article key={gift.id} className="rounded-2xl border border-dusk/15 bg-white/50 p-4">
            <small>#{rank + 1} · sample · {net(gift.id)} net gift votes</small><h2 className="font-display text-2xl">{gift.title}</h2><p>{formatMinor(gift.priceMinor!)} · illustrative fixture price</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary px-4 py-2" disabled={person !== 0 || selected.includes(gift.id)} onClick={() => { setSelected(ids => [...ids, gift.id]); resetDeal(); setBoxOpen(true); }}>{selected.includes(gift.id) ? "In the box ✓" : "Add to box"}</button>
              {[1, -1].map(v => <button key={v} type="button" className="btn-secondary px-3 py-2" aria-pressed={giftVotes[gift.id]?.[me.id] === v} onClick={() => setGiftVotes(all => ({ ...all, [gift.id]: { ...all[gift.id], [me.id]: all[gift.id]?.[me.id] === v ? 0 : v } }))}>{v > 0 ? "Feels right" : "Pass"}</button>)}
            </div>
          </article>)}</div>
        </div>
        {boxOpen && <BoxPanel proposal={proposal} selection={selection} participants={mockParticipants} me={me} isOrganizer={person === 0}
          avatarOf={() => "curious"} colorOf={() => "#957b9c"} why={false} onWhy={() => undefined} onClose={() => setBoxOpen(false)} onReveal={reveal} revealLabel="Preview every gift"
          actions={{ setLimit: async amount => { setCaps(old => ({ ...old, [me.id]: amount })); resetDeal(); return { ok: true, value: null }; },
            approve: async () => { setApproved(ids => [...new Set([...ids, me.id])]); return { ok: true, value: null }; },
            withdrawApproval: async () => { setApproved(ids => ids.filter(id => id !== me.id)); return { ok: true, value: null }; },
            clearSelection: async () => { setSelected([]); resetDeal(); return { ok: true, value: null }; },
            removeGiftFromBox: async id => { setSelected(ids => ids.filter(item => item !== id)); resetDeal(); return { ok: true, value: null }; },
          }} />}
      </div>
    </div>
    {selection && <ConvergenceOverlay gift={{ selection, listings: gifts, clues: mockPublishedClues, recommendations: mockRecommendations, trail: sampleTrail }} isOrganizer={person === 0} onPlan={() => setBoxOpen(true)} onReplay={reveal} />}
  </main>;
}
