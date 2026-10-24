"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ClueKind, PublishedClue } from "@/lib/contracts";
import { COUNCIL_LABEL, COUNCIL_TINT } from "@/lib/council/animation";
import { LIMITS } from "@/lib/validation";
import type { RoomActions } from "./types";

/**
 * The tower's memory game, one beat at a time: a single floating question with
 * tappable seeds, then one handwritten note, then the note folds and flies to
 * the table. The 3D scene takes over from there (the note drops into its jar
 * and the friend's spirit cheers). Nothing here invents room state: the reply
 * bubble only names the jar the stored clue landed in.
 */

type Seed = { kind: ClueKind; chip: string; ask: (name: string) => string; hint: string };

const SEEDS: Seed[] = [
  { kind: "interest", chip: "Something they love doing", ask: (n) => `What does ${n} love to do?`, hint: "Weekend hikes, making pasta from scratch…" },
  { kind: "uncertain", chip: "A moment I remember", ask: (n) => `A moment with ${n} you keep thinking about?`, hint: "The snow day we hiked Mount Tam…" },
  { kind: "explicit_wish", chip: "Something they've wished for", ask: (n) => `Has ${n} wished for anything out loud?`, hint: "Said she'd love to try pottery…" },
  { kind: "ownership", chip: "Something they already have", ask: (n) => `What does ${n} already have plenty of?`, hint: "Already owns a starter kit…" },
  { kind: "exclusion", chip: "Something to avoid", ask: () => "Anything we should steer clear of?", hint: "No more candles, please…" },
];

/** Which jar a kind lands in; mirrors the tower's jar mapping. */
const JAR_NAME = (kind: ClueKind) => (kind === "explicit_wish" ? "Wishes" : kind === "interest" ? "Loves" : "Moments");
/** The agent who receives each kind of note first. */
const RECEIVER = (kind: ClueKind) => (kind === "explicit_wish" ? "muse" : kind === "interest" ? "scout" : "archivist") as keyof typeof COUNCIL_LABEL;

type Beat = { step: "ask" } | { step: "write"; seed: Seed } | { step: "flying"; seed: Seed; text: string } | { step: "landed"; seed: Seed };

