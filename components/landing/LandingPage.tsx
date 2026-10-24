"use client";

import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useIslandWorld } from "@/components/world/IslandWorldProvider";
import { useCallback, useEffect, useRef, useState } from "react";
import { introClock, useIntroPhase } from "@/components/intro/introTimeline";
import { StorybookIntro } from "@/components/intro/StorybookIntro";
import { UnwrapInvitation } from "@/components/unwrap/UnwrapInvitation";
import { unwrapClock, useUnwrapPhase } from "@/components/unwrap/unwrapTimeline";
import type { CreateRoomDraft, LandingRoomEntry } from "@/lib/mocks/landing";
import { LandingHeader } from "./LandingHeader";
import { LandingHero } from "./LandingHero";
import { useLandingActions } from "./useLandingActions";



const SOUND_KEY = "unwrap:sound";
const INTRO_KEY = "unwrap:intro-seen";
let introDecided = false;

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
  const landingActions = useLandingActions();
  const reducedMotion = useReducedMotion() ?? false;
  const { webgl, ready, soundEnabled, toggleSound } = useIslandWorld();
  const [joinRequest, setJoinRequest] = useState(0);

  const phase = useIntroPhase();
  const introActive = phase !== "landingReady";
  const unwrapPhase = useUnwrapPhase();
  const unwrapActive = unwrapPhase !== "landing";
  const wasUnwrapping = useRef(false);


  useEffect(() => {
    if (webgl === null) return;
    const gl = webgl;
    const params = new URLSearchParams(window.location.search);
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
  }, [webgl, reducedMotion]);

  useEffect(() => {
    if (reducedMotion && introClock.active) introClock.finish();
  }, [reducedMotion]);

  // A successful create turns the island's present into the invitation, in-world.
  const onRoomCreated = useCallback(
    (entry: LandingRoomEntry, draft: CreateRoomDraft) => {
      if (introClock.active) return;
      unwrapClock.start(
        {
          recipientDisplayName: draft.recipientDisplayName.trim(),
          occasion: draft.occasion.trim(),
          hostDisplayName: draft.displayName.trim(),
          source: entry.source,
          roomId: entry.roomId,
          ...(entry.inviteToken ? { inviteToken: entry.inviteToken } : {}),
        },
        // Reduced motion, no WebGL, or a world that never loaded: show the stationary HTML invitation.
        { staticPreview: reducedMotion || !webgl || !ready },
      );
    },
    [reducedMotion, webgl, ready],
  );

  // Back on the island: hand focus to the room's next step.
  useEffect(() => {
    if (unwrapActive) {
      wasUnwrapping.current = true;
      return;
    }
    if (!wasUnwrapping.current) return;
    wasUnwrapping.current = false;
    window.setTimeout(() => document.querySelector<HTMLElement>("[data-entered-primary]")?.focus(), 60);
  }, [unwrapActive]);

  const replayIntro = useCallback(() => {
    introClock.pauseAt = null;
    introClock.start();
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative h-dvh min-h-[640px] w-full overflow-hidden pointer-events-none">
        <p className="sr-only">
          A hand-painted floating island in the clouds. A large cream present tied with a coral bow sits on a stone platform, watched by
          five small hooded storybook spirits, with a tower, cottages, gardens and a bridge. Beyond it float a windmill village, a
          cloud castle, hanging gardens and a distant watchtower above a sea of clouds and lavender mountains.
        </p>

        {/* Ivory wash keeps the editorial column legible over the world. */}
        <div
          className={`editorial-wash pointer-events-none absolute inset-y-0 left-0 w-[58%] transition-opacity duration-[1200ms] ease-out ${introActive || unwrapActive ? "opacity-0" : "opacity-100"}`}
          aria-hidden
        />
        <div className="paper-grain pointer-events-none absolute inset-0" aria-hidden />

        {!introActive && (
          <motion.div
            // The form recedes (but stays mounted, keeping its state) while the gift transforms.
            animate={unwrapActive ? { opacity: 0, y: 12, filter: "blur(6px)" } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: unwrapActive ? 0.4 : 0.6, delay: unwrapActive ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
            inert={unwrapActive}
            aria-hidden={unwrapActive || undefined}
            className="pointer-events-none relative z-10 flex h-full flex-col"
          >
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}>
              <LandingHeader soundEnabled={soundEnabled} onToggleSound={toggleSound} onJoin={() => setJoinRequest((n) => n + 1)} />
            </motion.div>
            <div className="flex flex-1 items-center px-[clamp(40px,5vw,88px)] pb-16">
              <LandingHero actions={landingActions} joinRequest={joinRequest} onRoomCreated={onRoomCreated} />
            </div>
          </motion.div>
        )}

        {unwrapActive && <UnwrapInvitation />}

        <AnimatePresence>
          {introActive && (
            <motion.div key="intro" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }}>
              <StorybookIntro />
            </motion.div>
          )}
        </AnimatePresence>

        {!introActive && !unwrapActive && webgl && !reducedMotion && (
          <motion.button
            type="button"
            onClick={replayIntro}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 0.8 }}
            className="pointer-events-auto absolute right-6 bottom-5 z-10 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-dusk/55 transition hover:bg-paper/60 hover:text-dusk"
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
