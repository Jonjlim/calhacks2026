"use client";

import { useEffect, useMemo, useState } from "react";
import { SAMPLE_SESSION } from "@/lib/council/sampleSession";
import type { CouncilEvent } from "@/lib/council/contracts";
import { RoomLayout } from "@/components/room/RoomLayout";
import type { RoomActions, RoomData } from "@/components/room/types";
import type { GiftSelection, ProductListing, PublishedClue, Recommendation, VoteValue } from "@/lib/contracts";
import { mockApprovals, mockListings, mockMessages, mockParticipants, mockProposedClues, mockPublishedClues, mockRecommendations, mockRevision, mockRoom } from "@/lib/mocks/fixtures";
import { setTimeOfDay } from "@/components/world/scenePalette";

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#fbeedd"/><ellipse cx="100" cy="168" rx="58" ry="9" fill="#e6cdb4"/><path d="M60 70c0-14 80-14 80 0 6 30 10 60-14 92-8 10-44 10-52 0C50 130 54 100 60 70z" fill="#c9694d"/><ellipse cx="100" cy="70" rx="40" ry="9" fill="#a9523b"/><path d="M62 110c30 12 56 12 76 0" stroke="#f3d6a8" stroke-width="6" fill="none"/></svg>`,
)}`;

/**
 * Development only (`/room/dev-reveal`): the gift map with fixture data and a
 * chosen gift already in the box, so the Great Gift Convergence can be watched
 * and tested without a backend or a paid search. `?pick=l2` chooses another
 * fixture, `?photo=0` shows the missing-photo fallback. Never reachable in a
 * production build.
 */
const BUSY_TITLES = ["Hand-thrown ceramic mug set", "Watercolor pocket field kit", "Trail-ready day pack", "Cozy wool reading blanket", "Stargazing star map print", "Pour-over coffee starter set", "Succulent terrarium kit", "Hand-bound travel sketchbook", "Linen picnic blanket", "Beginner embroidery hoop kit", "Glass tea infuser bottle", "Leather bound journal"];

export function RevealHarness() {
  const [ready, setReady] = useState(false);
  // Stand-ins for the room's voting and choosing, so the Book of Possibilities can be used without a backend.
  const [votes, setVotes] = useState<Record<string, VoteValue | undefined>>({});
  // `?finale=plan|checkout|wrap|end` starts the simulated checkout at that step, so the last screens can be walked without a backend.
  const [simDone, setSimDone] = useState<{ completed: number; wrapped: boolean; start: string }>(() => ({ completed: 0, wrapped: false, start: typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("finale") ?? "" }));
  const [chosenId, setChosenId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    // `?sky=sunrise|sunset|bluehour|day|night` previews a sky; the default is the room's own (sunrise).
    const sky = new URLSearchParams(window.location.search).get("sky");
    if (sky) setTimeOfDay(sky as Parameters<typeof setTimeOfDay>[0], { remember: false });
    setReady(true);
  }, []);
  // `?council=live` replays a recorded council run event by event, as live runs arrive.
  const [events, setEvents] = useState<CouncilEvent[]>([]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("council") !== "live") return;
    const t0 = Date.now();
    const timers = SAMPLE_SESSION.map(({ at, event }) => setTimeout(() => setEvents((e) => [...e, { ...event, timestamp: Date.now() }]), at + 3000));
    void t0;
    return () => timers.forEach(clearTimeout);
  }, []);
  const data = useMemo<RoomData | null>(() => {
    if (!ready) return null;
    const params = new URLSearchParams(window.location.search);
    const pick = params.get("pick") ?? "l1";
    const photo = params.get("photo") !== "0";
    // `?many=1`: a fuller room, to see the waves of memories, wishes and ideas fly in.
    const many = params.get("many") === "1";
    const extra: PublishedClue[] = many
      ? [
          ["interest", "Paints watercolours on Sunday mornings"],
          ["interest", "Collects tiny succulents on every windowsill"],
          ["explicit_wish", "Wants a proper reading lamp"],
          ["interest", "Stargazing on the roof in summer"],
          ["interest", "Always has a mug of tea going"],
          ["explicit_wish", "Has been meaning to try a ceramics night"],
          ["interest", "The best at planning surprise picnics"],
          ["interest", "Gift idea: a wheel-throwing class"],
          ["interest", "Gift idea: a hand-bound sketchbook"],
          ["interest", "Gift idea: a little greenhouse kit"],
        ].map(([kind, text], i) => ({ ...mockPublishedClues[0]!, id: `x${i}`, kind: kind as PublishedClue["kind"], text: text!, publisherId: mockParticipants[i % 2]!.id }))
      : [];
    // `?busy=1`: a busy room, with a dozen researched gifts and several that share memories.
    const busy = params.get("busy") === "1";
    const clueIds = [...mockPublishedClues, ...extra].map((c) => c.id);
    const extraListings: ProductListing[] = busy
      ? BUSY_TITLES.map((title, i) => ({ ...mockListings[i % 3]!, id: `b${i}`, title, sourceUrl: i % 4 === 0 ? "https://www.google.com/search?tbm=shop&q=sample" : `https://example.com/fixture/b${i}`, priceMinor: i % 5 === 4 ? undefined : 2400 + i * 1350, priceStatus: i % 5 === 4 ? "unknown" : "observed", imageUrl: i % 3 === 2 ? undefined : PHOTO }))
      : [];
    const extraRecs: Recommendation[] = extraListings.map((l, i) => ({ ...mockRecommendations[0]!, id: `br${i}`, listingId: l.id, score: 0.8 - i * 0.04, publishedClueIds: [...new Set([clueIds[i % clueIds.length]!, clueIds[(i * 3 + 1) % clueIds.length]!, ...(i % 3 === 0 ? ["c1"] : [])])], explanation: `Matches what ${["Jordan", "Alex"][i % 2]} shared about ${["pottery", "painting", "time outdoors", "cozy evenings"][i % 4]}.` }));
    const listings: ProductListing[] = [...mockListings, ...extraListings].map((l) => (l.id === pick && photo ? { ...l, imageUrl: PHOTO } : l));
    const chosen = chosenId === null || (chosenId === undefined && pick === "none") ? undefined : listings.find((l) => l.id === (chosenId ?? pick)) ?? listings[0]!;
    const selection: GiftSelection | null = !chosen ? null : {
      id: `sel_${chosen.id}`,
      roomId: "dev-reveal",
      listingId: chosen.id,
      quantity: 1,
      listingSnapshot: { title: chosen.title, sourceUrl: chosen.sourceUrl, priceMinor: chosen.priceMinor, priceStatus: chosen.priceStatus, retrievedAt: chosen.retrievedAt },
      status: "active",
      selectedBy: mockParticipants[0]!.id,
      selectedAt: chosen.retrievedAt,
    };
    return {
      view: { room: { ...mockRoom, id: "dev-reveal" }, participants: mockParticipants, me: mockParticipants[0]! },
      messages: mockMessages,
      myProposedClues: mockProposedClues,
      publishedClues: [...mockPublishedClues, ...extra],
      recommendations: [...mockRecommendations, ...extraRecs],
      listings,
      proposal: { revision: mockRevision, shares: mockRevision.shares, approvals: mockApprovals, feasible: true },
      votes: Object.fromEntries(Object.entries(votes).filter(([, v]) => v).map(([id, v]) => [id, { tally: { up: v === "up" ? 1 : 0, down: v === "down" ? 1 : 0 }, myVote: v }])) as RoomData["votes"],
      selection,
      evidence: [],
      council: { run: null, events, decorations: [], excluded: [] } as unknown as RoomData["council"],
      simulation: (() => {
        const payers = mockRevision.shares.filter((x) => x.amountMinor > 0);
        const start = simDone.start;
        if (!start) return undefined;
        const base = start === "end" || simDone.wrapped ? "wrapped" : start === "wrap" ? "complete" : start === "checkout" ? "ready" : "waiting_for_approvals";
        const completedCount = base === "wrapped" || base === "complete" ? payers.length : Math.min(payers.length, simDone.completed);
        const status = base === "wrapped" ? "wrapped" : base === "complete" || (base === "ready" && completedCount === payers.length) ? "complete" : base === "ready" && completedCount > 0 ? "collecting" : base;
        const mine = payers.find((x) => x.participantId === mockParticipants[0]!.id)?.amountMinor ?? payers[0]?.amountMinor ?? 0;
        return {
          view: { mode: "simulation" as const, revisionId: mockRevision.id, status, payerCount: payers.length, completedCount, myShareMinor: mine, myCompleted: simDone.completed > 0 || base === "complete" || base === "wrapped", canSimulate: base === "ready" && simDone.completed === 0, canWrap: status === "complete" },
          simulate: async () => { setSimDone((s) => ({ ...s, completed: payers.length })); return { ok: true as const, value: {} }; },
          wrap: async () => { setSimDone((s) => ({ ...s, wrapped: true })); return { ok: true as const, value: {} }; },
        };
      })(),
    };
  }, [ready, events, votes, chosenId, simDone]);
  const actions = useMemo(() => {
    const ok = async () => ({ ok: true as const, value: {} });
    const own = {
      castVote: async (id: string, value: VoteValue) => { setVotes((v) => ({ ...v, [id]: value })); return ok(); },
      clearVote: async (id: string) => { setVotes((v) => ({ ...v, [id]: undefined })); return ok(); },
      selectGift: async (id: string) => { setChosenId(id); return ok(); },
      clearSelection: async () => { setChosenId(null); return ok(); },
    };
    // Anything else (cursors, research, ...) quietly succeeds, so the page behaves like a live room.
    return new Proxy(own, { get: (t, k) => (t as Record<string | symbol, unknown>)[k] ?? ok }) as unknown as RoomActions;
  }, []);
  return data ? <RoomLayout data={data} actions={actions} /> : null;
}
