"use client";

import { useEffect, useMemo, useState } from "react";
import { RoomLayout } from "@/components/room/RoomLayout";
import type { RoomData } from "@/components/room/types";
import type { GiftSelection, ProductListing, PublishedClue } from "@/lib/contracts";
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
export function RevealHarness() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setTimeOfDay("day");
    setReady(true);
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
    const listings: ProductListing[] = mockListings.map((l) => (l.id === pick && photo ? { ...l, imageUrl: PHOTO } : l));
    const chosen = listings.find((l) => l.id === pick) ?? listings[0]!;
    const selection: GiftSelection = {
      id: "sel_1",
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
      recommendations: mockRecommendations,
      listings,
      proposal: { revision: mockRevision, shares: mockRevision.shares, approvals: mockApprovals, feasible: true },
      votes: {},
      selection,
      evidence: [],
    };
  }, [ready]);
  return data ? <RoomLayout data={data} /> : null;
}
