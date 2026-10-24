"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { mockQrModules, type QrModules } from "@/lib/invitation/mockQr";
import { type InvitationDetails, UNWRAP_TIMES, unwrapClock, useUnwrapPhase } from "./unwrapTimeline";

/**
 * DOM half of the gift-to-invitation sequence: advances the shared clock,
 * places a parchment note with the invitation beside the QR the present has
 * become (GiftUnwrap publishes its screen rect), and owns Skip / Close /
 * Replay. When the 3D path is
 * unavailable (reduced motion, no WebGL, or a stalled sequence) it renders
 * the same invitation as a plain HTML card with an SVG QR.
 */

/** Decorative QR rendering for the HTML fallback; takes any module grid. */
export function QrModulesSvg({ modules, className }: { modules: QrModules; className?: string }) {
  const n = modules.length;
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className={className} shapeRendering="crispEdges" role="img" aria-label="Demo QR pattern (not scannable)">
      {modules.flatMap((row, r) => row.map((dark, c) => (dark ? <rect key={`${r}-${c}`} x={c + 0.05} y={r + 0.05} width={0.9} height={0.9} rx={0.12} fill="#3b2c3c" /> : null)))}
    </svg>
  );
}

/** Hand-drawn sprig for the card corners; draws itself in when shown. */
function Sprig({ className, delay }: { className: string; delay: number }) {
  const draw = { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 1.1, delay, ease: [0.22, 1, 0.36, 1] } } as const;
  return (
    <svg viewBox="0 0 80 80" className={className} fill="none" aria-hidden>
      <motion.path d="M6 74C20 58 30 42 34 24C36 15 40 9 46 6" stroke="#6f8f52" strokeWidth="1.6" strokeLinecap="round" {...draw} />
      <motion.path d="M22 54c-8-2-13 1-15 6 6 2 11 0 15-6zM29 40c-2-8 1-13 6-15 2 6 0 11-6 15zM31 30c7-3 12-1 15 3-6 3-11 2-15-3z" stroke="#6f8f52" strokeWidth="1.2" fill="rgba(140,178,86,0.18)" {...draw} />
      <motion.circle cx="47" cy="7" r="4" stroke="#d9735e" strokeWidth="1.3" fill="rgba(239,154,134,0.35)" {...draw} />
      <motion.circle cx="14" cy="62" r="2.6" stroke="#d9735e" strokeWidth="1.1" fill="rgba(246,183,198,0.4)" {...draw} />
    </svg>
  );
}

function CardText({ invite, compact }: { invite: InvitationDetails; compact?: boolean }) {
  const rise = (d: number) => ({ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay: d, ease: [0.22, 1, 0.36, 1] } }) as const;
  return (
    <>
      <motion.p {...rise(0.05)} className="font-hand text-[1em] leading-none text-[#c46f5a]">
        an invitation from {invite.hostDisplayName}
      </motion.p>
      <motion.h2 {...rise(0.15)} id="invite-title" tabIndex={-1} className="font-display mt-[0.4em] text-[1.45em] leading-[1.08] font-medium text-[#41344c] outline-none">
        You&rsquo;re invited to help unwrap a little magic
      </motion.h2>
      <motion.div {...rise(0.3)} className={compact ? "mt-3" : "mt-[0.7em]"}>
        <p className="text-[0.62em] font-semibold tracking-[0.14em] text-[#41344c]/55 uppercase">A gift for</p>
        <p className="font-display text-[2em] leading-[1.05] font-semibold break-words text-[#41344c]">{invite.recipientDisplayName}</p>
        <p className="font-hand mt-[0.1em] text-[1.1em] leading-tight text-[#41344c]/75">{invite.occasion}</p>
      </motion.div>
    </>
  );
}

