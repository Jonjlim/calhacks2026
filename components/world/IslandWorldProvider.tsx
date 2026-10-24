"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { introClock, useIntroPhase } from "@/components/intro/introTimeline";
import { useUnwrapPhase, unwrapClock } from "@/components/unwrap/unwrapTimeline";
import { roomStage, useRoomStage } from "@/components/room/roomStage";
import type { CouncilActor, CouncilEvent, DecorationSpec } from "@/lib/council/contracts";

const WorldCanvas = dynamic(() => import("./WorldCanvas"), { ssr: false });
/**
 * What the 3D world needs to stage one gift room. Display data only: council
 * events and charms, the participants, and room-visible clue ids/kinds (never
 * clue text, private imports or contribution caps).
 */
export interface RoomWorld {
  roomId: string;
  events: CouncilEvent[];
  decorations: DecorationSpec[];
  participants: { id: string; displayName: string }[];
  clues: { id: string; kind: string; publisherId: string }[];
}
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
  const roomId = pathname.startsWith("/room/") ? pathname.split("/")[2] : undefined;
  const visible = pathname === "/" || !!roomId;
  const reducedMotion = useReducedMotion() ?? false;
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
  const markReady = useCallback(() => setReady(true), []);
  const assetStatus = useCallback((actor: CouncilActor, status: "ready" | "failed") => setAssets(prev => prev[actor] === status ? prev : { ...prev, [actor]: status }), []);
  const toggleSound = useCallback(() => setSoundEnabled(on => {
    try { localStorage.setItem("unwrap:sound", on ? "off" : "on"); } catch { /* unavailable storage */ }
    return !on;
  }), []);
  const value = useMemo(() => ({ webgl, ready, soundEnabled, toggleSound, setCouncil }), [webgl, ready, soundEnabled, toggleSound]);
  const activeCouncil = roomId && council?.roomId === roomId ? council : null;
  // The council's models only mount inside the tower, so only report their loading there.
  const inTower = useRoomStage().shown === "tower";
  return (
    <WorldContext.Provider value={value}>
      {visible && <div className="fixed inset-0 z-0 world-fallback" aria-hidden="true">
        {webgl && <ErrorBoundary key={retry} fallback={<div className="world-fallback h-full" />}>
          <div className={`h-full transition-opacity duration-[1400ms] ${ready ? "opacity-100" : "opacity-0"} ${phase !== "landingReady" || unwrap !== "landing" ? "pointer-events-none" : ""}`}>
            <WorldCanvas reducedMotion={reducedMotion} soundEnabled={soundEnabled} painterlyStrength={painterlyStrength} introActive={phase !== "landingReady"} onReady={markReady} council={activeCouncil} roomActive={!!roomId} onAssetStatus={assetStatus} />
          </div>
        </ErrorBoundary>}
      </div>}
      {visible && <StageVeil />}
      {children}
      {visible && webgl === false && <p className="fixed bottom-3 right-3 z-30 rounded-full bg-paper/90 px-4 py-2 text-xs text-dusk">Painted backdrop · 3D unavailable. All room controls still work.</p>}
      {activeCouncil && inTower && Object.values(assets).includes("failed") && <div role="alert" className="fixed bottom-3 right-3 z-30 rounded-2xl bg-paper px-4 py-3 text-sm text-dusk shadow-sm">An agent model could not load. <button className="underline" onClick={() => { setAssets({}); setRetry(n => n + 1); }}>Retry models</button></div>}
      {activeCouncil && inTower && !Object.values(assets).includes("failed") && Object.keys(assets).length < 5 && webgl && <p role="status" className="fixed bottom-3 right-3 z-30 rounded-full bg-paper/90 px-4 py-2 text-xs">The council is arriving…</p>}
    </WorldContext.Provider>
  );
}
