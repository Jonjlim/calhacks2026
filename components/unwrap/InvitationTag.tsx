"use client";

import { useConvex, useQuery } from "convex/react";
import { motion } from "motion/react";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useLandingActions } from "@/components/landing/useLandingActions";
import { useSession } from "@/components/providers/ConvexClientProvider";
import { playSfx } from "@/components/world/sounds";
import { appOrigin, inviteUrl } from "@/lib/invite";
import { inviteQrModules } from "@/lib/invitation/realQr";
import { avatarForIndex, inJoinOrder, portraitUrl } from "@/lib/room/avatars";
import { LIMITS } from "@/lib/validation";
import { lobby, type LobbyMember, useLobbyMembers } from "./lobbyStore";
import { handoffRect, parchmentRect } from "./parchmentLayout";
import { QrModulesSvg } from "./QrModulesSvg";
import { type InvitationDetails, progress, UNWRAP_TIMES, unwrapClock, useUnwrapClock } from "./unwrapTimeline";

/**
 * The DOM half of chapter 2: the Begin tag's reverse side, grown into a tall
 * parchment invitation in the right third of the screen. It advances the
 * shared clock, takes over from the flying 3D tag on the same pixels
 * (parchmentLayout), asks for TO / FROM, creates the room through the
 * existing createRoom action, lays the real QR over the tree's plaque, and
 * lists everyone who has actually joined (Convex getRoom subscription).
 */

const MIN_SLOTS = 4;
/** The organizer's participant name. They aren't listed: FROM is the friends who join. */
const HOST_NAME = "Organizer";
const easeOutBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

function Slot({ member, waiting, settled }: { member?: LobbyMember; waiting: boolean; settled: boolean }) {
  return (
    <motion.li
      layout
      initial={member && !settled ? { opacity: 0, y: 8, scale: 0.94 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-[0.7em] rounded-[0.7em] bg-[#efdcbc]/55 px-[0.7em] py-[0.45em] shadow-[inset_0_1px_2px_rgba(120,80,40,0.12)]"
    >
      {member ? (
        <>
          <img src={portraitUrl(member.avatar)} alt="" className="h-[2.1em] w-[2.1em] rounded-full bg-[#fbf3e3] object-cover ring-2 ring-[#d9b66f]/70" />
          <span className="font-hand min-w-0 flex-1 truncate text-[1.35em] leading-none text-[#4e2f42]">{member.displayName}</span>
          {member.role === "organizer" ? (
            <span className="text-[0.62em] font-semibold tracking-[0.12em] text-[#4e2f42]/55 uppercase">host</span>
          ) : (
            <motion.span initial={settled ? false : { scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.25, type: "spring", stiffness: 260, damping: 14 }} className="text-[1em] text-[#d9a640]" aria-hidden>
              ✦
            </motion.span>
          )}
        </>
      ) : (
        <>
          <span className="h-[2.1em] w-[2.1em] shrink-0 rounded-full border-2 border-dashed border-[#6b4658]/35" aria-hidden />
          <span className="font-hand text-[1.2em] leading-none text-[#4e2f42]/45">{waiting ? "Scanning…" : "—"}</span>
        </>
      )}
    </motion.li>
  );
}

/** Live participants of the room, mirrored into the lobby store for the 3D spirits. */
function LiveMembers({ roomId, soundEnabled, onStatus }: { roomId: string; soundEnabled: boolean; onStatus: (s: string) => void }) {
  const session = useSession();
  const res = useQuery(api.rooms.getRoom, session.status === "ready" ? { roomId: roomId as Id<"rooms"> } : "skip");
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!res) return;
    if (!res.ok) {
      onStatus(res.error.message);
      return;
    }
    const members: LobbyMember[] = inJoinOrder(res.value.participants).map((p, i) => ({ id: p.id, displayName: p.displayName, role: p.role === "organizer" ? "organizer" : "contributor", avatar: avatarForIndex(i) }));
    const before = seen.current;
    const arrived = before ? members.filter((m) => !before.has(m.id)) : [];
    seen.current = new Set(members.map((m) => m.id));
    lobby.set(members);
    if (arrived.length) {
      onStatus(`${arrived.map((m) => m.displayName).join(", ")} joined`);
      if (soundEnabled) playSfx("coin");
    }
  }, [res, soundEnabled, onStatus]);
  return null;
}

