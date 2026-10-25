"use client";

import { useEffect, useState } from "react";
import type { RoomData } from "@/components/room/types";
import { COUNCIL_LABEL, COUNCIL_TINT, poseFor } from "@/lib/council/animation";
import type { CouncilActor, CouncilMemberState } from "@/lib/council/contracts";
import { ROLE_LINE, thoughtFor } from "@/lib/council/thoughts";
import { agentHistory, agoText, durationText } from "@/lib/room/agentHistory";

/**
 * One council member's own page: what it is thinking right now, what it is for,
 * and everything it has done in this room, newest first, with how long each
 * thing took and what came of it. The thought follows the member's real state
 * (it only appears while a task is running); the history is the stored task
 * events and jobs, never invented.
 */
const MARK = { working: "…", waiting: "…", done: "✓", failed: "✕" } as const;
const WORD = { working: "Working on it", waiting: "Waiting", done: "Done", failed: "Didn't work" } as const;

export function AgentDetails({ actor, member, data }: { actor: CouncilActor; member: CouncilMemberState; data: RoomData }) {
  const tint = COUNCIL_TINT[actor];
  const [now, setNow] = useState(() => Date.now());
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const working = member.status === "started";
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTurn((n) => n + 1), 3200);
    return () => clearInterval(t);
  }, [working]);
  const history = agentHistory(data, actor);
  const done = history.filter((h) => h.status === "done").length;
  const failed = history.filter((h) => h.status === "failed").length;

  // What it is thinking: a live line while it works, otherwise the last thing it said it did.
  const thought = working ? thoughtFor(actor, turn) : member.status === "failed" ? member.summary ?? poseFor(member).caption : member.status === "completed" ? member.summary ?? poseFor(member).caption : null;
  const heading = working ? "Thinking right now" : member.status === "idle" ? "Resting" : member.status === "failed" ? "It got stuck" : "Last thing it said";

  return (
    <section aria-label={`${COUNCIL_LABEL[actor]}, the ${actor}`} className="flex flex-col gap-4">
      <header>
        <p className="text-[12px] font-semibold tracking-wide uppercase" style={{ color: tint }}>The council</p>
        <h2 className="font-display text-[30px] leading-tight">{COUNCIL_LABEL[actor]}</h2>
        <p className="mt-1 text-[14px] leading-snug text-dusk/70">{ROLE_LINE[actor]}</p>
      </header>

      <div className="rounded-[18px] bg-white/60 p-4" style={{ boxShadow: `inset 0 0 0 1.5px ${tint}55` }}>
        <p className="flex items-center gap-2 text-[11.5px] font-semibold tracking-wide text-dusk/55 uppercase">
          {working && <span aria-hidden className="h-2 w-2 animate-pulse rounded-full" style={{ background: tint }} />}
          {heading}
        </p>
        {thought ? (
          <p role="status" className="mt-2 font-display text-[22px] leading-snug">“{thought}”</p>
        ) : (
          <p className="mt-2 text-[14px] text-dusk/65">Nothing has run yet. {COUNCIL_LABEL[actor]} wakes up when the council is asked to work.</p>
        )}
        <p className="mt-2 text-[12.5px] text-dusk/55">{poseFor(member).caption}</p>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-[22px]">What it has done</h3>
          {history.length > 0 && <p className="text-[12px] text-dusk/55">{done} done{failed ? ` · ${failed} didn’t work` : ""}</p>}
        </div>
        {history.length === 0 ? (
          <p className="mt-2 text-[14px] text-dusk/60">No history yet.</p>
        ) : (
          <ol className="mt-3 flex flex-col" aria-label={`${COUNCIL_LABEL[actor]}'s history`}>
            {history.map((h, i) => (
              <li key={h.id} className="relative flex gap-3 pb-4 last:pb-0">
                {i < history.length - 1 && <span aria-hidden className="absolute top-6 left-[11px] h-[calc(100%-1.25rem)] w-px bg-dusk/15" />}
                <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white" style={{ background: h.status === "failed" ? "#d95b4a" : h.status === "done" ? tint : "#b8a9c4" }}>
                  {MARK[h.status]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] leading-snug font-semibold">{h.title}</p>
                  {h.detail && <p className="mt-0.5 text-[13px] leading-snug text-dusk/75">{h.detail}</p>}
                  <p className="mt-0.5 text-[11.5px] text-dusk/50">
                    {WORD[h.status]} · {agoText(h.at, now)}
                    {h.durationMs !== undefined && ` · took ${durationText(h.durationMs)}`}
                    {h.source === "job" && " · background task"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="text-[12px] text-dusk/50">Everything here comes from the council’s real task events. Nothing is made up to fill the page.</p>
    </section>
  );
}
