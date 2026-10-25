"use client";

import { useConvex, useQuery } from "convex/react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { introClock, useIntroPhase } from "@/components/intro/introTimeline";
import { StorybookIntro } from "@/components/intro/StorybookIntro";
import { useSession } from "@/components/providers/ConvexClientProvider";
import { playSfx } from "@/components/world/sounds";
import { InvitationTag } from "@/components/unwrap/InvitationTag";
import { lobby } from "@/components/unwrap/lobbyStore";
import { unwrapClock, useUnwrapPhase } from "@/components/unwrap/unwrapTimeline";
import { giftTag, useGiftTagState } from "@/components/world/giftTag/giftTagStore";
import { useIslandWorld } from "@/components/world/IslandWorldProvider";
import { appOrigin, inviteUrl } from "@/lib/invite";

const INTRO_KEY = "unwrap:intro-seen";
let introDecided = false;

/**
 * Whether the storybook intro should autoplay: once per browser session,
 * never with reduced motion or without WebGL, and never when coming back to
 * an existing lobby. `?intro=1` forces it, `?intro=0` disables it, and
 * `?introAt=<seconds>` freezes it at a moment (QA).
 */
function shouldPlayIntro(params: URLSearchParams, reducedMotion: boolean, webgl: boolean): boolean {
  if (!webgl || reducedMotion || params.has("lobby")) return false;
  const flag = params.get("intro");
  if (flag === "0") return false;
  if (flag === "1" || params.has("introAt")) return true;
  try {
    return sessionStorage.getItem(INTRO_KEY) !== "1";
  } catch {
    return true;
  }
}

/**
 * `/?lobby=<roomId>` (written once the room exists): a refresh or revisit
 * goes straight back to the open gift, its QR tree and the players who have
 * joined, with no cinematic and no second room. Only members can read the
 * room; anything else falls back to the title screen.
 */
function LobbyRestore({ roomId, staticPreview, onMissing }: { roomId: string; staticPreview: boolean; onMissing: () => void }) {
  const session = useSession();
  const res = useQuery(api.rooms.getRoom, session.status === "ready" ? { roomId: roomId as Id<"rooms"> } : "skip");
  const done = useRef(false);
  useEffect(() => {
    if (!res || done.current) return;
    done.current = true;
    if (!res.ok) {
      onMissing();
      return;
    }
    const { room, participants } = res.value;
    const host = participants.find((p) => p.role === "organizer");
    // Already here when the page loaded: they stand in place instead of arriving again.
    lobby.settled = new Set(participants.map((p) => p.id));
    unwrapClock.restore(
      {
        recipientDisplayName: room.recipientDisplayName,
        hostDisplayName: host?.displayName ?? "",
        occasion: room.occasion,
        roomId: room.id,
        inviteToken: room.inviteToken,
        inviteUrl: inviteUrl(`/join/${room.inviteToken}`, appOrigin(window.location.origin)),
      },
      { staticPreview },
    );
  }, [res, staticPreview, onMissing]);
  useEffect(() => {
    if (session.status === "error" || session.status === "offline") onMissing();
  }, [session.status, onMissing]);
  return null;
}

