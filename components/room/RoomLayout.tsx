"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { inviteUrl } from "@/lib/invite";
import { motion, useReducedMotion } from "motion/react";
import { roomStage } from "./roomStage";
import { useIslandWorld } from "@/components/world/IslandWorldProvider";
import { RoomCouncilPanel } from "@/components/council/RoomCouncilPanel";
import { setTimeOfDay, useTimeOfDay } from "@/components/world/scenePalette";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { EvidenceImport } from "@/components/clues/EvidenceImport";
import { ProposedClueReview } from "@/components/clues/ProposedClueReview";
import { PublishedClueRail } from "@/components/clues/PublishedClueRail";
import { GiftMap } from "@/components/map/GiftMap";
import { ProductShortlist } from "@/components/products/ProductShortlist";
import { ProposalPanel } from "@/components/proposal/ProposalPanel";
import { RoomHeader } from "./RoomHeader";
import { ShareMemory } from "./ShareMemory";
import type { Id } from "@/convex/_generated/dataModel";
import { ActivityFeed } from "@/components/agents/ActivityFeed";
import { ChatModeToggle } from "@/components/agents/ChatModeToggle";
import { RecipientDemo } from "@/components/agents/RecipientDemo";
import { StatsPanel } from "@/components/agents/StatsPanel";
import { MediaIntake } from "@/components/clues/MediaIntake";
import { ShareWorldPanel } from "@/components/worlds/ShareWorldPanel";
import type { RoomActions, RoomData } from "./types";

type Tab = "memories" | "gifts" | "proposal";