function DemoLabel({ invite }: { invite: InvitationDetails }) {
  return (
    <p className="text-[0.56em] leading-snug font-semibold tracking-[0.08em] text-[#41344c]/60 uppercase">
      Demo QR · not scannable
      {invite.source === "mock" && <span className="mt-[0.25em] block font-medium tracking-normal normal-case">Preview mode — this room isn&rsquo;t saved yet</span>}
      {invite.inviteToken && (
        <span className="mt-[0.5em] block tracking-normal normal-case">
          Room code <code className="font-mono text-[1.15em] font-semibold text-[#41344c]/85 select-all">{invite.inviteToken}</code>
        </span>
      )}
    </p>
  );
}

/** Real invite link. A configured public/LAN URL wins so phones can open it; otherwise this page's origin. */
function inviteUrl(token: string): string {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, "");
  return `${origin}/join/${encodeURIComponent(token)}`;
}

function CopyInvite({ token }: { token: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(inviteUrl(token));
          setCopied("copied");
        } catch {
          setCopied("failed");
        }
      }}
      className="btn-secondary h-11 px-5 text-[14.5px]"
    >
      {copied === "copied" ? "Link copied" : copied === "failed" ? "Copy failed — use the room code" : "Copy invite link"}
    </button>
  );
}

function Controls({ ready, onClose, invite }: { ready: boolean; onClose: () => void; invite: InvitationDetails }) {
  const live = invite.source === "convex" && invite.roomId;
  return (
    <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-3">
      {ready ? (
        <>
          {live && (
            <Link href={`/room/${invite.roomId}`} className="btn-primary h-11 px-6 text-[15px]">
              Enter the room
            </Link>
          )}
          {live && invite.inviteToken && <CopyInvite token={invite.inviteToken} />}
          <button type="button" onClick={onClose} className={`${live ? "btn-secondary" : "btn-primary"} h-11 px-6 text-[15px]`}>
            Back to the island
          </button>
          <button type="button" onClick={() => unwrapClock.replay()} className="btn-secondary h-11 px-5 text-[14.5px]">
            Replay animation
          </button>
        </>
      ) : (
        <button type="button" onClick={() => unwrapClock.skip()} className="btn-secondary h-10 px-5 text-[14px]">
          Skip animation
        </button>
      )}
    </div>
  );
}