export function LandingPage() {
  const reducedMotion = useReducedMotion() ?? false;
  const { webgl, ready, soundEnabled, toggleSound } = useIslandWorld();
  const convex = useConvex();

  const phase = useIntroPhase();
  const introActive = phase !== "landingReady";
  const unwrapPhase = useUnwrapPhase();
  const unwrapActive = unwrapPhase !== "landing";
  const tagState = useGiftTagState();
  const [lobbyId, setLobbyId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const staticPreview = reducedMotion || webgl === false || (webgl === true && !ready);
  const staticRef = useRef(staticPreview);
  staticRef.current = staticPreview;

  useEffect(() => {
    setMounted(true);
    setLobbyId(new URLSearchParams(window.location.search).get("lobby"));
    giftTag.setEnabled(true);
    return () => {
      giftTag.setEnabled(false);
      lobby.clear();
    };
  }, []);

  // The tag hangs still while the intro plays and comes alive once the camera has settled.
  useEffect(() => {
    if (!mounted || webgl === null) return;
    if (introActive || introClock.active) giftTag.reset();
    else giftTag.reveal();
  }, [mounted, webgl, introActive]);

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

  // Pulling the Begin tag (in 3D or with the keyboard) starts chapter 2.
  const lastTug = useRef(giftTag.tugCount);
  useEffect(
    () =>
      giftTag.subscribe(() => {
        if (giftTag.tugCount === lastTug.current) return;
        lastTug.current = giftTag.tugCount;
        playSfx("wish");
        if (!unwrapClock.active && !introClock.active) unwrapClock.start({ staticPreview: staticRef.current });
      }),
    [],
  );

  const startOver = useCallback(() => {
    unwrapClock.reset();
    lobby.clear();
    setLobbyId(null);
    window.history.replaceState(null, "", "/");
    giftTag.reset();
    giftTag.reveal();
  }, []);
  const lobbyMissing = useCallback(() => {
    setLobbyId(null);
    window.history.replaceState(null, "", "/");
  }, []);

  const replayIntro = useCallback(() => {
    introClock.pauseAt = null;
    introClock.start();
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative h-dvh min-h-[640px] w-full overflow-hidden pointer-events-none">
        <p className="sr-only">
          A hand-painted floating island in the clouds. A large cream present tied with a coral bow sits on a stone platform, watched by
          small hooded storybook spirits, with a tower, cottages, gardens and a bridge. Beyond it float a windmill village, a cloud
          castle, hanging gardens and a distant watchtower above a sea of clouds and lavender mountains. A small parchment tag reading
          &ldquo;Begin&rdquo; hangs from the present&rsquo;s ribbon.
        </p>
        <div className="paper-grain pointer-events-none absolute inset-0" aria-hidden />

        {mounted && (
          <button
            type="button"
            data-sfx="silent"
            onClick={toggleSound}
            aria-pressed={soundEnabled}
            aria-label={soundEnabled ? "Sound on" : "Sound off"}
            className="pointer-events-auto absolute top-5 right-6 z-50 rounded-full border border-dusk/10 bg-paper/75 px-3.5 py-2 text-[13.5px] font-medium text-dusk/80 shadow-sm backdrop-blur-md transition hover:text-dusk"
          >
            {soundEnabled ? "Sound on" : "Sound off"}
          </button>
        )}

        {mounted && !introActive && !unwrapActive && !lobbyId && (
          // Mirrors the 3D tag for keyboards and screen readers (and stands in for it without WebGL).
          <div className="absolute bottom-10 left-1/2 z-10 -translate-x-1/2">
            <button
              type="button"
              data-sfx="silent"
              aria-label="Begin Unwrap"
              aria-disabled={tagState === "tugging" || tagState === "responding"}
              onClick={() => giftTag.tug()}
              onFocus={() => giftTag.setHover(true)}
              onBlur={() => giftTag.setHover(false)}
              className={`begin-tag pointer-events-auto ${webgl === false ? "" : "sr-only focus-visible:not-sr-only"} ${tagState === "responding" ? "is-glowing" : ""}`}
            >
              <span aria-hidden className="mr-2 text-[0.7em] text-coral">▶</span>Begin
            </button>
          </div>
        )}

        {lobbyId && convex && !unwrapActive && <LobbyRestore roomId={lobbyId} staticPreview={staticPreview} onMissing={lobbyMissing} />}
        {unwrapActive && <InvitationTag soundEnabled={soundEnabled} onStartOver={startOver} inlineQr={webgl === false} />}

        <AnimatePresence>
          {introActive && (
            <motion.div key="intro" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }}>
              <StorybookIntro />
            </motion.div>
          )}
        </AnimatePresence>

        {mounted && !introActive && !unwrapActive && !lobbyId && webgl && !reducedMotion && (
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