export function RoomLayout({ data, actions, preview = false }: { data: RoomData; actions?: RoomActions; preview?: boolean }) {
  const { room, participants, me } = data.view;
  const isOrganizer = me.role === "organizer";
  const latestExtract = data.activity?.jobs.find((job) => job.kind === "extract");
  // Agent, media and sharing panels query Convex directly, so they only render with a live backend.
  const liveRoomId = actions ? (room.id as Id<"rooms">) : null;

  const { setCouncil, soundEnabled, toggleSound } = useIslandWorld();
  const time = useTimeOfDay();
  const reducedMotion = useReducedMotion() ?? false;
  const [tab, setTabState] = useState<Tab>("memories");
  const firstStage = useRef(true);
  // The tab is also the scene: memories in the tower, gifts outside at the present. Kept in the URL.
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (view === "gifts" || view === "proposal") setTabState(view);
  }, []);
  const setTab = (next: Tab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    if (next === "memories") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  };
  useEffect(() => {
    // Arriving from the island glides into the tower; deep links straight to the garden don't replay a walk in.
    const stage = tab === "memories" ? "tower" : "garden";
    roomStage.go(stage, reducedMotion || (firstStage.current && stage === "garden"));
    firstStage.current = false;
  }, [tab, reducedMotion]);
  useEffect(() => {
    setCouncil({
      roomId: room.id,
      events: data.council?.events ?? [],
      decorations: data.council?.decorations ?? [],
      participants: participants.map((p) => ({ id: p.id, displayName: p.displayName })),
      // Ids and kinds only; clue text stays in the room panels.
      clues: data.publishedClues.filter((c) => c.status === "active").map((c) => ({ id: c.id, kind: c.kind, publisherId: c.publisherId })),
    });
  }, [room.id, data.council, data.publishedClues, participants, setCouncil]);
  useEffect(() => () => setCouncil(null), [setCouncil]);
  const councilDone = data.council?.run?.status === "completed" || data.council?.run?.status === "partial" || data.recommendations.length > 0;
  const phone = usePhone();

  if (phone) {
    return (
      <PhoneRoom data={data} actions={actions} preview={preview} tab={tab} setTab={setTab} councilDone={councilDone} isOrganizer={isOrganizer}
        soundEnabled={soundEnabled} toggleSound={toggleSound} time={time} />
    );
  }

  return (
    <main className="island-room pointer-events-none relative z-10 min-h-dvh text-dusk">
      <div className="editorial-wash pointer-events-none fixed inset-y-0 left-0 w-[58%]" aria-hidden />
      <div className="paper-grain pointer-events-none fixed inset-0" aria-hidden />
      <div className="pointer-events-auto fixed right-4 top-5 z-20 flex gap-2">
        <button className="rounded-full border border-dusk/10 bg-paper/80 px-4 py-2 text-sm shadow-sm" onClick={toggleSound}>{soundEnabled ? "Sound on" : "Sound off"}</button>
        <button className="rounded-full border border-dusk/10 bg-paper/80 px-4 py-2 text-sm shadow-sm" onClick={() => setTimeOfDay(time === "day" ? "night" : "day")}>{time === "day" ? "Day" : "Night"}</button>
      </div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="room-paper-column pointer-events-auto relative px-5 pb-12 pt-7 md:px-10 lg:px-[clamp(40px,5vw,88px)]">
        {preview && <p className="mb-4 rounded-xl bg-gold/25 p-3 text-sm">Preview only · sample data. Connect the backend to save memories and research gifts.</p>}
        <RoomHeader room={room} participants={participants} me={me} invitePath={data.invitePath} />
        <nav aria-label="Room activities" className="my-5 flex gap-2">
          {(["memories", "gifts", "proposal"] as const).map(value => <button key={value} onClick={() => setTab(value)} aria-pressed={tab === value} className={`rounded-full border border-dusk/15 px-4 py-2 text-sm transition ${tab === value ? "bg-dusk text-paper" : "bg-paper/70 hover:bg-paper"}`}>{value === "memories" ? "Memories" : value === "gifts" ? `Gift ideas${data.recommendations.length ? ` · ${data.recommendations.length}` : ""}` : "Our gift"}</button>)}
        </nav>
        <section className="flex flex-col gap-5" aria-label={tab === "memories" ? "Memories and council" : tab === "gifts" ? "Gift ideas" : "Gift proposal"}>
          {tab === "memories" && <>
            {!preview && actions && <RoomCouncilPanel data={data} actions={actions} />}
            {councilDone && (
              <button className="btn-primary self-start" onClick={() => setTab("gifts")}>
                Head outside to decorate the gift
                <span aria-hidden>→</span>
              </button>
            )}
            {!preview && actions && <ShareMemory roomId={room.id as Id<"rooms">} recipientName={room.recipientDisplayName} />}
            <PublishedClueRail clues={data.publishedClues} participants={participants} me={me} actions={actions} />
            <details className="paper-card rounded-[22px] p-5"><summary className="cursor-pointer font-display text-2xl">Bring in a conversation</summary><div className="mt-4 flex flex-col gap-4">
              <EvidenceImport evidence={data.evidence} latestJob={latestExtract} modelConfigured={data.activity?.capabilities.modelConfigured} actions={actions} />
              <ProposedClueReview clues={data.myProposedClues} actions={actions} />
              {liveRoomId && <MediaIntake roomId={liveRoomId} />}
            </div></details>
            <ChatPanel messages={data.messages} participants={participants} me={me} activity={data.activity} actions={actions} />
            {liveRoomId && <ChatModeToggle roomId={liveRoomId} />}
            {liveRoomId && <AgentDetails roomId={liveRoomId} isOrganizer={isOrganizer} />}
          </>}
          {tab === "gifts" && <>
            <button className="self-start text-sm font-medium text-dusk/60 underline-offset-4 hover:text-dusk hover:underline" onClick={() => setTab("memories")}>← Back inside the tower</button>
            <ProductShortlist recommendations={data.recommendations} listings={data.listings} publishedClues={data.publishedClues} votes={data.votes} selection={data.selection} isOrganizer={isOrganizer} latestResearch={data.latestResearch} actions={actions} />
            {data.selection && <button className="btn-primary" onClick={() => setTab("proposal")}>Review our chosen gift →</button>}
            <details className="paper-card rounded-[22px] p-5"><summary className="cursor-pointer font-display text-2xl">How the clues connect</summary><GiftMap recommendations={data.recommendations} listings={data.listings} publishedClues={data.publishedClues} /></details>
            {liveRoomId && <GiftWorkings roomId={liveRoomId} />}
          </>}
          {tab === "proposal" && <ProposalPanel proposal={data.proposal} participants={participants} me={me} selection={data.selection} isOrganizer={isOrganizer} actions={actions} />}
        </section>
      </motion.div>
    </main>
  );
}

