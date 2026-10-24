"use client";

import { useAction } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type FormEvent, useCallback, useId, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ClueKind, PublishedClue } from "@/lib/contracts";
import { COUNCIL_LABEL, COUNCIL_TINT } from "@/lib/council/animation";
import type { Idea } from "@/lib/ideas/presets";
import { LIMITS } from "@/lib/validation";
import type { RoomActions } from "./types";

/**
 * The tower's memory game. One floating question, then picture cards the
 * council suggests; tapping a card is the decision. It flies to the table
 * (the 3D note drops into its jar) and the agents answer with the next cards,
 * one level more specific. Typing stays available as one card among many.
 * A memory is published only by the friend's tap, never by an agent.
 */

type Category = { kind: ClueKind; chip: string; emoji: string; ask: (name: string) => string; hint: string };

const CATEGORIES: Category[] = [
  { kind: "interest", chip: "Things they love", emoji: "💛", ask: (n) => `What does ${n} love to do?`, hint: "Weekend hikes, pasta from scratch…" },
  { kind: "uncertain", chip: "A moment I remember", emoji: "📸", ask: (n) => `A moment with ${n} you keep thinking about?`, hint: "The snow day we hiked Mount Tam…" },
  { kind: "explicit_wish", chip: "Something they've wished for", emoji: "🌠", ask: (n) => `Has ${n} wished for anything out loud?`, hint: "Said they'd love to try pottery…" },
  { kind: "ownership", chip: "They already have", emoji: "🧺", ask: (n) => `What does ${n} already have plenty of?`, hint: "Already owns a starter kit…" },
  { kind: "exclusion", chip: "Things to avoid", emoji: "🚫", ask: () => "Anything we should steer clear of?", hint: "No more candles, please…" },
];

/** Which jar a kind lands in; mirrors the tower's jar mapping. */
const JAR_NAME = (kind: ClueKind) => (kind === "explicit_wish" ? "Wishes" : kind === "interest" ? "Loves" : "Moments");
/** The agent who answers for each kind of memory. */
const AGENT = (kind: ClueKind) => (kind === "explicit_wish" ? "muse" : kind === "interest" ? "scout" : kind === "exclusion" || kind === "ownership" ? "keeper" : "archivist") as keyof typeof COUNCIL_LABEL;

type Board = { prompt: string; options: Idea[]; source: "agent" | "preset" };
type Beat =
  | { step: "ask" }
  | { step: "board"; cat: Category; picked: Idea[]; board: Board | null; error?: string }
  | { step: "write"; cat: Category; picked: Idea[] };