function NamesForm({ onCreated }: { onCreated: (invite: InvitationDetails) => void }) {
  const actions = useLandingActions();
  const [to, setTo] = useState("");
  const [occasion, setOccasion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // One room per invitation: double submits and re-renders can't create a second.
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    setError(null);
    unwrapClock.submitNames();
    // The organizer isn't asked for a name here: FROM is everyone who joins.
    const res = await actions.createRoom({ recipientDisplayName: to, displayName: HOST_NAME, occasion: occasion.trim() || "A gift from friends" });
    if (res.ok && res.value.source === "convex" && res.value.inviteToken) {
      onCreated({
        recipientDisplayName: to.trim(),
        hostDisplayName: HOST_NAME,
        occasion: occasion.trim() || "A gift from friends",
        roomId: res.value.roomId,
        inviteToken: res.value.inviteToken,
        inviteUrl: inviteUrl(`/join/${res.value.inviteToken}`, appOrigin(window.location.origin)),
      });
      return;
    }
    sending.current = false;
    setPending(false);
    unwrapClock.roomFailed();
    setError(res.ok ? "This preview isn't connected to Unwrap, so no real invitation can be made." : res.error.message);
  }

  const field = "font-hand min-w-0 flex-1 border-0 border-b-[1.5px] border-[#6b4658]/45 bg-transparent px-[0.2em] pb-[0.05em] text-[1.45em] leading-tight text-[#4e2f42] outline-none placeholder:text-[#4e2f42]/30 focus:border-[#c46f5a]";
  return (
    <form onSubmit={submit} className="flex flex-col gap-[0.7em]" aria-label="Who is this gift for?">
      <label className="flex items-baseline gap-[0.6em]">
        <span className="font-display w-[3.4em] text-[1.05em] font-semibold tracking-[0.06em] text-[#4e2f42]">TO:</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} maxLength={LIMITS.displayNameMaxChars} placeholder="who it's for" autoComplete="off" className={field} aria-label="To (the recipient)" disabled={pending} />
      </label>
      <label className="flex items-baseline gap-[0.6em]">
        <span className="font-display w-[3.4em] text-[0.8em] font-semibold tracking-[0.08em] text-[#4e2f42]/60">FOR:</span>
        <input value={occasion} onChange={(e) => setOccasion(e.target.value)} maxLength={LIMITS.roomTitleMaxChars} placeholder="occasion (optional)" autoComplete="off" className={`${field} text-[1.1em]`} aria-label="Occasion (optional)" disabled={pending} />
      </label>
      {error && (
        <p role="alert" className="text-[0.78em] leading-snug text-[#a3402e]">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !to.trim()} className="btn-primary mt-[0.2em] h-[2.5em] self-center px-[1.4em] text-[0.9em] disabled:opacity-50">
        {pending ? "Inviting…" : "Invite"}
      </button>
    </form>
  );
}

function NamesWritten({ invite }: { invite: InvitationDetails }) {
  const occasion = invite.occasion === "A gift from friends" ? null : invite.occasion;
  const row = (label: string, value: string) => (
    <p className="flex items-baseline gap-[0.6em]">
      <span className="font-display w-[3.4em] text-[1.05em] font-semibold tracking-[0.06em] text-[#4e2f42]">{label}</span>
      <span className="font-hand min-w-0 flex-1 truncate border-b-[1.5px] border-[#6b4658]/30 text-[1.45em] leading-tight text-[#4e2f42]">
        {value} <span className="text-[0.7em] text-[#c46f5a]">♡</span>
      </span>
    </p>
  );
  return (
    <div className="flex flex-col gap-[0.6em]">
      {row("TO:", invite.recipientDisplayName)}
      {occasion && <p className="font-hand pl-[3.4em] text-[1.1em] leading-tight text-[#4e2f42]/70">{occasion}</p>}
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
      className="btn-secondary h-[2.3em] px-[1em] text-[0.78em]"
    >
      {state === "copied" ? "Link copied ✓" : state === "failed" ? "Copy failed — select the link" : "Copy invite link"}
    </button>
  );
}

