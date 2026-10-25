"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MapIcon } from "@/components/world/room/MapIcon";
import { playBookOpen, playTick } from "@/components/world/sfx";
import type { GiftStory } from "@/convex/story";
import s from "./story-book.module.css";

/**
 * The gift story as a timelapse book (D26): the memories friends shared, the
 * words that kept coming up, their photos, what the council did, then the gift.
 * Pages turn on their own; anyone can pause or flip. Reduced motion fades and
 * shows final numbers. Everything comes from story.summary or story.byToken.
 */

type PageKind = "cover" | "memories" | "words" | "photos" | "council" | "gift";
const PAGE_MS: Record<PageKind, number> = { cover: 3800, memories: 6500, words: 5200, photos: 5200, council: 6500, gift: 9000 };
const WORD_INK = ["var(--color-plum)", "var(--color-dusk)", "var(--color-coral)", "#ad8050", "var(--color-plum-soft)"];

const list = (names: readonly string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function storyPages(story: GiftStory): PageKind[] {
  return (["cover", "memories", "words", "photos", "council", "gift"] as const).filter((p) =>
    p === "memories" ? story.memories.length > 0
      : p === "words" ? story.words.length >= 3
        : p === "photos" ? story.photos.length > 0
          : p === "gift" ? story.gifts.length > 0 : true);
}

function useCountUp(target: number, run: boolean, reduced: boolean) {
  const [n, setN] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced || !run) { setN(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400);
      setN(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    setN(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, reduced]);
  return n;
}

function Stat({ value, label, delay, reduced, out }: { value: number; label: string; delay: number; reduced: boolean; out?: boolean }) {
  const [go, setGo] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const id = window.setTimeout(() => setGo(true), delay * 1000);
    return () => window.clearTimeout(id);
  }, [delay, reduced]);
  const n = useCountUp(value, go, reduced);
  return (
    <motion.div className={`${s.stat} ${out ? s.out : ""}`} initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.45 }}>
      <strong>{n}</strong><span>{label}</span>
    </motion.div>
  );
}