export function UnwrapInvitation() {
  const phase = useUnwrapPhase();
  const invite = unwrapClock.invite;
  const note = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const ready = phase === "invitationReady";
  const returning = phase === "returningToWorld";
  const staticPreview = unwrapClock.staticPreview;
  const modules = useMemo(() => mockQrModules(invite ? `${invite.recipientDisplayName}·${invite.occasion}` : "unwrap"), [invite]);

  // Drive the clock and keep the note beside the code (right of it on wide screens, below on narrow ones).
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let waitedForCard = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden) unwrapClock.advance(dt);
      const el = note.current;
      const label = tag.current;
      const rect = unwrapClock.cardRect;
      if (el && label && rect && !unwrapClock.staticPreview) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const wide = vw / vh >= 1.05;
        if (wide) {
          const left = rect.x + rect.w + Math.max(32, vw * 0.035);
          const width = Math.min(400, vw - left - 28);
          el.style.left = `${left}px`;
          el.style.width = `${width}px`;
          el.style.top = `${rect.y + rect.h / 2}px`;
          el.style.transform = "translateY(-50%)";
        } else {
          const width = Math.min(380, vw * 0.9);
          el.style.left = `${(vw - width) / 2}px`;
          el.style.width = `${width}px`;
          el.style.top = `${rect.y + rect.h + 46}px`;
          el.style.transform = "none";
        }
        label.style.left = `${rect.x + rect.w / 2}px`;
        label.style.top = `${rect.y + rect.h + 10}px`;
        el.style.visibility = label.style.visibility = "visible";
      } else if (el && label) {
        el.style.visibility = label.style.visibility = "hidden";
      }
      // If the 3D code never settles (WebGL stalled), fall back to the HTML card.
      if (unwrapClock.active && !unwrapClock.staticPreview && unwrapClock.t >= UNWRAP_TIMES.settled && !rect && unwrapClock.phase !== "returningToWorld") {
        waitedForCard += dt;
        if (waitedForCard > 0.8) unwrapClock.degrade();
      } else waitedForCard = 0;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (unwrapClock.phase === "invitationReady") unwrapClock.close();
      else unwrapClock.skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Move focus into the invitation once it is readable.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => document.getElementById("invite-title")?.focus(), staticPreview ? 50 : 500);
    return () => window.clearTimeout(id);
  }, [ready, staticPreview, unwrapClock.run]);

  if (!invite) return null;
  const close = () => unwrapClock.close();
  const showText = ready && !returning;

  return (
    <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-labelledby="invite-title" aria-label={ready ? undefined : "Creating your invitation"}>
      {staticPreview ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#41344c]/25 p-4 backdrop-blur-[2px]">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative flex w-[min(380px,92vw)] flex-col items-center rounded-[10px] bg-[#fbf3e3] px-8 pt-9 pb-7 text-center text-[17px] shadow-[0_30px_60px_-30px_rgba(60,36,30,0.6)] ring-1 ring-[#d9735e]/40"
          >
            <div className="pointer-events-none absolute inset-[10px] rounded-[6px] border border-[#d9735e]/55" />
            <Sprig className="absolute top-1 left-1 h-14 w-14 -scale-x-100" delay={0.2} />
            <Sprig className="absolute right-1 bottom-1 h-14 w-14 rotate-180 -scale-x-100" delay={0.35} />
            <CardText invite={invite} compact />
            <div className="mt-5 rounded-md bg-white/70 p-3">
              <QrModulesSvg modules={modules} className="h-36 w-36" />
            </div>
            <div className="mt-3">
              <DemoLabel invite={invite} />
            </div>
          </motion.div>
        </div>
      ) : (
        <>
          <div ref={tag} className="pointer-events-none absolute -translate-x-1/2" style={{ visibility: "hidden" }}>
            <AnimatePresence>
              {showText && (
                <motion.p
                  key={unwrapClock.run}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.3 } }}
                  exit={{ opacity: 0 }}
                  className="rounded-full bg-[#fbf3e3]/90 px-3 py-1 text-[11px] font-semibold tracking-[0.08em] whitespace-nowrap text-[#41344c]/70 uppercase shadow-sm"
                >
                  Demo QR · not scannable
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <div ref={note} className="pointer-events-none absolute" style={{ visibility: "hidden" }}>
            <AnimatePresence>
              {showText && (
                <motion.div
                  key={unwrapClock.run}
                  initial={{ opacity: 0, x: 14, rotate: 1.5 }}
                  animate={{ opacity: 1, x: 0, rotate: -0.6 }}
                  exit={{ opacity: 0, x: 10, transition: { duration: 0.25 } }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  className="relative rounded-[10px] bg-[#fbf3e3] px-8 pt-8 pb-6 text-center text-[clamp(15px,1.3vw,18px)] shadow-[0_30px_60px_-30px_rgba(60,36,30,0.65)] ring-1 ring-[#d9735e]/40"
                >
                  <div className="pointer-events-none absolute inset-[9px] rounded-[6px] border border-[#d9735e]/55" />
                  <Sprig className="absolute top-1 left-1 h-14 w-14 -scale-x-100" delay={0.25} />
                  <Sprig className="absolute right-1 bottom-1 h-14 w-14 rotate-180 -scale-x-100" delay={0.4} />
                  <CardText invite={invite} compact />
                  <div className="mt-4">
                    <DemoLabel invite={invite} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      <AnimatePresence>
        {!returning && (
          <motion.div
            key={ready ? "ready" : "running"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { delay: ready && !staticPreview ? 0.7 : 0.2 } }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 bottom-[max(18px,3.5vh)]"
          >
            <Controls ready={ready} onClose={close} invite={invite} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
