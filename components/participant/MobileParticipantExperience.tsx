"use client";

import { useConvexConnectionState } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { RoomCouncilPanel } from "@/components/council/RoomCouncilPanel";
import { ProductCard } from "@/components/products/ProductCard";
import { ProposalPanel } from "@/components/proposal/ProposalPanel";
import { RoomAgentTools } from "@/components/room/RoomAgentTools";
import { ShareMemory } from "@/components/room/ShareMemory";
import type { RoomActions, RoomData } from "@/components/room/types";
import type { Id } from "@/convex/_generated/dataModel";
import type { PublishedClue } from "@/lib/contracts";
import { AVATAR_LABEL, avatarFor, portraitUrl } from "@/lib/room/avatars";
import { PHASE_LABEL, type RoomPhase, roomPhase } from "@/lib/room/phase";
import { useResultAction } from "@/lib/useResultAction";

/**
 * The participant's phone: a personal controller for the shared room on the
 * big screen. No WebGL here — small storybook touches instead — and one
 * primary action per screen. The screen follows the room's real phase (see
 * lib/room/phase.ts); "add another memory" is always one tap away.
 */

type Screen = RoomPhase | "memories";

const JAR_OF: Record<string, string> = {
  explicit_wish: "Wishes jar",
  interest: "Loves jar",
};
const jarLabel = (kind: string) => JAR_OF[kind] ?? "Moments jar";
const spring = { type: "spring", stiffness: 420, damping: 30 } as const;
const swap = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
} as const;