export function MemoryQuest({ roomId, recipientName, clues, addMemory, onOpenBackstage, variant = "stage" }: {
  roomId: Id<"rooms">;
  recipientName: string;
  clues: PublishedClue[];
  addMemory: RoomActions["addManualClue"];
  onOpenBackstage?: () => void;
  /** stage: floats over the 3D tower. phone: sits in the phone controller's page. */
  variant?: "stage" | "phone";
}) {
  const phone = variant === "phone";
  const reduced = useReducedMotion() ?? false;
  const suggest = useAction(api.agents.ideas.suggestIdeas);
  const [beat, setBeat] = useState<Beat>({ step: "ask" });
  const [flying, setFlying] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; agent: keyof typeof COUNCIL_LABEL; text: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const request = useRef(0);

  // Lead with the kind the room knows least about, so the game nudges toward a balanced picture.
  const ordered = useMemo(() => {
    const counts = new Map<ClueKind, number>();
    for (const c of clues) if (c.status === "active") counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    return [...CATEGORIES].sort((a, b) => (counts.get(a.kind) ?? 0) - (counts.get(b.kind) ?? 0));
  }, [clues]);
  const lead = ordered[0]!;

  /** Ask the council for the next cards; a newer request always wins. */
  const loadBoard = useCallback(async (cat: Category, picked: Idea[]) => {
    const mine = ++request.current;
    setBeat({ step: "board", cat, picked, board: null });
    try {
      const res = await suggest({ roomId, kind: cat.kind, picked: picked.map((p) => ({ label: p.label, clue: p.clue })) });
      if (mine !== request.current) return;
      if (!res.ok) return setBeat({ step: "board", cat, picked, board: null, error: res.error.message });
      setBeat({ step: "board", cat, picked, board: res.value });
    } catch {
      if (mine === request.current) setBeat({ step: "board", cat, picked, board: null, error: "The council couldn't answer. Try again or write your own." });
    }
  }, [roomId, suggest]);

  /** The decision: publish the memory, celebrate it, and spark the next cards from it. */
  const pick = useCallback(async (cat: Category, picked: Idea[], idea: Idea) => {
    setFlying(idea.label);
    const res = await addMemory(cat.kind, idea.clue).catch(() => ({ ok: false as const, error: { code: "unknown" as const, message: "Couldn't add that memory." } }));
    setFlying(null);
    if (!res.ok) {
      setBeat((b) => (b.step === "board" ? { ...b, error: res.error.message } : b));
      return;
    }
    const agent = AGENT(cat.kind);
    setToast({ id: Date.now(), agent, text: `${idea.label}: into the ${JAR_NAME(cat.kind)} jar.` });
    void loadBoard(cat, [...picked, idea]);
  }, [addMemory, loadBoard]);

  if (collapsed && !phone) {
    return (
      <button className="pointer-events-auto absolute top-24 left-1/2 -translate-x-1/2 rounded-full paper-card px-4 py-2 text-[14px] shadow-sm" onClick={() => setCollapsed(false)}>
        Add a memory of {recipientName}
      </button>
    );
  }

  // Over the 3D scene text is light with a soft shadow; on the phone it sits on paper.
  const shadow = phone ? "text-dusk!" : "[text-shadow:0_2px_18px_rgba(40,24,40,0.6)]";

  return (
    <div className={phone ? "relative flex w-full flex-col items-center" : "pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center px-4"} aria-live="polite">
      <AnimatePresence mode="wait">
        {beat.step === "ask" && (
          <motion.div key="ask" className="pointer-events-auto flex max-w-[720px] flex-col items-center gap-4"
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
            {!phone && <h2 className={`text-center font-display text-[clamp(26px,3.4vw,40px)] leading-tight text-paper ${shadow}`}>{lead.ask(recipientName)}</h2>}
            <div className="flex flex-wrap justify-center gap-2.5">
              {ordered.map((c, i) => (
                <Floaty key={c.kind} i={i} reduced={reduced}>
                  <button type="button" onClick={() => loadBoard(c, [])}
                    className={`flex items-center gap-2 rounded-[16px_16px_16px_5px] px-4 py-2.5 text-[14px] font-semibold shadow-[0_10px_22px_-10px_rgba(40,24,40,0.6)] transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-gold ${i === 0 ? "bg-gold text-dusk" : "bg-paper/95 text-dusk"}`}>
                    <span className="text-[18px]" aria-hidden>{c.emoji}</span>{c.chip}
                  </button>
                </Floaty>
              ))}
            </div>
            {!phone && (
              <div className={`flex gap-4 text-[12.5px] text-paper/85 ${shadow}`}>
                {onOpenBackstage && <button className="underline-offset-4 hover:underline" onClick={onOpenBackstage}>Paste a conversation or add a photo</button>}
                <button className="underline-offset-4 hover:underline" onClick={() => setCollapsed(true)}>Hide</button>
              </div>
            )}
          </motion.div>
        )}

        {beat.step === "board" && (
          <motion.div key={`board-${beat.cat.kind}`} className="pointer-events-auto flex w-[min(760px,calc(100vw-32px))] flex-col items-center gap-3"
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <AgentLine agent={AGENT(beat.cat.kind)} text={beat.board?.prompt ?? (beat.picked.length ? `Thinking about “${beat.picked.at(-1)!.label}”…` : "Pulling a few ideas…")} thinking={!beat.board && !beat.error} />
            {beat.picked.length > 0 && (
              <p className="rounded-full bg-paper/85 px-3 py-1 text-[12.5px] text-dusk/80">In the jars: {beat.picked.map((p) => p.label).join(" · ")}</p>
            )}
            <div className={`grid w-full gap-3 ${phone ? "grid-cols-3" : "grid-cols-3 sm:grid-cols-4"}`}>
              {beat.board
                ? beat.board.options.map((idea, i) => (
                    <IdeaCard key={`${beat.picked.length}-${idea.label}`} idea={idea} i={i} reduced={reduced} busy={flying !== null} flying={flying === idea.label}
                      onPick={() => pick(beat.cat, beat.picked, idea)} />
                  ))
                : !beat.error && Array.from({ length: 6 }, (_, i) => <div key={i} className={`h-[118px] animate-pulse rounded-[18px] ${phone ? "bg-dusk/10" : "bg-paper/35"}`} />)}
              <motion.button type="button" onClick={() => setBeat({ step: "write", cat: beat.cat, picked: beat.picked })}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
                className={`flex h-[118px] flex-col items-center justify-center gap-1 rounded-[18px] border-2 border-dashed ${phone ? "border-dusk/25 bg-white/50 text-dusk" : "border-paper/70 bg-paper/20 text-paper backdrop-blur-sm hover:bg-paper/30"}`}>
                <span className="text-[30px]" aria-hidden>✏️</span>
                <span className="text-[13.5px] font-semibold">Something else</span>
              </motion.button>
            </div>
            {beat.error && (
              <p role="alert" className="rounded-xl bg-paper/95 px-3 py-2 text-[13px] text-[#8c3b2c]">
                {beat.error} <button className="ml-2 underline" onClick={() => loadBoard(beat.cat, beat.picked)}>Try again</button>
              </p>
            )}
            <div className={`flex gap-4 text-[13px] ${phone ? "text-dusk/70" : `text-paper ${shadow}`}`}>
              <button className="underline-offset-4 hover:underline" onClick={() => { request.current++; setBeat({ step: "ask" }); }}>← Other kinds of memories</button>
              {beat.picked.length > 0 && <button className="font-semibold underline-offset-4 hover:underline" onClick={() => { request.current++; setBeat({ step: "ask" }); }}>That’s all for now</button>}
            </div>
          </motion.div>
        )}

        {beat.step === "write" && (
          <NoteCard key="note" cat={beat.cat} reduced={reduced}
            onBack={() => loadBoard(beat.cat, beat.picked)}
            onSend={async (text) => {
              const idea = { label: text.length > 28 ? `${text.slice(0, 27)}…` : text, emoji: "✏️", clue: text };
              const res = await addMemory(beat.cat.kind, text);
              if (!res.ok) return res.error.message;
              setToast({ id: Date.now(), agent: AGENT(beat.cat.kind), text: `Into the ${JAR_NAME(beat.cat.kind)} jar.` });
              void loadBoard(beat.cat, [...beat.picked, idea]);
              return null;
            }} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} className={`pointer-events-none ${phone ? "mt-3" : "absolute top-[min(62vh,520px)]"} rounded-2xl bg-[#fff7e6] px-4 py-2.5 text-[14.5px] text-dusk shadow-[0_14px_30px_-14px_rgba(40,24,40,0.6)]`}
            initial={{ opacity: 0, scale: 0.7, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ type: "spring", stiffness: 320, damping: 18 }}
            onAnimationComplete={() => setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), 1800)}>
            <strong style={{ color: COUNCIL_TINT[toast.agent] }}>{COUNCIL_LABEL[toast.agent]}:</strong> {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Floaty({ i, reduced, children }: { i: number; reduced: boolean; children: React.ReactNode }) {
  return (
    <motion.div animate={reduced ? undefined : { y: [0, -5, 0], rotate: [0, i % 2 ? 1.2 : -1.2, 0] }}
      transition={reduced ? undefined : { duration: 3.2 + i * 0.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}>
      {children}
    </motion.div>
  );
}

function AgentLine({ agent, text, thinking }: { agent: keyof typeof COUNCIL_LABEL; text: string; thinking: boolean }) {
  return (
    <motion.div key={text} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className="flex items-center gap-2 rounded-full bg-[#fff7e6] py-2 pr-4 pl-2 text-[15px] text-dusk shadow-[0_12px_26px_-14px_rgba(40,24,40,0.7)]">
      <span className="grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold text-white" style={{ background: COUNCIL_TINT[agent] }}>{COUNCIL_LABEL[agent][0]}</span>
      <span><strong style={{ color: COUNCIL_TINT[agent] }}>{COUNCIL_LABEL[agent]}</strong> · {text}</span>
      {thinking && <span className="ml-1 flex gap-0.5" aria-hidden>{[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-dusk/50" style={{ animationDelay: `${d * 0.15}s` }} />)}</span>}
    </motion.div>
  );
}

function IdeaCard({ idea, i, reduced, busy, flying, onPick }: { idea: Idea; i: number; reduced: boolean; busy: boolean; flying: boolean; onPick: () => void }) {
  return (
    <motion.button type="button" disabled={busy} onClick={onPick} aria-label={`${idea.label}: ${idea.clue}`} title={idea.clue}
      initial={{ opacity: 0, y: 24, rotate: i % 2 ? 3 : -3, scale: 0.9 }}
      animate={flying && !reduced
        ? { opacity: [1, 1, 0], y: [0, -14, 320], scale: [1, 1.1, 0.2], rotate: [0, -8, 25] }
        : { opacity: busy ? 0.6 : 1, y: 0, rotate: 0, scale: 1 }}
      transition={flying ? { duration: 0.9, times: [0, 0.3, 1], ease: "easeIn" } : { delay: i * 0.06, type: "spring", stiffness: 260, damping: 20 }}
      whileHover={busy ? undefined : { y: -4, rotate: i % 2 ? 1.5 : -1.5 }}
      className="flex h-[118px] flex-col items-center justify-center gap-1.5 rounded-[18px] bg-paper/95 px-2 text-dusk shadow-[0_14px_28px_-14px_rgba(40,24,40,0.7)] focus-visible:outline-2 focus-visible:outline-gold">
      <span className="text-[40px] leading-none drop-shadow-sm" aria-hidden>{idea.emoji}</span>
      <span className="text-center text-[13.5px] leading-tight font-semibold">{idea.label}</span>
    </motion.button>
  );
}

function NoteCard({ cat, reduced, onBack, onSend }: { cat: Category; reduced: boolean; onBack: () => void; onSend: (text: string) => Promise<string | null> }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [gone, setGone] = useState(false);
  const id = useId();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (trimmed.length > LIMITS.clueTextMaxChars) return setError(`Keep it under ${LIMITS.clueTextMaxChars} characters.`);
    setSending(true);
    setError(null);
    setGone(true);
    const problem = await onSend(trimmed);
    setSending(false);
    if (problem) {
      setGone(false);
      setError(problem);
    }
  }
  return (
    <motion.form onSubmit={submit} className="pointer-events-auto w-[min(420px,calc(100vw-32px))]"
      initial={{ opacity: 0, y: 30, rotate: -6, scale: 0.92 }}
      animate={gone && !reduced ? { opacity: [1, 1, 0], y: [0, -20, 260], rotate: [-2, 40, 200], scale: [1, 0.35, 0.08] } : { opacity: 1, y: 0, rotate: -2, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={gone ? { duration: 1.2, times: [0, 0.45, 1], ease: "easeIn" } : { type: "spring", stiffness: 260, damping: 22 }}>
      <div className="rounded-[6px] bg-[#fff7e6] px-5 pt-4 pb-3 text-[#3b2d2a] shadow-[0_24px_48px_-20px_rgba(40,24,40,0.7)]">
        <label htmlFor={id} className="text-[11px] font-bold tracking-[0.14em] text-[#8a7a68] uppercase">{cat.chip}</label>
        <textarea id={id} autoFocus value={text} rows={2} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
          placeholder={cat.hint} disabled={sending}
          className="mt-1 w-full resize-none rounded-none! border-0! bg-transparent! font-hand text-[28px] leading-[1.1] outline-none placeholder:text-[#3b2d2a]/35" />
        <div className="mt-1 flex items-center justify-between gap-3">
          <button type="button" className="text-[13px] text-[#8a7a68] hover:text-[#3b2d2a]" onClick={onBack}>Back to ideas</button>
          <span className="text-[11.5px] text-[#8a7a68]">Everyone in the room will see this</span>
          <button type="submit" disabled={sending || !text.trim()} className="rounded-full bg-coral px-4 py-2 text-[14px] font-semibold text-white shadow disabled:opacity-50">
            {sending ? "Sending…" : "Send it up"}
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-[13px] text-[#8c3b2c]">{error}</p>}
      </div>
    </motion.form>
  );
}
