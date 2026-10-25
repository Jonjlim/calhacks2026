"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { introClock, useIntroPhase } from "@/components/intro/introTimeline";
import { useUnwrapPhase, unwrapClock } from "@/components/unwrap/unwrapTimeline";
import { roomStage, useRoomStage } from "@/components/room/roomStage";
import type { CouncilActor, CouncilEvent, CouncilMemberState, DecorationSpec } from "@/lib/council/contracts";
import { cueFromTarget, playSfx, resumeMusic, setSfxEnabled } from "./sounds";

const WorldCanvas = dynamic(() => import("./WorldCanvas"), { ssr: false });
/**
 * What the 3D world needs to stage one gift room. Display data only: council
 * events and charms, the participants, and room-visible clue ids/kinds (never
 * clue text, private imports or contribution caps).
 */
export interface RoomWorld {
  roomId: string;
  viewerId?: string;
  events: CouncilEvent[];
  members?: Record<CouncilActor, CouncilMemberState>;
  decorations: DecorationSpec[];
  participants: { id: string; displayName: string; joinedAt?: number }[];
  clues: { id: string; kind: string; publisherId: string }[];
  /** Clicking a meaningful object in the scene opens its readable overlay in the DOM. */
  onPick?: (target: PickTarget) => void;
}

/** Things in the 3D room a viewer can click to read about. */
export type PickTarget = { kind: "jar"; jar: "wish" | "interest" | "moment" } | { kind: "scout" } | { kind: "charm" } | { kind: "agent"; actor: CouncilActor };
/** @deprecated kept for older imports; use RoomWorld. */
export type IslandCouncil = RoomWorld;

/** Warm fade between outside and the tower; also the clock that advances the stage transition. */
function StageVeil() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      roomStage.advance((now - last) / 1000);
      last = now;
      if (ref.current) ref.current.style.opacity = String(roomStage.fade);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div ref={ref} className="pointer-events-none fixed inset-0 z-[5] bg-[#2a1d18]" style={{ opacity: 0 }} aria-hidden />;
}
interface WorldState {
  webgl: boolean | null; ready: boolean; soundEnabled: boolean; toggleSound: () => void;
  setCouncil: (value: RoomWorld | null) => void;
}
const WorldContext = createContext<WorldState | null>(null);
export function useIslandWorld() {
  const value = useContext(WorldContext);
  if (!value) throw new Error("IslandWorldProvider is required");
  return value;
}

/** Root-layout owner: route changes replace DOM panels while this Canvas stays mounted. */
export function IslandWorldProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The phone controller (/room/:id/phone) never loads the 3D world.
  const phone = pathname.startsWith("/room/") && pathname.split("/")[3] === "phone";
  const map = pathname.startsWith("/room/") && pathname.split("/")[3] === "map";
  const roomId = pathname.startsWith("/room/") && !phone ? pathname.split("/")[2] : undefined;
  const visible = pathname === "/" || (!!roomId && !map);
  const initialMotionPreference = useReducedMotion() ?? false;
  const [liveMotionPreference, setLiveMotionPreference] = useState<boolean | null>(null);
  const reducedMotion = liveMotionPreference ?? initialMotionPreference;
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setLiveMotionPreference(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  const phase = useIntroPhase();
  const unwrap = useUnwrapPhase();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [painterlyStrength, setPainterly] = useState(0);
  const [council, setCouncil] = useState<RoomWorld | null>(null);
  const [assets, setAssets] = useState<Partial<Record<CouncilActor, "ready" | "failed">>>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2");
      setWebgl(!!gl);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      setSoundEnabled(localStorage.getItem("unwrap:sound") === "on");
    } catch { setWebgl(false); }
    const value = Number(new URLSearchParams(window.location.search).get("painterly"));
    if (Number.isFinite(value)) setPainterly(Math.min(1, Math.max(0, value)));
  }, []);
  useEffect(() => {
    // Leaving a room returns the camera to the island outside.
    if (!roomId) roomStage.go(null);
  }, [roomId]);
  useEffect(() => {
    if (pathname !== "/") {
      if (introClock.active) introClock.finish();
      // Invitation normally closes before navigating; a route change must release its camera.
      unwrapClock.reset();
    }
  }, [pathname]);
  const markUnavailable = useCallback(() => setWebgl(false), []);
  const markReady = useCallback(() => setReady(true), []);
  const assetStatus = useCallback((actor: CouncilActor, status: "ready" | "failed") => setAssets(prev => prev[actor] === status ? prev : { ...prev, [actor]: status }), []);
  const toggleSound = useCallback(() => setSoundEnabled(on => {
    const next = !on;
    try { localStorage.setItem("unwrap:sound", next ? "on" : "off"); } catch { /* unavailable storage */ }
    // Inside the click, so the browser allows the music to start.
    setSfxEnabled(next);
    return next;
  }), []);
  useEffect(() => { setSfxEnabled(soundEnabled); }, [soundEnabled]);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!soundEnabled || e.button > 0) return;
      resumeMusic();
      const cue = cueFromTarget(e.target);
      if (cue && cue !== "silent") playSfx(cue);
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, [soundEnabled]);
  const value = useMemo(() => ({ webgl, ready, soundEnabled, toggleSound, setCouncil }), [webgl, ready, soundEnabled, toggleSound]);
  const activeCouncil = roomId && council?.roomId === roomId ? council : null;
  // The council's models only mount inside the tower, so only report their loading there.
  const inTower = useRoomStage().shown === "tower";
  return (
    <WorldContext.Provider value={value}>
      {visible && <div className="fixed inset-0 z-0 world-fallback">
        {webgl && <ErrorBoundary key={retry} onError={markUnavailable} fallback={<div className="world-fallback h-full" />}>
          <div className={`h-full transition-opacity duration-[1400ms] ${ready ? "opacity-100" : "opacity-0"} ${phase !== "landingReady" ? "pointer-events-none" : ""}`}>
            <WorldCanvas reducedMotion={reducedMotion} soundEnabled={soundEnabled} painterlyStrength={painterlyStrength} introActive={phase !== "landingReady"} onReady={markReady} onUnavailable={markUnavailable} council={activeCouncil} roomActive={!!roomId} onAssetStatus={assetStatus} />
          </div>
        </ErrorBoundary>}
      </div>}
      {visible && <StageVeil />}
      {children}
      {visible && webgl === false && <p className="fixed bottom-3 right-3 z-30 rounded-full bg-paper/90 px-4 py-2 text-xs text-dusk">3D unavailable · using the room’s list view.</p>}
      {activeCouncil && inTower && Object.values(assets).includes("failed") && <div role="alert" className="fixed bottom-3 right-3 z-30 rounded-2xl bg-paper px-4 py-3 text-sm text-dusk shadow-sm">An agent model could not load. <button className="underline" onClick={() => { setAssets({}); setRetry(n => n + 1); }}>Retry models</button></div>}
      {activeCouncil && inTower && !Object.values(assets).includes("failed") && Object.keys(assets).length < 5 && webgl && <p role="status" className="fixed bottom-3 right-3 z-30 rounded-full bg-paper/90 px-4 py-2 text-xs">The council is arriving…</p>}
    </WorldContext.Provider>
  );
}