export function MobileParticipantExperience({ data, actions }: { data: RoomData; actions: RoomActions }) {
  const { room, participants, me } = data.view;
  const connection = useConvexConnectionState();
  const isOrganizer = me.role === "organizer";
  const phase = roomPhase({
    councilStatus: data.council?.run?.status ?? null,
    recommendationCount: data.recommendations.length,
    proposalStatus: data.proposal.revision?.status ?? null,
  });
  // Follow the room's phase as it changes, but let a friend step back to add memories.
  const [screen, setScreen] = useState<Screen>(phase);
  useEffect(() => setScreen(phase), [phase]);

  const avatar = avatarFor(participants, me.id);
  const mine = useMemo(() => data.publishedClues.filter((c) => c.publisherId === me.id && c.status === "active").sort((a, b) => b.publishedAt - a.publishedAt), [data.publishedClues, me.id]);
  const allActive = data.publishedClues.filter((c) => c.status === "active").length;

  return (
    <main className="relative min-h-dvh bg-paper text-dusk">
      <div className="paper-grain pointer-events-none fixed inset-0" aria-hidden />
      <div className="relative mx-auto flex min-h-dvh max-w-[480px] flex-col px-4 pt-[max(14px,env(safe-area-inset-top))] pb-[max(20px,env(safe-area-inset-bottom))]">
        <header className="flex items-center gap-3">
          <img src={portraitUrl(avatar)} alt={`Your spirit: ${AVATAR_LABEL[avatar]}`} width={52} height={52} className="h-[52px] w-[52px] shrink-0 rounded-full border-2 border-paper object-cover object-top shadow-[0_6px_16px_-8px_rgba(65,52,76,0.6)] ring-1 ring-dusk/10" />
          <div className="min-w-0 flex-1">
            <p className="font-hand text-[19px] leading-none text-dusk/60">hi, {me.displayName}</p>
            <h1 className="font-display truncate text-[24px] leading-tight">{room.recipientDisplayName}&rsquo;s gift</h1>
            <p className="truncate text-[12.5px] text-dusk/60">{room.occasion} · {participants.length} {participants.length === 1 ? "friend" : "friends"}</p>
          </div>
          <span className="sr-only">Room phase: {PHASE_LABEL[phase]}</span>
        </header>

        {!connection.isWebSocketConnected && (
          <p role="status" className="mt-3 rounded-xl bg-gold/25 px-3 py-2 text-[13px] text-dusk/80">
            Reconnecting… a note is only saved once you see “Dropped into the jar”.
          </p>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.section key={screen} {...swap} className="mt-5 flex flex-1 flex-col gap-4" aria-live="polite">
            {screen === "memories" || screen === "collect" ? (
              <CollectScreen data={data} actions={actions} mine={mine} allActive={allActive} isOrganizer={isOrganizer} onBack={phase !== "collect" ? () => setScreen(phase) : undefined} phase={phase} />
            ) : screen === "researching" ? (
              <WaitScreen data={data} actions={actions} mine={mine} onAddMore={() => setScreen("memories")} />
            ) : screen === "review" ? (
              <ReviewScreen data={data} actions={actions} isOrganizer={isOrganizer} onAddMore={() => setScreen("memories")} />
            ) : screen === "approve" ? (
              <ProposalPanel proposal={data.proposal} participants={participants} me={me} selection={data.selection} isOrganizer={isOrganizer} actions={actions} />
            ) : (
              <DoneScreen recipient={room.recipientDisplayName} title={data.selection?.listingSnapshot.title} />
            )}
          </motion.section>
        </AnimatePresence>

        <details className="paper-card mt-5 rounded-[22px] p-4">
          <summary className="cursor-pointer font-display text-xl">Clue review and room chat</summary>
          <div className="mt-4 flex flex-col gap-4"><RoomAgentTools data={data} actions={actions} /></div>
        </details>
        <p className="mt-6 text-center text-[12px] text-dusk/45">Shared memories appear on the big screen. Private imports stay yours until you publish their clues.</p>
      </div>
    </main>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`paper-card rounded-[22px] p-4 ${className}`}>{children}</div>;
}

function MyNotes({ mine }: { mine: PublishedClue[] }) {
  if (!mine.length) return null;
  return (
    <Card>
      <h2 className="font-display text-[21px] leading-tight">Your notes · {mine.length}</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {mine.slice(0, 8).map((c) => (
          <li key={c.id} className="flex items-start gap-2.5 text-[14.5px] leading-snug">
            <NoteIcon />
            <span className="min-w-0 flex-1">
              {c.text}
              <span className="block text-[11.5px] font-semibold tracking-wide text-dusk/45 uppercase">{jarLabel(c.kind)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CollectScreen({ data, actions, mine, allActive, isOrganizer, onBack, phase }: {
  data: RoomData; actions: RoomActions; mine: PublishedClue[]; allActive: number; isOrganizer: boolean; onBack?: () => void; phase: RoomPhase;
}) {
  const { room } = data.view;
  return (
    <>
      {onBack && (
        <button onClick={onBack} className="self-start text-[14px] font-medium text-dusk/60 underline-offset-4 hover:underline">
          ← Back to {phase === "researching" ? "the council" : phase === "review" ? "gift ideas" : "the gift"}
        </button>
      )}
      <div>
        <p className="font-hand text-[22px] leading-tight text-dusk/60">a little magic starts with a memory</p>
        <h2 className="font-display text-[32px] leading-[1.05]">What do you remember about {room.recipientDisplayName}?</h2>
      </div>
      <ShareMemory roomId={room.id as Id<"rooms">} recipientName={room.recipientDisplayName} variant="phone" />
      <MyNotes mine={mine} />
      {isOrganizer && allActive > 0 && phase === "collect" && (
        <Card className="flex flex-col gap-3">
          <p className="text-[14px] text-dusk/70">{allActive} {allActive === 1 ? "memory is" : "memories are"} in the jars. When everyone’s ready, wake the council.</p>
          <RoomCouncilPanel data={data} actions={actions} compact />
        </Card>
      )}
      {!isOrganizer && allActive > 0 && (
        <p className="text-center text-[13px] text-dusk/55">The organizer wakes the council when everyone’s added their notes.</p>
      )}
    </>
  );
}

function WaitScreen({ data, actions, mine, onAddMore }: { data: RoomData; actions: RoomActions; mine: PublishedClue[]; onAddMore: () => void }) {
  return (
    <>
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <Lantern />
        <h2 className="font-display text-[30px] leading-tight">The council is at work</h2>
        <p className="max-w-[300px] text-[15px] text-dusk/65">Watch the big screen: they’re reading your notes and searching for real gifts.</p>
      </div>
      <RoomCouncilPanel data={data} actions={actions} compact />
      <MyNotes mine={mine} />
      <button onClick={onAddMore} className="btn-secondary h-14 text-[16px]">
        Add another memory
      </button>
    </>
  );
}

function ReviewScreen({ data, actions, isOrganizer, onAddMore }: { data: RoomData; actions: RoomActions; isOrganizer: boolean; onAddMore: () => void }) {
  const listings = new Map(data.listings.map((l) => [l.id, l]));
  const vote = useResultAction(actions.castVote);
  const clear = useResultAction(actions.clearVote);
  const choose = useResultAction(actions.selectGift);
  const recs = data.recommendations.filter((r) => listings.has(r.listingId));
  return (
    <>
      <div>
        <h2 className="font-display text-[30px] leading-tight">Gift ideas · {recs.length}</h2>
        <p className="text-[14.5px] text-dusk/65">{isOrganizer ? "Vote with everyone, then choose the one to give." : "Vote for the ones that feel right. The organizer makes the final choice."}</p>
      </div>
      {data.council?.run?.cached && <p className="text-[12.5px] text-dusk/55">Cached research · each card shows when its price was observed.</p>}
      <ul className="flex flex-col gap-3">
        {recs.map((r) => {
          const listing = listings.get(r.listingId)!;
          const v = data.votes[r.listingId];
          const chosen = data.selection?.listingId === r.listingId;
          return (
            <li key={r.id}>
              <Card className={chosen ? "ring-2 ring-gold" : ""}>
                <ProductCard listing={listing} />
                <p className="mt-2 text-[13.5px] leading-snug text-dusk/70">{r.explanation}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(["up", "down"] as const).map((value) => {
                    const on = v?.myVote === value;
                    return (
                      <motion.button
                        key={value}
                        whileTap={{ scale: 0.96 }}
                        transition={spring}
                        aria-pressed={on}
                        disabled={vote.pending || clear.pending}
                        onClick={() => (on ? clear.run(r.listingId) : vote.run(r.listingId, value))}
                        className={`min-h-12 rounded-full border text-[15px] font-semibold transition ${on ? "border-dusk bg-dusk text-paper" : "border-dusk/20 bg-paper/80"}`}
                      >
                        {value === "up" ? "Love it" : "Not quite"} · {v?.tally[value] ?? 0}
                      </motion.button>
                    );
                  })}
                </div>
                {isOrganizer && (
                  <button onClick={() => choose.run(r.listingId)} disabled={choose.pending || chosen} className="btn-primary mt-2 h-12 w-full justify-center text-[15px] disabled:opacity-60">
                    {chosen ? "Chosen ✓" : "Choose this gift"}
                  </button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      {(vote.error || clear.error || choose.error) && <p role="alert" className="text-sm text-[#8c3b2c]">{(vote.error ?? clear.error ?? choose.error)?.message}</p>}
      <button onClick={onAddMore} className="btn-secondary h-12 text-[15px]">
        Add another memory
      </button>
    </>
  );
}

function DoneScreen({ recipient, title }: { recipient: string; title?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <GiftIcon />
      <h2 className="font-display text-[34px] leading-tight">Thank you!</h2>
      <p className="max-w-[300px] text-[15.5px] text-dusk/70">
        Everyone’s approved{title ? <> <strong>{title}</strong></> : " the gift"} for {recipient}. Your memories made it personal.
      </p>
    </div>
  );
}

// Small inline storybook illustrations (no image downloads).
function NoteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden className="mt-0.5 shrink-0 text-[#c46f5a]">
      <path d="M4 6l8-3 8 3v12l-8 3-8-3z" fill="#fbf3e3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M12 3v18M4 6l8 3 8-3" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

function Lantern() {
  return (
    <motion.svg width="64" height="76" viewBox="0 0 64 76" fill="none" aria-hidden animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }} style={{ originY: 0 }}>
      <path d="M32 2v10" stroke="#4b3d4c" strokeWidth="2" />
      <path d="M20 14h24l-3 8H23z" fill="#4b3d4c" />
      <rect x="18" y="22" width="28" height="36" rx="4" fill="#ffe2a0" stroke="#4b3d4c" strokeWidth="2" />
      <motion.ellipse cx="32" cy="40" rx="7" ry="10" fill="#ffb24a" animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.6, repeat: Infinity }} />
      <path d="M16 58h32l-3 6H19z" fill="#4b3d4c" />
    </motion.svg>
  );
}

function GiftIcon() {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden>
      <rect x="14" y="34" width="56" height="40" rx="4" fill="#fbf3e3" stroke="#4a2c33" strokeWidth="2" />
      <rect x="10" y="24" width="64" height="12" rx="3" fill="#fff7ea" stroke="#4a2c33" strokeWidth="2" />
      <path d="M42 24v50" stroke="#e07a62" strokeWidth="8" />
      <path d="M42 24c-6-12-20-12-18-4s12 4 18 4zm0 0c6-12 20-12 18-4s-12 4-18 4z" fill="#e48572" stroke="#4a2c33" strokeWidth="2" />
    </svg>
  );
}
