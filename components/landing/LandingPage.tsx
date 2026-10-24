"use client";

import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { introClock, useIntroPhase } from "@/components/intro/introTimeline";
import { StorybookIntro } from "@/components/intro/StorybookIntro";
import { mockLandingActions } from "@/lib/mocks/landing";
import { LandingHeader } from "./LandingHeader";
import { LandingHero } from "./LandingHero";

const WorldCanvas = dynamic(() => import("@/components/world/WorldCanvas"), { ssr: false });

const SOUND_KEY = "unwrap:sound";
const INTRO_KEY = "unwrap:intro-seen";
let introDecided = false;

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Whether the storybook intro should autoplay: once per browser session,
 * never with reduced motion or without WebGL. `?intro=1` forces it, `?intro=0`
 * disables it, and `?introAt=<seconds>` freezes it at a moment (QA).
 */
function shouldPlayIntro(params: URLSearchParams, reducedMotion: boolean, webgl: boolean): boolean {
  if (!webgl || reducedMotion) return false;
  const flag = params.get("intro");
  if (flag === "0") return false;
  if (flag === "1" || params.has("introAt")) return true;
  try {
    return sessionStorage.getItem(INTRO_KEY) !== "1";
  } catch {
    return true;
  }
}

export function LandingPage() {
  const reducedMotion = useReducedMotion() ?? false;
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [joinRequest, setJoinRequest] = useState(0);
  const [painterlyStrength, setPainterlyStrength] = useState(0);
  const phase = useIntroPhase();
  const introActive = phase !== "landingReady";
  const markWorldReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const gl = hasWebGL();
    setWebgl(gl);
    const params = new URLSearchParams(window.location.search);
    const painterly = Number(params.get("painterly"));
    if (Number.isFinite(painterly)) setPainterlyStrength(Math.min(1, Math.max(0, painterly)));
    try {
      setSoundEnabled(localStorage.getItem(SOUND_KEY) === "on");
    } catch {
      // Storage can be blocked; sound simply defaults to off.
    }
    // Decided once per page load (Strict Mode remounts must not restart or cancel it).
    if (!introDecided) {
      introDecided = true;
      if (shouldPlayIntro(params, reducedMotion, gl)) {
        const at = Number(params.get("introAt"));
        introClock.pauseAt = params.has("introAt") && Number.isFinite(at) ? at : null;
        introClock.start();
        try {
          sessionStorage.setItem(INTRO_KEY, "1");
        } catch {
          // ignore
        }
      }
    }
    // A later reduced-motion change skips via the effect below.
  }, []);

  useEffect(() => {
    if (reducedMotion && introClock.active) introClock.finish();
  }, [reducedMotion]);

  const replayIntro = useCallback(() => {
    introClock.pauseAt = null;
    introClock.start();
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((on) => {
      try {
        localStorage.setItem(SOUND_KEY, on ? "off" : "on");
      } catch {
        // ignore
      }
      return !on;
    });
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative h-dvh min-h-[640px] w-full overflow-hidden bg-sky">
        {/* Painted sky shown while the world loads, and as the no-WebGL fallback. */}
        <div className="world-fallback absolute inset-0" aria-hidden />
        {webgl && (
          <div
            className={`absolute inset-0 transition-opacity duration-[1400ms] ease-out ${ready ? "opacity-100" : "opacity-0"} ${introActive ? "pointer-events-none" : ""}`}
          >
            <WorldCanvas
              reducedMotion={reducedMotion}
              soundEnabled={soundEnabled}
              painterlyStrength={painterlyStrength}
              introActive={introActive}
              onReady={markWorldReady}
            />
          </div>
        )}
        <p className="sr-only">
          A hand-painted floating island in the clouds. A large cream present tied with a coral bow sits on a stone platform, watched by
          five small hooded storybook spirits, with a tower, cottages, gardens and a bridge. Beyond it float a windmill village, a
          cloud castle, hanging gardens and a distant watchtower above a sea of clouds and lavender mountains.
        </p>

        {/* Ivory wash keeps the editorial column legible over the world. */}
        <div
          className={`editorial-wash pointer-events-none absolute inset-y-0 left-0 w-[58%] transition-opacity duration-[1200ms] ease-out ${introActive ? "opacity-0" : "opacity-100"}`}
          aria-hidden
        />
        <div className="paper-grain pointer-events-none absolute inset-0" aria-hidden />

        {!introActive && (
          <div className="pointer-events-none relative z-10 flex h-full flex-col">
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}>
              <LandingHeader soundEnabled={soundEnabled} onToggleSound={toggleSound} onJoin={() => setJoinRequest((n) => n + 1)} />
            </motion.div>
            <div className="flex flex-1 items-center px-[clamp(40px,5vw,88px)] pb-16">
              <LandingHero actions={mockLandingActions} joinRequest={joinRequest} />
            </div>
          </div>
        )}

        <AnimatePresence>
          {introActive && (
            <motion.div key="intro" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }}>
              <StorybookIntro />
            </motion.div>
          )}
        </AnimatePresence>

        {!introActive && webgl && !reducedMotion && (
          <motion.button
            type="button"
            onClick={replayIntro}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 0.8 }}
            className="absolute right-6 bottom-5 z-10 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-dusk/55 transition hover:bg-paper/60 hover:text-dusk"
          >
            Replay intro
          </motion.button>
        )}

        {webgl === false && (
          <p className="absolute right-8 bottom-6 z-10 rounded-full bg-paper/80 px-4 py-2 text-[13px] text-dusk/70 backdrop-blur">
            The 3D world needs WebGL — showing a painted backdrop instead.
          </p>
        )}
      </main>
    </MotionConfig>
  );
}