function Page({ kind, story, audience, reduced }: { kind: PageKind; story: GiftStory; audience: "room" | "recipient"; reduced: boolean }) {
  const stagger = (i: number, step = 0.32) => (reduced ? 0 : 0.35 + i * step);
  const her = story.recipientName;
  const fromUs = audience === "room" ? "we" : "your friends";
  switch (kind) {
    case "cover":
      return (
        <>
          <motion.div className={s.ribbon} initial={reduced ? false : { scale: 0.4, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 14 }}>
            <MapIcon name="present" size={34} />
          </motion.div>
          <p className={s.kicker}>{story.occasion}</p>
          <h2 className={s.title}>How {fromUs} chose {audience === "room" ? `${her}’s` : "your"} gift</h2>
          <p className={s.names}>with love from {list(story.friends)}</p>
        </>
      );
    case "memories": {
      const shown = story.memories.slice(0, 8);
      return (
        <>
          <p className={s.kicker}>What friends remembered</p>
          <h2 className={s.title}>{story.memories.length} little things about {audience === "room" ? her : "you"}</h2>
          <div className={s.notes}>
            {shown.map((m, i) => (
              <motion.p key={m} className={s.note} style={{ rotate: `${((i * 37) % 5) - 2}deg` }}
                initial={reduced ? false : { opacity: 0, y: 18, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: stagger(i, 0.45), duration: 0.5 }}>
                {m}
              </motion.p>
            ))}
          </div>
          {story.memories.length > shown.length && <p className={s.more}>…and {story.memories.length - shown.length} more.</p>}
        </>
      );
    }
    case "words": {
      const max = story.words[0]?.count ?? 1;
      // Biggest word in the middle, the rest alternating around it.
      const ordered = story.words.reduce<typeof story.words>((acc, w, i) => (i % 2 ? [...acc, w] : [w, ...acc]), []);
      return (
        <>
          <p className={s.kicker}>Words that kept coming up</p>
          <div className={s.cloud}>
            {ordered.map((w) => {
              const rank = story.words.indexOf(w);
              return (
                <motion.span key={w.word} className={s.word} style={{ fontSize: `${18 + 30 * (w.count / max)}px`, color: WORD_INK[rank % WORD_INK.length] }}
                  initial={reduced ? false : { opacity: 0, scale: 0.4, filter: "blur(6px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  transition={{ delay: stagger(rank, 0.16), type: "spring", stiffness: 160, damping: 16 }}>
                  {w.word}
                </motion.span>
              );
            })}
          </div>
        </>
      );
    }
    case "photos":
      return (
        <>
          <p className={s.kicker}>The pictures friends added</p>
          <div className={s.photos}>
            {story.photos.slice(0, 9).map((url, i) => (
              <motion.figure key={url} className={s.polaroid} style={{ rotate: `${((i * 53) % 13) - 6}deg` }}
                initial={reduced ? false : { opacity: 0, y: -60, scale: 1.15 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: stagger(i, 0.38), type: "spring", stiffness: 140, damping: 15 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URLs, not optimizable by next/image */}
                <img src={url} alt="" loading="lazy" />
              </motion.figure>
            ))}
          </div>
        </>
      );
    case "council": {
      const st = story.stats;
      const items: { value: number; label: string; out?: boolean }[] = [
        { value: st.memories, label: "memories read" },
        ...(st.themes ? [{ value: st.themes, label: "themes found" }] : []),
        ...(st.directions ? [{ value: st.directions, label: "gift directions" }] : []),
        ...(st.thrownOut ? [{ value: st.thrownOut, label: "ideas thrown out", out: true }] : []),
        ...(st.searches ? [{ value: st.searches, label: "searches" }] : []),
        ...(st.products ? [{ value: st.products, label: "real products checked" }] : []),
        ...(st.votes ? [{ value: st.votes, label: "votes from friends" }] : []),
      ];
      return (
        <>
          <p className={s.kicker}>Then the council got to work</p>
          <h2 className={s.title}>Every idea had to earn its place</h2>
          <div className={s.stats}>
            {items.map((it, i) => <Stat key={it.label} {...it} delay={stagger(i, 0.4)} reduced={reduced} />)}
          </div>
          {story.directions.length > 0 && (
            <div className={s.chips} aria-label="Directions the council kept">
              {story.directions.map((d) => <span key={d.label} className={s.chip} title={d.why}>{d.label}</span>)}
            </div>
          )}
        </>
      );
    }
    case "gift": {
      const gift = story.gifts[0]!;
      return (
        <>
          <p className={s.kicker}>{story.gifts.length > 1 ? `And so, ${story.gifts.length} gifts` : "And so, the gift"}</p>
          <div className={s.gift}>
            {gift.imageUrl && (
              <motion.div className={s.giftPhoto} initial={reduced ? false : { opacity: 0, scale: 0.7, rotate: -6 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 120, damping: 12, delay: stagger(0) }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- remote shop images */}
                <img src={gift.imageUrl} alt={gift.title} />
              </motion.div>
            )}
            <motion.div style={{ flex: "1 1 220px" }} initial={reduced ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: stagger(2) }}>
              <h2 className={s.title}>{story.gifts.map((g) => g.title).join(" + ")}</h2>
              <p className={s.names}>chosen together by {list(story.friends)}</p>
            </motion.div>
          </div>
        </>
      );
    }
  }
}

export function GiftStoryBook({ story, audience, onClose, inline = false }: { story: GiftStory; audience: "room" | "recipient"; onClose?(): void; inline?: boolean }) {
  const reduced = useReducedMotion() ?? false;
  const pages = useMemo(() => storyPages(story), [story]);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [dir, setDir] = useState(1);
  const kind = pages[Math.min(at, pages.length - 1)]!;
  const last = at >= pages.length - 1;

  const go = useCallback((to: number) => {
    const next = Math.max(0, Math.min(pages.length - 1, to));
    setDir(next >= at ? 1 : -1);
    if (next !== at) playTick(next > at);
    setAt(next);
  }, [at, pages.length]);

  useEffect(() => { playBookOpen(); }, []);
  useEffect(() => {
    if (!playing || last) return;
    const id = window.setTimeout(() => go(at + 1), PAGE_MS[kind]);
    return () => window.clearTimeout(id);
  }, [playing, last, at, kind, go]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowRight") { setPlaying(false); go(at + 1); }
      else if (e.key === "ArrowLeft") { setPlaying(false); go(at - 1); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [at, go, onClose]);

  const book = (
    <div className={s.stage} onClick={(e) => e.stopPropagation()}>
      <div className={s.book}>
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.section key={kind} className={`${s.page} ${kind === "cover" ? s.cover : ""}`} aria-live="polite" custom={dir}
            initial={reduced ? { opacity: 0 } : { rotateY: dir > 0 ? 70 : -70, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { rotateY: dir > 0 ? -95 : 95, opacity: 0, transition: { duration: 0.5, ease: [0.55, 0, 0.75, 0.3] } }}
            transition={{ duration: reduced ? 0.2 : 0.7, ease: [0.22, 1, 0.36, 1] }}>
            <Page kind={kind} story={story} audience={audience} reduced={reduced} />
          </motion.section>
        </AnimatePresence>
        <div className={s.controls}>
          <button type="button" className={s.ctrl} data-sfx="silent" onClick={() => { setPlaying(false); go(at - 1); }} disabled={at === 0} aria-label="Previous page">‹</button>
          <div className={s.dots} role="tablist" aria-label="Pages">
            {pages.map((p, i) => (
              <button key={p} type="button" role="tab" aria-selected={i === at} aria-label={`Page ${i + 1}`} className={s.dot} data-sfx="silent" onClick={() => { setPlaying(false); go(i); }}>
                {i === at && playing && !last && !reduced
                  ? <motion.i key={`run-${at}`} initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: PAGE_MS[p] / 1000, ease: "linear" }} />
                  : <i style={{ width: i <= at ? "100%" : "0%" }} />}
              </button>
            ))}
          </div>
          {last
            ? <button type="button" className={s.ctrl} data-sfx="silent" onClick={() => { setPlaying(true); go(0); }}>Play again</button>
            : <button type="button" className={s.ctrl} data-sfx="silent" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>}
          {!last && <button type="button" className={s.ctrl} data-sfx="silent" onClick={() => { setPlaying(false); go(at + 1); }} aria-label="Next page">›</button>}
          {onClose && <button type="button" className={s.ctrl} data-sfx="silent" onClick={onClose} aria-label="Close the story"><MapIcon name="drift" size={14} /></button>}
        </div>
      </div>
    </div>
  );
  if (inline) return book;
  return (
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-label="Our gift story" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      {book}
    </div>
  );
}