export function MemoryQuest({ recipientName, clues, addMemory, onOpenBackstage }: {
  recipientName: string;
  clues: PublishedClue[];
  addMemory: RoomActions["addManualClue"];
  onOpenBackstage: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const [beat, setBeat] = useState<Beat>({ step: "ask" });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const textId = useId();
  const area = useRef<HTMLTextAreaElement>(null);

  // Lead with the kind the room knows least about, so the game nudges toward a balanced picture.
  const lead = useMemo(() => {
    const counts = new Map<ClueKind, number>();
    for (const c of clues) if (c.status === "active") counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    return [...SEEDS].sort((a, b) => (counts.get(a.kind) ?? 0) - (counts.get(b.kind) ?? 0))[0]!;
  }, [clues]);

  useEffect(() => {
    if (beat.step === "landed") {
      const t = setTimeout(() => setBeat({ step: "ask" }), reduced ? 1800 : 3200);
      return () => clearTimeout(t);
    }
  }, [beat, reduced]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (beat.step !== "write" || saving) return;
    const trimmed = text.trim();
    if (!trimmed) return setError(`Write a few words about ${recipientName} first.`);
    if (trimmed.length > LIMITS.clueTextMaxChars) return setError(`Keep it under ${LIMITS.clueTextMaxChars} characters.`);
    setSaving(true);
    setError(null);
    // The fold starts as the request goes out; if it fails, the note unfolds with the reason.
    setBeat({ step: "flying", seed: beat.seed, text: trimmed });
    const res = await addMemory(beat.seed.kind, trimmed).catch((err: unknown) => ({ ok: false as const, error: { message: err instanceof Error ? err.message : "Couldn't send that note." } }));
    setSaving(false);
    if (!res.ok) {
      setError("error" in res && res.error ? res.error.message : "Couldn't send that note.");
      setBeat({ step: "write", seed: beat.seed });
      return;
    }
    setText("");
    setBeat({ step: "landed", seed: beat.seed });
  }

  if (collapsed) {
    return (
      <button className="pointer-events-auto absolute top-24 left-1/2 -translate-x-1/2 rounded-full paper-card px-4 py-2 text-[14px] shadow-sm" onClick={() => setCollapsed(false)}>
        Add a memory of {recipientName}
      </button>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center px-4" aria-live="polite">
      <AnimatePresence mode="wait">
        {beat.step === "ask" && (
          <motion.div key="ask" className="pointer-events-auto flex max-w-[680px] flex-col items-center gap-4"
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
            <h2 className="text-center font-display text-[clamp(26px,3.4vw,40px)] leading-tight text-paper [text-shadow:0_2px_18px_rgba(40,24,40,0.55)]">
              {lead.ask(recipientName)}
            </h2>
            <div className="flex flex-wrap justify-center gap-2.5">
              {[lead, ...SEEDS.filter((s) => s.kind !== lead.kind)].map((s, i) => (
                <motion.button key={s.kind} type="button" onClick={() => { setError(null); setBeat({ step: "write", seed: s }); }}
                  className={`rounded-[16px_16px_16px_5px] px-4 py-2.5 text-[14px] font-semibold shadow-[0_10px_22px_-10px_rgba(40,24,40,0.6)] transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-gold ${i === 0 ? "bg-gold text-dusk" : "bg-paper/95 text-dusk"}`}
                  animate={reduced ? undefined : { y: [0, -5, 0], rotate: [0, i % 2 ? 1.2 : -1.2, 0] }}
                  transition={reduced ? undefined : { duration: 3.2 + i * 0.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}>
                  {s.chip}
                </motion.button>
              ))}
            </div>
            <div className="flex gap-4 text-[12.5px] text-paper/85 [text-shadow:0_1px_8px_rgba(40,24,40,0.6)]">
              <button className="underline-offset-4 hover:underline" onClick={onOpenBackstage}>Paste a conversation or add a photo</button>
              <button className="underline-offset-4 hover:underline" onClick={() => setCollapsed(true)}>Hide</button>
            </div>
          </motion.div>
        )}

        {(beat.step === "write" || beat.step === "flying") && (
          <motion.form key="note" onSubmit={send} className="pointer-events-auto w-[min(420px,calc(100vw-32px))]"
            initial={{ opacity: 0, y: 30, rotate: -6, scale: 0.92 }}
            animate={beat.step === "flying" && !reduced
              ? { opacity: [1, 1, 0], y: [0, -20, 260], rotate: [-2, 40, 200], scale: [1, 0.35, 0.08], borderRadius: ["6px", "40%", "50%"] }
              : { opacity: 1, y: 0, rotate: -2, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={beat.step === "flying" ? { duration: 1.4, times: [0, 0.45, 1], ease: "easeIn" } : { type: "spring", stiffness: 260, damping: 22 }}>
            <div className="rounded-[6px] bg-[#fff7e6] px-5 pt-4 pb-3 text-[#3b2d2a] shadow-[0_24px_48px_-20px_rgba(40,24,40,0.7)]">
              <label htmlFor={textId} className="text-[11px] font-bold tracking-[0.14em] text-[#8a7a68] uppercase">{beat.seed.chip}</label>
              <textarea id={textId} ref={area} autoFocus value={text} rows={2} maxLength={LIMITS.clueTextMaxChars + 20}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                placeholder={beat.seed.hint} disabled={beat.step === "flying"}
                className="mt-1 w-full resize-none !rounded-none !border-0 !bg-transparent font-hand text-[28px] leading-[1.1] outline-none placeholder:text-[#3b2d2a]/35" />
              <div className="mt-1 flex items-center justify-between gap-3">
                <button type="button" className="text-[13px] text-[#8a7a68] hover:text-[#3b2d2a]" onClick={() => { setError(null); setBeat({ step: "ask" }); }}>Back</button>
                <span className="text-[11.5px] text-[#8a7a68]">Everyone in the room will see this</span>
                <button type="submit" disabled={saving || !text.trim()} className="rounded-full bg-coral px-4 py-2 text-[14px] font-semibold text-white shadow disabled:opacity-50">
                  {saving ? "Sending…" : "Send it up"}
                </button>
              </div>
              {error && <p role="alert" className="mt-2 text-[13px] text-[#8c3b2c]">{error}</p>}
            </div>
          </motion.form>
        )}

        {beat.step === "landed" && (
          <motion.div key="landed" className="pointer-events-auto rounded-2xl bg-[#fff7e6] px-4 py-2.5 text-[15px] text-dusk shadow-[0_14px_30px_-14px_rgba(40,24,40,0.6)]"
            initial={{ opacity: 0, scale: 0.7, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ type: "spring", stiffness: 320, damping: 18 }}>
            <strong style={{ color: COUNCIL_TINT[RECEIVER(beat.seed.kind)] }}>{COUNCIL_LABEL[RECEIVER(beat.seed.kind)]}:</strong>{" "}
            Got it. That one goes in the {JAR_NAME(beat.seed.kind)} jar.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
