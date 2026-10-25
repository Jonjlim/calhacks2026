"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MapIcon, type MapIconName } from "@/components/world/room/MapIcon";
import s from "@/components/world/room/gift-rings.module.css";
import type { TrailEntry } from "./types";

/** The six stages of the gift flow, in the order they happen. */
const STAGES: { id: TrailEntry["stage"]; title: string; icon: MapIconName; blurb: string }[] = [
  { id: "memories", title: "Memories", icon: "memory", blurb: "What friends shared, and how it was read" },
  { id: "council", title: "The council", icon: "spark", blurb: "Directions proposed, checked, and the trends it looked up" },
  { id: "steering", title: "Friends steered", icon: "heart", blurb: "Pulls, passes, answers and catches" },
  { id: "search", title: "Real products", icon: "sprout", blurb: "What each search found and kept" },
  { id: "choice", title: "The choice", icon: "present", blurb: "What went in the box" },
  { id: "money", title: "Shares and approvals", icon: "coins", blurb: "Who agreed to what. Simulated: no money moves" },
];

const ACTOR: Record<TrailEntry["actor"], string> = { council: "Council", checks: "Checks", trends: "Trend screen", search: "Search", person: "" };

/**
 * "How we got here" (D23 trial): every decision the council, the checks and
 * friends made, including what was thrown out, as one readable flow. Lines on
 * the chosen gift's path are lit. Everything shown is the room's decision log.
 */
export function HowWeGotHere({ entries, chain, focus, giftTitle, onClose }: {
  entries: TrailEntry[];
  /** The step-by-step reason for the chosen gift, when there is one. */
  chain?: ReactNode;
  focus?: { listingId?: string; directionId?: string; clueIds?: string[] };
  giftTitle?: string;
  onClose(): void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const thrownOut = entries.filter((e) => e.outcome === "rejected" && e.actor !== "person").length;
  const passes = entries.filter((e) => e.outcome === "rejected" && e.actor === "person").length;
  const people = new Set(entries.flatMap((e) => (e.who ? [e.who] : []))).size;

  return createPortal(
    <div className={s.storyBackdrop} role="dialog" aria-modal="true" aria-label="How we got here" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className={s.storyCard} onClick={(e) => e.stopPropagation()}>
        <header className={s.storyHead}>
          <div>
            <small>How we got here</small>
            <h2>{giftTitle ? <>Why “{giftTitle}”</> : "Every decision so far"}</h2>
            <p>{entries.length} steps · {people} {people === 1 ? "friend" : "friends"} · {thrownOut} ideas thrown out by checks · {passes} passes. Every line below is a recorded decision.</p>
          </div>
          <button ref={closeButton} type="button" className={s.storyClose} onClick={onClose} aria-label="Close"><MapIcon name="drift" size={16} /></button>
        </header>

        {chain && (
          <section className={s.storyWhy}>
            <h3><MapIcon name="thread" size={15} />The path to this gift</h3>
            {chain}
          </section>
        )}

        <DecisionTrail entries={entries} focus={focus} />
        <p className={s.storyFoot}>Memories stay as friends wrote them; private notes, unpublished guesses and anyone’s maximum are never shown here. Prices are as seen at search time. No money was charged and no gift was purchased.</p>
      </div>
    </div>,
    document.body,
  );
}

/** Shared recorded flow, embedded in the reveal as well as the map's full story. */
export function DecisionTrail({ entries, focus, compact = false }: {
  entries: TrailEntry[];
  focus?: { listingId?: string; directionId?: string; clueIds?: string[] };
  compact?: boolean;
}) {
  const onPath = (e: TrailEntry) => !!focus && (
    (!!e.listingId && e.listingId === focus.listingId)
    || (!!e.directionId && e.directionId === focus.directionId)
    || (!!e.clueIds?.length && !!focus.clueIds?.some((id) => e.clueIds!.some((c) => c === id))));
  return (
        <ol className={s.storyFlow} aria-label="Recorded gift journey">
          {STAGES.map((stage, i) => {
            const rows = entries.filter((e) => e.stage === stage.id);
            return (
              <li key={stage.id} className={`${s.storyStage} ${rows.length ? "" : s.storyEmpty}`}>
                <span className={s.storyNode} aria-hidden><MapIcon name={stage.icon} size={16} /><i>{i + 1}</i></span>
                <div>
                  <h4>{stage.title}<small>{stage.blurb}</small></h4>
                  {rows.length === 0 ? <p className={s.storyNone}>Nothing yet.</p> : (
                    <ul>
                      {rows.map((e) => (
                        <li key={e._id} style={compact ? { gridTemplateColumns: "1fr", gap: 2 } : undefined} className={`${s.storyRow} ${e.outcome === "rejected" ? s.storyOut : e.outcome === "kept" ? s.storyKept : ""} ${onPath(e) ? s.storyLit : ""}`}>
                          <b>{e.actor === "person" ? e.who ?? "A friend" : ACTOR[e.actor]}</b>
                          <span>{e.text}</span>
                          <time>{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
  );
}