export function InvitationTag({ soundEnabled, onStartOver, inlineQr = false }: { soundEnabled: boolean; onStartOver: () => void; inlineQr?: boolean }) {
  const clock = useUnwrapClock();
  const convex = useConvex();
  const members = useLobbyMembers();
  const card = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const invite = clock.invite;
  const modules = useMemo(() => (invite ? inviteQrModules(invite.inviteUrl) : null), [invite]);
  const ready = clock.phase === "lobbyReady";
  const revealHeard = useRef<number | null>(null);
  useEffect(() => {
    if (clock.staticPreview || clock.phase !== "boxOpening" || revealHeard.current === clock.run) return;
    revealHeard.current = clock.run;
    if (soundEnabled) playSfx("reveal");
  }, [clock.phase, clock.run, clock.staticPreview, soundEnabled]);

  // One loop drives the clock and keeps the card on its pixels.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden) unwrapClock.advance(dt);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const end = parchmentRect(vw, vh);
      const start = handoffRect(vw, vh);
      const t = unwrapClock.t;
      const still = unwrapClock.staticPreview;
      const appear = still ? 1 : progress(t, UNWRAP_TIMES.tagHandoff - 0.12, UNWRAP_TIMES.tagHandoff);
      const k = still ? 1 : easeOutBack(progress(t, UNWRAP_TIMES.tagHandoff, UNWRAP_TIMES.parchmentSettled));
      const x = start.x + (end.x - start.x) * k;
      const y = start.y + (end.y - start.y) * k;
      const w = start.w + (end.w - start.w) * k;
      const h = start.h + (end.h - start.h) * k;
      const el = card.current;
      if (el) {
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.style.fontSize = `${Math.max(6, w / 21)}px`;
        el.style.opacity = String(appear);
        el.style.visibility = appear > 0 ? "visible" : "hidden";
      }
      if (content.current) content.current.style.opacity = String(still ? 1 : progress(t, UNWRAP_TIMES.parchmentSettled - 0.35, UNWRAP_TIMES.parchmentSettled + 0.2));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") unwrapClock.skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the first field once the card has settled (and the names are still needed).
  useEffect(() => {
    if (invite) return;
    const id = window.setTimeout(() => card.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }), clock.staticPreview ? 60 : 2300);
    return () => window.clearTimeout(id);
  }, [invite, clock.run, clock.staticPreview]);

  const onCreated = (details: InvitationDetails) => {
    unwrapClock.roomReady(details);
    // A refresh comes back to this lobby instead of creating another room.
    window.history.replaceState(null, "", `/?lobby=${encodeURIComponent(details.roomId)}`);
    setStatus("Invitation ready. Friends can scan the code to join.");
  };

  const players = members.filter((m) => m.role !== "organizer");
  const slots = Math.max(MIN_SLOTS, players.length + 1);

  return (
    <div className="pointer-events-none fixed inset-0 z-30">

      <div ref={card} className="absolute top-0 left-0 drop-shadow-[0_24px_30px_rgba(40,22,16,0.45)]" style={{ visibility: "hidden" }}>
        <div className="parchment-tag relative flex h-full w-full flex-col px-[2.1em] pt-[7.2em] pb-[1.5em] text-left">
          <span className="absolute top-[2em] left-1/2 h-[1.5em] w-[1.5em] -translate-x-1/2 rounded-full bg-[#3a2a2c]/80 ring-[0.3em] ring-[#c9a46a]" aria-hidden />

          <div ref={content} className="pointer-events-auto relative flex min-h-0 flex-1 flex-col" style={{ opacity: 0 }}>
            {invite ? <NamesWritten invite={invite} /> : <NamesForm key={clock.run} onCreated={onCreated} />}
            {/* Without the 3D tree, the code lives on the card itself. */}
            {inlineQr && modules && invite && (
              <div className="mt-[0.8em] self-center rounded-[4px] bg-white p-[0.3em]">
                <QrModulesSvg modules={modules} className="h-[8em] w-[8em]" label={`QR code to join the gift for ${invite.recipientDisplayName}`} scannable />
              </div>
            )}

            <div className="my-[0.9em] h-px bg-[#c46f5a]/45" aria-hidden />

            <p className="flex items-baseline gap-[0.6em]">
              <span className="font-display text-[1.05em] font-semibold tracking-[0.06em] text-[#4e2f42]">FROM:</span>
              <span className="font-hand text-[1.3em] leading-none text-[#4e2f42]/80">{players.length ? `${players.length} ${players.length === 1 ? "friend" : "friends"} so far…` : "Waiting for players…"}</span>
            </p>
            <ul className="mt-[0.6em] flex min-h-0 flex-1 flex-col gap-[0.45em] overflow-y-auto pr-[0.2em]" aria-label="Friends who have joined">
              {Array.from({ length: slots }, (_, i) => {
                const m = players[i];
                return <Slot key={m?.id ?? `empty-${i}`} member={m} waiting={!!invite} settled={!!m && lobby.settled.has(m.id)} />;
              })}
            </ul>

            <div className="mt-[0.8em] flex flex-wrap items-center justify-center gap-[0.5em]">
              {invite && <CopyLink url={invite.inviteUrl} />}
              {invite && convex && (
                <Link href={`/room/${invite.roomId}`} className="btn-primary h-[2.3em] px-[1em] text-[0.78em]">
                  Enter the room →
                </Link>
              )}
            </div>
            <button type="button" onClick={onStartOver} className="mt-[0.4em] self-center text-[0.62em] text-[#4e2f42]/55 underline underline-offset-2 hover:text-[#4e2f42]">
              Start a new gift
            </button>
          </div>
        </div>
        {/* The coral ribbon loop, threaded through the punched hole and up out of frame. */}
        <div className="absolute left-1/2 h-[7em] w-[2.2em] -translate-x-1/2 rounded-t-[1.1em] border-[0.5em] border-b-0 border-[#d7705d] shadow-[inset_0_0_0_0.08em_rgba(255,220,200,0.35)]" style={{ top: "-4.25em" }} aria-hidden />
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {invite && convex && <LiveMembers roomId={invite.roomId} soundEnabled={soundEnabled} onStatus={setStatus} />}

    </div>
  );
}
