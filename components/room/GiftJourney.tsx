"use client";

import type { MapDirection, PublishedClue, Recommendation } from "@/lib/contracts";
import { DecisionTrail } from "./HowWeGotHere";
import type { TrailEntry } from "./types";

/** Room-visible recorded decisions only; no new model call or private reasoning. */
export function GiftJourney({ listingId, recommendation, clues, directions, entries }: {
  listingId: string;
  recommendation?: Recommendation;
  clues: PublishedClue[];
  directions?: MapDirection[];
  entries?: TrailEntry[];
}) {
  const origin = recommendation?.foundBy;
  const direction = directions?.find(d => d.id === origin?.directionId);
  const citedIds = recommendation?.publishedClueIds ?? [];
  const memoryIds = [...new Set([...citedIds, ...(direction?.clueIds ?? []), ...(origin?.publishedClueId ? [origin.publishedClueId] : [])])];
  const memories = clues.filter(c => c.status === "active" && memoryIds.includes(c.id));
  return (
    <details className="group rounded-[16px] bg-white/55 px-4 py-3">
      <summary className="cursor-pointer list-none rounded-lg outline-offset-4 focus-visible:outline-2 focus-visible:outline-dusk [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-3">
          <span className="font-display text-[19px] leading-tight">Why this gift?</span>
          <span aria-hidden className="text-dusk/65 transition-transform group-open:rotate-180"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
        </span>
        <span className="mt-1 block text-[13.5px] leading-snug text-dusk/80">{recommendation?.explanation ?? "The organizer picked this one. No written reasoning was saved with it."}</span>
        <span className="mt-2 block text-[12px] font-semibold text-dusk/65 group-open:hidden">Follow the journey · memories, agents and decisions ↓</span>
        <span className="mt-2 hidden text-[12px] font-semibold text-dusk/65 group-open:block">Hide the journey ↑</span>
      </summary>
      <div className="mt-4 border-t border-dusk/10 pt-3">
        <h3 className="font-display text-xl">The path to this gift</h3>
        {memories.length > 0 && <div className="mt-2">
          <p className="text-xs font-semibold text-dusk/65">Memories behind the search</p>
          <ul className="mt-2 flex flex-col gap-1.5">{memories.map(c => <li key={c.id} className="rounded-lg bg-[#fff6e3] px-2.5 py-1.5 text-[12.5px] leading-snug text-dusk/85">“{c.text}”</li>)}</ul>
        </div>}
        {direction && <p className="mt-3 text-[13px] leading-relaxed"><strong>The council’s direction: {direction.label}.</strong> {direction.why}{direction.source === "preset" ? " Suggested by a simple rule, without a model call." : ""}</p>}
        {origin && <p className="mt-2 text-[13px] leading-relaxed">Product search: “{origin.query}”.{origin.source === "trend" ? " Inspired by a related search; the product itself is not claimed to be trending." : ""}</p>}
        {recommendation && citedIds.length === 0 && <p className="mt-2 text-xs text-dusk/65">No published memory directly matches this listing. The search brought it into consideration.</p>}
        <h3 className="mt-5 font-display text-xl">How the room got here</h3>
        {entries?.length ? <>
          <p className="mt-1 text-xs leading-relaxed text-dusk/65">{entries.length} recorded decisions. Highlighted steps connect to this gift; other steps show the room’s wider journey, including rejected ideas and agent checks.</p>
          <DecisionTrail entries={entries} focus={{ listingId, directionId: origin?.directionId, clueIds: memoryIds }} compact />
        </> : <p className="mt-2 text-[13px] leading-relaxed text-dusk/65">{entries === undefined ? "The room’s recorded decision history is not available here yet." : "No decisions have been recorded in this room yet."} The saved evidence above is all we can show.</p>}
      </div>
    </details>
  );
}