/** Phone widths get the memory-first layout; matches Tailwind's md breakpoint. */
function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

const TABS: { value: Tab; label: string; icon: ReactNode }[] = [
  { value: "memories", label: "Memories", icon: <path d="M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5" /> },
  { value: "gifts", label: "Gift ideas", icon: <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-3-6-3-6-1s4 1 6 1zm0 0c2-3 6-3 6-1s-4 1-6 1z" /> },
  { value: "proposal", label: "Our gift", icon: <path d="M5 12l4 4 10-10M4 20h16" /> },
];

/**
 * The phone is where friends add what they remember: the tower peeks in at
 * the top, the memory composer comes first, and a thumb-reachable tab bar
 * switches between memories, gift ideas and the chosen gift.
 */
function PhoneRoom({ data, actions, preview, tab, setTab, councilDone, isOrganizer, soundEnabled, toggleSound, time }: {
  data: RoomData; actions?: RoomActions; preview: boolean; tab: Tab; setTab: (t: Tab) => void; councilDone: boolean; isOrganizer: boolean;
  soundEnabled: boolean; toggleSound: () => void; time: "day" | "night";
}) {
  const { room, participants, me } = data.view;
  const liveRoomId = actions ? (room.id as Id<"rooms">) : null;
  const [shared, setShared] = useState<"idle" | "copied" | "failed">("idle");
  const share = async () => {
    if (!data.invitePath) return;
    const url = inviteUrl(data.invitePath, window.location.origin);
    try {
      if (navigator.share) await navigator.share({ title: `Help pick a gift for ${room.recipientDisplayName}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setShared("copied");
      }
    } catch (err) {
      // Dismissing the share sheet is not a failure.
      if ((err as Error)?.name !== "AbortError") setShared("failed");
    }
  };
  return (
    <main className="island-room pointer-events-none relative z-10 min-h-dvh text-dusk">
      <div className="pointer-events-auto fixed inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-[max(12px,env(safe-area-inset-top))]">
        <a href="/" className="font-display rounded-full bg-paper/80 px-3 py-1 text-[22px] leading-none font-semibold shadow-sm backdrop-blur">unwrap<span className="text-coral-soft">.</span></a>
        <div className="flex gap-2">
          <button aria-label={soundEnabled ? "Sound on" : "Sound off"} className="grid h-10 w-10 place-items-center rounded-full border border-dusk/10 bg-paper/80 text-sm shadow-sm" onClick={toggleSound}>{soundEnabled ? "🔊" : "🔈"}</button>
          <button aria-label={time === "day" ? "Switch to night" : "Switch to day"} className="grid h-10 w-10 place-items-center rounded-full border border-dusk/10 bg-paper/80 text-sm shadow-sm" onClick={() => setTimeOfDay(time === "day" ? "night" : "day")}>{time === "day" ? "☀︎" : "☾"}</button>
        </div>
      </div>

      {/* The world shows through this gap: the tower (memories) or the present (gifts). */}
      <div className="h-[34dvh]" aria-hidden />

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-auto relative flex flex-col gap-4 rounded-t-[28px] bg-[#fbf7f0]/92 px-4 pt-5 pb-[calc(96px+env(safe-area-inset-bottom))] shadow-[0_-18px_40px_-24px_rgba(65,52,76,0.45)] backdrop-blur-md">
        <div aria-hidden className="mx-auto -mt-2 h-1.5 w-10 rounded-full bg-dusk/15" />
        {preview && <p className="rounded-xl bg-gold/25 p-3 text-sm">Preview only · sample data.</p>}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display truncate text-[30px] leading-tight">{room.title}</h1>
            <p className="text-[13px] text-dusk/60">{room.occasion} · {participants.length} {participants.length === 1 ? "friend" : "friends"} · you’re {me.displayName}</p>
          </div>
          {data.invitePath && (
            <button onClick={share} className="btn-secondary h-11 shrink-0 px-4 text-[14px]">
              {shared === "copied" ? "Link copied" : shared === "failed" ? "Try again" : "Invite"}
            </button>
          )}
        </header>

        {tab === "memories" && (
          <>
            {!preview && actions && <ShareMemory roomId={room.id as Id<"rooms">} recipientName={room.recipientDisplayName} variant="phone" />}
            {!preview && actions && <RoomCouncilPanel data={data} actions={actions} compact />}
            {councilDone && (
              <button className="btn-primary h-12 justify-center text-[16px]" onClick={() => setTab("gifts")}>
                Head outside to decorate the gift <span aria-hidden>→</span>
              </button>
            )}
            <PublishedClueRail clues={data.publishedClues} participants={participants} me={me} actions={actions} />
            <details className="paper-card rounded-[22px] p-4">
              <summary className="cursor-pointer font-display text-[22px]">Bring in a conversation</summary>
              <div className="mt-3 flex flex-col gap-4">
                <EvidenceImport evidence={data.evidence} latestJob={data.activity?.jobs.find((j) => j.kind === "extract")} modelConfigured={data.activity?.capabilities.modelConfigured} actions={actions} />
                <ProposedClueReview clues={data.myProposedClues} actions={actions} />
                {liveRoomId && <MediaIntake roomId={liveRoomId} />}
              </div>
            </details>
            <ChatPanel messages={data.messages} participants={participants} me={me} activity={data.activity} actions={actions} />
            {liveRoomId && <ChatModeToggle roomId={liveRoomId} />}
            {liveRoomId && <AgentDetails roomId={liveRoomId} isOrganizer={isOrganizer} />}
          </>
        )}
        {tab === "gifts" && (
          <>
            <ProductShortlist recommendations={data.recommendations} listings={data.listings} publishedClues={data.publishedClues} votes={data.votes} selection={data.selection} isOrganizer={isOrganizer} latestResearch={data.latestResearch} actions={actions} />
            {liveRoomId && <GiftWorkings roomId={liveRoomId} />}
          </>
        )}
        {tab === "proposal" && <ProposalPanel proposal={data.proposal} participants={participants} me={me} selection={data.selection} isOrganizer={isOrganizer} actions={actions} />}
      </motion.div>

      <nav aria-label="Room activities" className="pointer-events-auto fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 grid grid-cols-3 rounded-[22px] border border-dusk/10 bg-paper/95 p-1.5 shadow-[0_18px_40px_-18px_rgba(65,52,76,0.55)] backdrop-blur-md">
        {TABS.map((t) => (
          <button key={t.value} onClick={() => setTab(t.value)} aria-current={tab === t.value ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[16px] text-[12px] font-semibold transition ${tab === t.value ? "bg-dusk text-paper" : "text-dusk/70"}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{t.icon}</svg>
            {t.value === "gifts" && data.recommendations.length ? `${t.label} · ${data.recommendations.length}` : t.label}
          </button>
        ))}
      </nav>
    </main>
  );
}

/** What the agents did and how the room can share its result. Collapsed so the council and chat stay the focus. */
function AgentDetails({ roomId, isOrganizer }: { roomId: Id<"rooms">; isOrganizer: boolean }) {
  return (
    <details className="paper-card rounded-[22px] p-5">
      <summary className="cursor-pointer font-display text-2xl">Agents and sharing</summary>
      <div className="mt-4 flex flex-col gap-4">
        <RecipientDemo roomId={roomId} isOrganizer={isOrganizer} />
        {isOrganizer && <ShareWorldPanel roomId={roomId} />}
      </div>
    </details>
  );
}

/** Live agent activity and the recorded numbers behind a recommendation. */
function GiftWorkings({ roomId }: { roomId: Id<"rooms"> }) {
  return (
    <details className="paper-card rounded-[22px] p-5">
      <summary className="cursor-pointer font-display text-2xl">How Unwrap worked on this</summary>
      <div className="mt-4 flex flex-col gap-4">
        <ActivityFeed roomId={roomId} />
        <StatsPanel roomId={roomId} />
      </div>
    </details>
  );
}
