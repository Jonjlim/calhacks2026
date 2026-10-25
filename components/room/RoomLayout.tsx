"use client";

import { relevantResearchJob, roomResearchJobs, isResearchActive } from "@/lib/room/researchActivity";
import { roomCouncilMembers } from "@/lib/room/councilActivity";
import { addToGiftBox, giftIsInBox } from "@/lib/room/giftBox";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomAgentTools } from "./RoomAgentTools";
import { GiftTwinInviteButton } from "@/components/giftTwin/GiftTwinInviteButton";
import { PublishedClueRail } from "@/components/clues/PublishedClueRail";
import { GiftMap } from "@/components/map/GiftMap";
import { ProductShortlist } from "@/components/products/ProductShortlist";
import { ProposalPanel } from "@/components/proposal/ProposalPanel";
import { BookCorner } from "@/components/book/BookCorner";
import { BookOfPossibilities } from "@/components/book/BookOfPossibilities";
import { book, useBookOpen } from "@/components/book/bookStore";
import { AgentDetails } from "@/components/council/AgentDetails";
import { GiftFinale, useFinaleStep } from "@/components/finale/GiftFinale";
import { ConvergenceOverlay } from "@/components/convergence/ConvergenceOverlay";
import { convergence, useConvergenceActive, useConvergenceState } from "@/components/convergence/convergenceClock";
import { QrModulesSvg } from "@/components/unwrap/QrModulesSvg";
import { type ArtifactInput, buildArtifacts } from "@/lib/convergence/artifacts";
import { type PickTarget, useIslandWorld } from "@/components/world/IslandWorldProvider";
import { sfx } from "@/components/world/sfx";
import { hasChosenSky, setTimeOfDay, useTimeOfDay } from "@/components/world/scenePalette";
import { isDarkSky, SKIES } from "@/components/world/timeOfDay";
import { mapView } from "@/components/world/room/mapView";
import { ringsStore } from "@/components/world/room/ringsStore";
import type { Id } from "@/convex/_generated/dataModel";
import { COUNCIL_LABEL, COUNCIL_TINT, poseFor } from "@/lib/council/animation";
import { COUNCIL_ACTORS, reduceCouncil } from "@/lib/council/contracts";
import { appOrigin, inviteUrl } from "@/lib/invite";
import { inviteQrModules } from "@/lib/invitation/realQr";
import { avatarFor, portraitUrl } from "@/lib/room/avatars";
import { PHASE_LABEL, roomPhase } from "@/lib/room/phase";
import { useResultAction } from "@/lib/useResultAction";
import { roomStage } from "./roomStage";
import { MemoryQuest } from "./MemoryQuest";
import { ShareMemory } from "./ShareMemory";
import { useRoomGuide } from "./useRoomGuide";
import { useGiftRings } from "./useGiftRings";
import { MapCursor } from "./MapCursor";
import type { RoomActions, RoomData } from "./types";

/**
 * The shared desktop stage. The 3D world fills the screen and shows the work
 * (notes in jars, the council at its table, charms on the present); this
 * layer only adds small floating controls and a parchment drawer for text
 * that should be read, never typed into the scene. Friends contribute from
 * their phones (/room/:id/phone).
 */

type Stage = "tower" | "garden" | "map";
type Drawer = { kind: "gifts" } | { kind: "shares" } | { kind: "notes" } | { kind: "jar"; jar: "wish" | "interest" | "moment" } | { kind: "agent"; actor: (typeof COUNCIL_ACTORS)[number] } | null;

const JAR_KINDS: Record<"wish" | "interest" | "moment", { title: string; kinds: string[] }> = {
  wish: { title: "The Wishes jar", kinds: ["explicit_wish"] },
  interest: { title: "The Loves jar", kinds: ["interest"] },
  moment: { title: "The Moments jar", kinds: ["uncertain", "ownership", "exclusion", "timing"] },
};

const chip = "paper-card rounded-full px-3.5 py-2 text-[13.5px] text-dusk shadow-sm";
const iconChip = "paper-card flex h-10 w-10 items-center justify-center rounded-full text-dusk shadow-sm transition hover:bg-paper";
const menuItem = "rounded-xl px-3 py-2 text-left text-[14px] text-dusk hover:bg-dusk/5";

/** Small line icons, drawn here so the controls stay part of the picture rather than pasted-on text. */
const ICON = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg {...ICON}>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" />
      {on ? <><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
    </svg>
  );
}
function DayIcon({ day }: { day: boolean }) {
  return day ? (
    <svg {...ICON}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></svg>
  ) : (
    <svg {...ICON}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>
  );
}
function CompassIcon() {
  return <svg {...ICON}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" /></svg>;
}
function MoreIcon() {
  return <svg {...ICON}><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></svg>;
}
function CheckIcon() {
  return <svg {...ICON} width={18} height={18}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}
function EnvelopeIcon() {
  return <svg {...ICON}><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="M4 7l8 6 8-6" /></svg>;
}

export function RoomLayout({ data, actions, preview = false }: { data: RoomData; actions?: RoomActions; preview?: boolean }) {
  const { room, participants, me } = data.view;
  const isOrganizer = me.role === "organizer";
  const { setCouncil, soundEnabled, toggleSound } = useIslandWorld();
  const time = useTimeOfDay();
  const reducedMotion = useReducedMotion() ?? false;
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => sfx.setEnabled(soundEnabled), [soundEnabled]);
  // The room opens under a warm rose-gold sunrise unless the person has picked a sky of their own.
  useEffect(() => {
    if (!hasChosenSky()) setTimeOfDay("sunrise", { remember: false });
  }, []);

  // --- Stage: the gift map first (D19); tower and garden stay reachable. Kept in the URL for refresh / deep links.
  // Resolved after mount (the URL isn't known while rendering on the server), so the first glide starts from the right place.
  const [resolvedStage, setStageState] = useState<Stage | null>(null);
  const stage: Stage = resolvedStage ?? "map";
  const firstStage = useRef(true);
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    setStageState(view === "tower" ? "tower" : view === "garden" || view === "gifts" || view === "proposal" ? "garden" : "map");
  }, []);
  const setStage = (next: Stage) => {
    setStageState(next);
    const url = new URL(window.location.href);
    if (next === "map") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  };
  useEffect(() => {
    if (!resolvedStage) return;
    // Arriving pans out from the island to the map (or walks into the tower); a deep link to the garden doesn't replay it.
    roomStage.go(resolvedStage, reducedMotion || (firstStage.current && resolvedStage === "garden"));
    firstStage.current = false;
  }, [resolvedStage, reducedMotion]);

  // --- The Great Gift Convergence: the organizer's reveal of the chosen gift (local presentation of Convex's persisted selection).
  // The last steps (plan, checkout, wrap) and the end of the game, which is shared: once the gift is wrapped everyone is taken to it.
  const [finaleOpen, setFinaleOpen] = useState(false);
  const finaleStep = useFinaleStep(data);
  const ended = finaleStep === "end";
  const engaged = useConvergenceActive() || ended;
  const convState = useConvergenceState();
  const selection = data.selection?.status === "active" ? data.selection : null;
  const revealedKey = selection ? `unwrap:revealed:${selection.id}` : null;
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    try {
      setSeen(!!revealedKey && localStorage.getItem(revealedKey) === "1");
    } catch {
      setSeen(false);
    }
  }, [revealedKey]);
  useEffect(() => {
    if (convState !== "complete" || !revealedKey || convergence.instant) return;
    try {
      localStorage.setItem(revealedKey, "1");
    } catch {
      // ignore
    }
    setSeen(true);
  }, [convState, revealedKey]);
  const ringsRef = useRef<ReturnType<typeof useGiftRings>["rings"]>(null);
  const startReveal = useCallback(
    (instant: boolean) => {
      const sel = data.selection?.status === "active" ? data.selection : null;
      const rings = ringsRef.current;
      if (!sel || !rings || convergence.active) return;
      // Every gift in the box (one or several) joins the reveal, and every memory any of them cites.
      const selectedIds = new Set(sel.items?.map((item) => item.listingId) ?? [sel.listingId]);
      const cited = new Set(data.recommendations.filter((r) => selectedIds.has(r.listingId)).flatMap((r) => r.publishedClueIds));
      const kindOf = new Map(data.publishedClues.map((c) => [c.id, c.kind]));
      const inputs: ArtifactInput[] = [
        ...rings.clues.map((c): ArtifactInput => ({ key: c.key, source: kindOf.get(c.key.slice(5)) === "explicit_wish" ? "wish" : "memory", text: c.text, x: c.x, z: c.z, supports: cited.has(c.key.slice(5)) })),
        ...rings.ideas.map((i): ArtifactInput => ({ key: i.key, source: "idea", text: i.text, x: i.x, z: i.z })),
        // The other real gifts the room considered; the chosen one is the reveal itself.
        ...rings.gifts.filter((g) => !selectedIds.has(g.listingId)).map((g): ArtifactInput => ({ key: g.key, source: "gift", text: g.title, x: g.x, z: g.z })),
      ];
      convergence.start({ selectionId: sel.id, inputs, total: inputs.length, instant: instant || reducedMotion });
    },
    [data.selection, data.recommendations, data.publishedClues, reducedMotion],
  );
  const replayReveal = useCallback(() => {
    convergence.abort();
    startReveal(false);
  }, [startReveal]);
  // The reveal is only ever the room's current choice: if it changes or is cleared, the reveal is dropped.
  useEffect(() => {
    if (convergence.active && convergence.selectionId !== (selection?.id ?? null)) convergence.abort();
  }, [selection?.id]);
  useEffect(() => {
    if (stage !== "map" && convergence.active) convergence.abort();
  }, [stage]);
  useEffect(() => () => convergence.abort(), []);
  useEffect(() => {
    mapView.locked = engaged;
    document.documentElement.dataset.convergence = engaged ? "on" : "off";
    return () => {
      mapView.locked = false;
      delete document.documentElement.dataset.convergence;
    };
  }, [engaged]);

  // --- The Book of Possibilities: choosing a gift there uses the existing authorized action, then the reveal takes over once the book is shut.
  const bookOpen = useBookOpen();
  const pendingReveal = useRef<string | null>(null);
  const chooseFromBook = useCallback(
    async (listingId: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (!actions) return { ok: false, message: "Choosing needs a live room." };
      try {
        const res = await addToGiftBox(actions, data.selection, listingId);
        if (!res.ok) return { ok: false, message: res.error.message };
        pendingReveal.current = listingId;
        return { ok: true };
      } catch {
        return { ok: false, message: "That didn’t go through. Check the connection and try again." };
      }
    },
    [actions, data.selection],
  );
  useEffect(() => {
    if (bookOpen || !pendingReveal.current || !selection || !giftIsInBox(selection, pendingReveal.current)) return;
    pendingReveal.current = null;
    const t = setTimeout(() => startReveal(false), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookOpen, selection?.id, selection?.listingId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if ((e.key === "b" || e.key === "B") && !e.metaKey && !e.ctrlKey && !e.altKey && stage === "map" && !ended && !(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))) book.show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, ended]);

  // --- The gift map (D19): rings of memories, themes and gifts around the present.
  const map = useGiftRings({ data, actions, isOrganizer, active: stage === "map", onShares: () => setFinaleOpen(true), onPaste: () => setDrawer({ kind: "notes" }), onReveal: startReveal, revealSeen: seen });
  ringsRef.current = map.rings;
  const guide = useRoomGuide({ data, map, enabled: stage === "map" && !preview && !!actions, paused: engaged || !!drawer, nudge: actions?.mossNudge, warm: actions?.mossWarm, sound: soundEnabled });

  const members = useMemo(() => {
    const current = roomCouncilMembers(data);
    if (map.councilThinking) current.muse = { actor: "muse", status: "started", sequence: -2, summary: map.councilThinking };
    return current;
  }, [data.council, data.activity, data.researchJobs, data.latestResearch, data.trends, map.councilThinking]);

  // --- What the 3D world needs (display data only), plus clicks back from it.
  const onPick = useCallback((t: PickTarget) => {
    if (t.kind === "jar") setDrawer({ kind: "jar", jar: t.jar });
    else if (t.kind === "scout") setDrawer({ kind: "gifts" });
    else if (t.kind === "agent") setDrawer({ kind: "agent", actor: t.actor });
  }, []);
  useEffect(() => {
    setCouncil({
      roomId: room.id,
      viewerId: me.id,
      events: data.council?.events ?? [],
      members,
      decorations: data.council?.decorations ?? [],
      participants: participants.map((p) => ({ id: p.id, displayName: p.displayName, joinedAt: p.joinedAt })),
      // Ids and kinds only; clue text stays in the DOM overlays.
      clues: data.publishedClues.filter((c) => c.status === "active").map((c) => ({ id: c.id, kind: c.kind, publisherId: c.publisherId })),
      onPick,
    });
  }, [room.id, me.id, data.council, data.publishedClues, participants, setCouncil, onPick, members]);
  // The map's data goes straight to the rings, so updates don't re-render the rest of the world.
  useEffect(() => ringsStore.set(map.rings), [map.rings]);
  useEffect(() => () => ringsStore.set(null), []);
  useEffect(() => () => setCouncil(null), [setCouncil]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawer(null);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const liveResearch = relevantResearchJob(roomResearchJobs(data));
  const phase = roomPhase({ councilStatus: isResearchActive(liveResearch) ? "running" : data.council?.run?.status ?? null, recommendationCount: data.recommendations.length, proposalStatus: data.proposal.revision?.status ?? null });
  const working = COUNCIL_ACTORS.filter((a) => members[a].status === "started" && a !== "courier");
  const activeClues = data.publishedClues.filter((c) => c.status === "active");
  const ask = useResultAction(actions?.startResearch);
  const resume = useResultAction(actions?.resumeCouncil);
  const run = data.council?.run;

  // One contextual primary action, matching the real phase.
  let primary: ReactNode = null;
  if (phase === "collect") {
    primary = isOrganizer ? (
      <button className="btn-primary h-11 px-5" disabled={data.councilUnavailable || !activeClues.length || ask.pending || !actions} onClick={() => ask.run(activeClues.map((c) => c.id))}>
        {activeClues.length ? "Wake the council" : "Waiting for memories…"}
      </button>
    ) : (
      <span className="text-[13.5px] text-dusk/65">Add memories from your phone</span>
    );
  } else if (phase === "researching") {
    primary = run?.status === "uncertain" && isOrganizer ? (
      <button className="btn-primary h-11 px-5" disabled={resume.pending} onClick={() => resume.run(run.runId)}>Resume the council</button>
    ) : null;
  } else if (phase === "review") {
    primary = stage === "tower" ? (
      <button className="btn-primary h-11 px-5" onClick={() => setStage("garden")}>Head outside to decorate <span aria-hidden>→</span></button>
    ) : (
      <button className="btn-primary h-11 px-5" onClick={() => setDrawer({ kind: "gifts" })}>Gift ideas · {data.recommendations.length}</button>
    );
  } else if (phase === "approve" || phase === "done") {
    // "All approved" is a status, not something to press: it reads as a quiet badge, and the shares stay one tap away in the present or the menu.
    primary = (
      <button className="btn-primary h-11 px-5" onClick={() => setFinaleOpen(true)}>
        {finaleStep === "checkout" ? "Checkout" : finaleStep === "wrap" ? (isOrganizer ? "Wrap the gift" : "Almost done") : phase === "done" ? "Everyone approved · continue" : "Plan contributions"}
      </button>
    );
  }

  const status = !run
    ? null
    : run.status === "running" && working.length
      ? working.map((a) => `${COUNCIL_LABEL[a]}: ${(members[a].summary ?? poseFor(members[a]).caption).toLowerCase()}`).join(" · ")
      : run.status === "running"
        ? "The council is gathering"
        : run.status === "uncertain" || run.status === "failed" || run.status === "partial"
          ? (run.error ?? "The council needs another try")
          : null;

  return (
    <main className="island-room pointer-events-none fixed inset-0 z-10 text-dusk">
      {stage === "map" && !preview && !engaged && <MapCursor name={me.displayName || "You"} color="#e2ad6b" />}
      {/* "How we got here" (D23 trial): portaled above the world, like the photo viewer. */}
      {map.story}
      {data.councilUnavailable && <p role="alert" className="pointer-events-auto absolute bottom-5 left-1/2 z-30 max-w-md -translate-x-1/2 rounded-xl bg-paper/95 px-4 py-3 text-sm">The council is unavailable on this backend. Your room is still available.</p>}
      {preview && <p className="pointer-events-auto absolute top-20 left-1/2 -translate-x-1/2 rounded-xl bg-gold/30 px-3 py-2 text-sm">Preview only · sample data</p>}

      {/* Identity */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className={`absolute top-5 left-5 flex items-center gap-3 rounded-[20px] paper-card px-4 py-2.5 transition-opacity duration-500 ${engaged ? "pointer-events-none !opacity-0" : "pointer-events-auto"}`}>
        <a href="/" className="font-display text-[24px] leading-none font-semibold" aria-label="Unwrap home">unwrap<span className="text-coral-soft">.</span></a>
        <span className="h-7 w-px bg-dusk/15" aria-hidden />
        <div className="leading-tight">
          <p className="font-display text-[19px]">{room.recipientDisplayName}&rsquo;s gift</p>
          <p className="text-[12px] text-dusk/60">{room.occasion}</p>
        </div>
        <div className="ml-1 flex -space-x-2" aria-label={`${participants.length} in the room`}>
          {participants.slice(0, 6).map((p) => (
            <img key={p.id} src={portraitUrl(avatarFor(participants, p.id))} alt={p.displayName} title={p.displayName} className="h-8 w-8 rounded-full border-2 border-paper object-cover object-top" />
          ))}
          <span className="ml-3 self-center pl-2 text-[12.5px] text-dusk/60">{participants.length}</span>
        </div>
      </motion.div>

      {/* Invite + small toggles */}
      <div inert={guide.cinematic || undefined} className={`absolute top-5 right-5 max-[640px]:top-[88px] flex flex-col items-end gap-2 transition-opacity duration-500 ${engaged || guide.cinematic ? "pointer-events-none opacity-0" : "pointer-events-auto"}`}>
        <div className="flex gap-2">
          <button className={iconChip} data-sfx="silent" onClick={toggleSound} aria-pressed={soundEnabled} aria-label={soundEnabled ? "Turn sound off" : "Turn sound on"} title={soundEnabled ? "Sound on" : "Sound off"}><SoundIcon on={soundEnabled} /></button>
          <button className={iconChip} onClick={() => setTimeOfDay(SKIES[(SKIES.findIndex((k) => k.id === time) + 1) % SKIES.length]!.id)} aria-label={`Change the sky. Now: ${SKIES.find((k) => k.id === time)?.label}`} title={`Sky: ${SKIES.find((k) => k.id === time)?.label}. Click for the next.`}><DayIcon day={!isDarkSky(time)} /></button>
          {stage === "map" && (
            <button className={iconChip} onClick={() => mapView.reset()} aria-label="Return to the overview" title="Return to the overview. Drag to look around, right-drag or Shift-drag to move, scroll to zoom. Keys: arrows move, Shift + arrows or Q / E turn, 1 / 2 / 3 high, three-quarter and low views, + / - zoom, 0 returns.">
              <CompassIcon />
            </button>
          )}
        </div>
        <a href={`/room/${room.id}/phone`} className={chip}>List view</a>
        {data.invitePath && <InviteCard path={data.invitePath} />}
        {actions && !preview && <GiftTwinInviteButton roomId={room.id as Id<"rooms">} recipientName={room.recipientDisplayName}
          twin={data.agentCollaborators?.collaborators.find((collaborator) => collaborator.kind === "gift_twin")}
          className={chip} />}
      </div>

      {/* The shares board (components/room/BudgetBoard) is built but switched off for now. To bring it back, render <BudgetBoard data={data} actions={actions} /> here on the map stage. */}

      {/* The Book of Possibilities lives in the bottom-left corner. */}
      {stage === "map" && !preview && !engaged && <BookCorner count={data.listings.length} />}

      {/* In a branch: one way back, wherever the camera has wandered. */}
      {stage === "map" && !engaged && !bookOpen && map.rings?.selectedKey && map.rings.selectedKey !== "box" && (
        <button type="button" className="paper-card pointer-events-auto absolute top-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-semibold text-dusk shadow-sm" onClick={() => { map.rings?.onSelect(null); mapView.reset(); }}>
          <svg {...ICON} width={16} height={16}><path d="M14.5 6l-6 6 6 6" /></svg>
          Back to the overview
        </button>
      )}

      {/* The memory game floats over the tower while the room is still gathering. */}
      {actions && stage === "tower" && !drawer && (phase === "collect" || phase === "review") && (
        <MemoryQuest roomId={room.id as Id<"rooms">} recipientName={room.recipientDisplayName} clues={data.publishedClues} addMemory={actions.addManualClue} onOpenBackstage={() => setDrawer({ kind: "notes" })} />
      )}

      {guide.panel}
      {/* Phase bar. Guidance replaces it while visible; it never stacks another popup above it. */}
      <div inert={engaged || guide.visible || undefined} className={`absolute bottom-6 left-1/2 flex max-w-[min(920px,calc(100vw-40px))] -translate-x-1/2 items-center gap-3 rounded-full paper-card py-2 pr-2 pl-5 shadow-[0_18px_40px_-20px_rgba(65,52,76,0.55)] transition-opacity duration-500 ${engaged || guide.visible ? "pointer-events-none opacity-0" : "pointer-events-auto"}`}>
        <span className="flex gap-1" aria-hidden>
          {COUNCIL_ACTORS.map((a) => (
            <span key={a} className={`h-2.5 w-2.5 rounded-full ${members[a].status === "started" ? "animate-pulse" : ""}`} style={{ background: COUNCIL_TINT[a], opacity: members[a].status === "idle" ? 0.3 : 1 }} />
          ))}
        </span>
        <div className="min-w-0">
          <p className="font-display text-[18px] leading-tight whitespace-nowrap">{PHASE_LABEL[phase]}</p>
          <p role="status" className="max-w-[440px] truncate text-[12.5px] text-dusk/60">{(stage === "map" ? map.error ?? map.notice : null) ?? status ?? (stage === "map" ? "Add a memory or gift idea · use the photo icon to share pictures · drag to look around" : `${activeClues.length} ${activeClues.length === 1 ? "memory" : "memories"} in the jars`)}</p>
        </div>
        <div className="ml-2 flex items-center gap-2">
          {stage === "map" && selection && isOrganizer && !preview && !seen && (
            <button className="btn-primary h-11 px-5" data-sfx="reveal" onClick={() => startReveal(false)}>Reveal our gift</button>
          )}
          {stage === "map" && actions && !preview && (
            <div className="flex items-center gap-1.5" role="group" aria-label="Add to the map">
              {([["memory", "Memory", "Add a memory or wish", "#a9cde6", "solid"], ["idea", "Gift idea", "Add a gift idea", "#e2bd6b", "dashed"]] as const).map(([what, label, title, tint, line]) => (
                <button key={what} type="button" className="btn-secondary h-11 whitespace-nowrap px-3.5 text-[13.5px]" style={{ background: `color-mix(in srgb, ${tint} ${what === "idea" ? 28 : 62}%, #fffaf0)`, borderColor: `color-mix(in srgb, ${tint} 85%, #413450)`, borderStyle: line }} title={title} aria-label={title} onClick={() => map.startAdd(what)}>
                  <span aria-hidden className="mr-1.5 text-[15px] leading-none">+</span>{label}
                </button>
              ))}
            </div>
          )}
          {primary}
          {stage !== "map" && (
            <>
              <button className="btn-secondary h-11 px-4 text-[14px]" onClick={() => setStage("map")}>Open the gift map</button>
              <button className="btn-secondary h-11 px-4 text-[14px]" onClick={() => setStage(stage === "tower" ? "garden" : "tower")}>
                {stage === "tower" ? "Garden" : "Tower"}
              </button>
            </>
          )}
          {(phase === "review" || phase === "approve" || phase === "done") && stage === "tower" && (
            <button className="btn-secondary h-11 px-4 text-[14px]" onClick={() => setDrawer({ kind: "gifts" })}>Gifts</button>
          )}
          <div className="relative">
            <button className={`${iconChip} !h-11 !w-11`} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More" title="More" onClick={() => setMenuOpen((o) => !o)}><MoreIcon /></button>
            {menuOpen && (
              <div role="menu" className="paper-card absolute right-0 bottom-14 flex min-w-[220px] flex-col gap-1 rounded-[18px] p-2" onClick={() => setMenuOpen(false)}>
                {stage === "map" && selection && isOrganizer && !preview && seen && <button role="menuitem" className={menuItem} data-sfx="reveal" onClick={() => startReveal(false)}>Replay reveal</button>}
                {stage === "map" && map.tools && <div className="flex flex-col gap-1 [&>button]:!w-full [&>button]:!justify-start">{map.tools}</div>}
                {stage === "map" && !preview && actions && <button role="menuitem" className={menuItem} onClick={guide.restart}>Explore with Moss</button>}
                {stage === "map" && <button role="menuitem" className={menuItem} onClick={() => setStage("garden")}>Back to the present</button>}
                {stage === "map" && phase === "done" && <button role="menuitem" className={menuItem} onClick={() => setFinaleOpen(true)}>Plan contributions</button>}
                {!preview && actions && <button role="menuitem" className={menuItem} onClick={() => setDrawer({ kind: "notes" })}>Backstage: notes, agents and sharing</button>}
              </div>
            )}
          </div>
        </div>
      </div>
      {(ask.error || resume.error) && <p role="alert" className="pointer-events-auto absolute bottom-24 left-1/2 -translate-x-1/2 rounded-xl bg-paper px-3 py-2 text-sm text-[#8c3b2c] shadow">{(ask.error ?? resume.error)?.message}</p>}

      {stage === "map" && !preview && !engaged && <BookOfPossibilities data={data} actions={actions} isOrganizer={isOrganizer} onChoose={chooseFromBook} />}

      {selection && (
        <ConvergenceOverlay
          gift={{ selection, listing: data.listings.find((l) => l.id === selection.listingId), recommendation: data.recommendations.find((r) => r.listingId === selection.listingId), clues: data.publishedClues, listings: data.listings, recommendations: data.recommendations, directions: data.directions, trail: data.trail }}
          isOrganizer={isOrganizer}
          onPlan={() => setFinaleOpen(true)}
          onReplay={replayReveal}
        />
      )}

      <GiftFinale data={data} actions={actions} isOrganizer={isOrganizer} open={finaleOpen && !preview} onClose={() => setFinaleOpen(false)} />

      <AnimatePresence>
        {drawer && !engaged && (
          <motion.aside key="drawer" role="dialog" aria-modal="false" aria-label="Details"
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto absolute top-24 right-5 bottom-28 flex w-[min(440px,calc(100vw-40px))] flex-col overflow-hidden rounded-[24px] bg-[#fbf7f0]/96 shadow-[0_30px_60px_-30px_rgba(60,36,30,0.6)] ring-1 ring-dusk/10 backdrop-blur-md">
            <div className="flex items-center justify-end px-4 pt-3">
              <button autoFocus onClick={() => setDrawer(null)} className="rounded-full px-3 py-1 text-[13px] font-medium text-dusk/60 hover:bg-dusk/5 hover:text-dusk">Close</button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-5">
              <DrawerBody drawer={drawer} data={data} actions={actions} isOrganizer={isOrganizer} members={members} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </main>
  );
}

function DrawerBody({ drawer, data, actions, isOrganizer, members }: { drawer: NonNullable<Drawer>; data: RoomData; actions?: RoomActions; isOrganizer: boolean; members: ReturnType<typeof reduceCouncil> }) {
  const { room, participants, me } = data.view;
  if (drawer.kind === "gifts") {
    return (
      <>
        <ProductShortlist recommendations={data.recommendations} listings={data.listings} publishedClues={data.publishedClues} votes={data.votes} selection={data.selection} isOrganizer={isOrganizer} latestResearch={data.latestResearch} actions={actions} />
        {!!data.council?.run?.excluded.length && (
          <details className="text-[13px] text-dusk/70">
            <summary className="cursor-pointer">Why some ideas didn’t make the shortlist</summary>
            <ul className="mt-2 space-y-1">{data.council.run.excluded.map((e, i) => <li key={i}><strong>{e.title}</strong>: {e.reason}</li>)}</ul>
          </details>
        )}
        <details className="paper-card rounded-[18px] p-4"><summary className="cursor-pointer font-display text-xl">How the clues connect</summary><GiftMap recommendations={data.recommendations} listings={data.listings} publishedClues={data.publishedClues} /></details>
      </>
    );
  }
  if (drawer.kind === "shares") return <ProposalPanel proposal={data.proposal} participants={participants} me={me} selection={data.selection} isOrganizer={isOrganizer} actions={actions} />;
  if (drawer.kind === "jar") {
    const { title, kinds } = JAR_KINDS[drawer.jar];
    const notes = data.publishedClues.filter((c) => c.status === "active" && kinds.includes(c.kind));
    return (
      <section className="parchment">
        <h2 className="font-display text-[28px] leading-tight">{title}</h2>
        <p className="text-[13px] text-dusk/60">{notes.length} {notes.length === 1 ? "note" : "notes"} from friends</p>
        <ul className="mt-3 flex flex-col gap-2.5">
          {notes.map((c) => (
            <li key={c.id} className="rounded-xl bg-white/60 px-3 py-2 text-[14.5px] leading-snug">
              {c.text}
              <span className="block text-[11.5px] text-dusk/50">— {participants.find((p) => p.id === c.publisherId)?.displayName ?? "a friend"}</span>
            </li>
          ))}
          {!notes.length && <li className="text-[14px] text-dusk/55">Empty for now. Notes added from phones drop in here.</li>}
        </ul>
      </section>
    );
  }
  if (drawer.kind === "agent") {
    return (
      <>
        <AgentDetails actor={drawer.actor} member={members[drawer.actor]} data={data} />
        {data.council?.run?.agentAddress && (
          <p className="mt-3 text-[12px] text-dusk/60">
            Agentverse address <code className="block break-all rounded-lg bg-white/60 px-2 py-1 text-[11.5px] text-dusk/80">{data.council.run.agentAddress}</code>
          </p>
        )}
      </>
    );
  }
  // Notes and room tools: contextual text entry for the organizer, plus moderation of shared notes.
  return (
    <>
      {actions && <ShareMemory roomId={room.id as Id<"rooms">} recipientName={room.recipientDisplayName} />}
      <PublishedClueRail clues={data.publishedClues} participants={participants} me={me} actions={actions} />
      <RoomAgentTools data={data} actions={actions} />
    </>
  );
}

/** Real, scannable invite QR plus copyable link. Collapses to a pill once friends have joined. */
function InviteCard({ path }: { path: string }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? inviteUrl(path, appOrigin(origin)) : null;
  const modules = useMemo(() => (url ? inviteQrModules(url) : null), [url]);
  if (!url || !modules) return null;
  const code = path.split("/").pop() ?? "";
  if (!open) return <button className={`${chip} flex items-center gap-2`} onClick={() => setOpen(true)} aria-label="Invite friends: show the QR code"><EnvelopeIcon /><span>Invite</span></button>;
  return (
    <div className="paper-card w-[220px] rounded-[20px] p-3.5 text-center" data-invite-url={url}>
      <div className="flex items-baseline justify-between">
        <p className="font-display text-[19px]">Join on your phone</p>
        <button className="text-[12px] text-dusk/55 hover:text-dusk" onClick={() => setOpen(false)} aria-label="Hide invite">Hide</button>
      </div>
      <div className="mt-2 overflow-hidden rounded-xl bg-white">
        <QrModulesSvg modules={modules} className="h-auto w-full" label="QR code to join this gift room" scannable />
      </div>
      <p className="mt-2 font-mono text-[11px] break-all text-dusk/55">{code.slice(0, 8)}…</p>
      <button
        className="btn-secondary mt-2 h-9 w-full text-[13px]"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied("copied");
          } catch {
            setCopied("failed");
          }
        }}
      >
        {copied === "copied" ? "Link copied" : copied === "failed" ? "Copy failed" : "Copy invite link"}
      </button>
    </div>
  );
}
