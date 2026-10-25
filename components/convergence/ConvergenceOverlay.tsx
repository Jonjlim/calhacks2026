"use client";

import { MapIcon } from "@/components/world/room/MapIcon";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GiftSelection, ProductListing, PublishedClue, Recommendation } from "@/lib/contracts";
import { CONVERGENCE_TIMES, STATE_CAPTION } from "@/lib/convergence/timeline";
import { formatMinor } from "@/lib/money";
import { getPriceFreshness } from "@/lib/research/freshness";
import { parchmentRect } from "@/components/unwrap/parchmentLayout";
import { convergence, useConvergenceActive, useConvergenceLeaving, useConvergenceState } from "./convergenceClock";

/**
 * The DOM half of the Great Gift Convergence: it drives the clock's frame loop,
 * says what is happening in one quiet line (read out politely), offers Skip,
 * and, once the present has given way, shows the chosen gift: its photo in a
 * storybook frame over the pedestal, and a small parchment with the real title,
 * observed price, source link and the memories behind the choice.
 *
 * Everything shown comes from the room's persisted selection and its listing.
 * Nothing here is a purchase: the wording says so.
 */

export interface RevealGift {
  selection: GiftSelection;
  listing?: ProductListing;
  recommendation?: Recommendation;
  clues: PublishedClue[];
  listings?: ProductListing[];
  recommendations?: Recommendation[];
}

const isGoogle = (url: string) => {
  try {
    return /(^|\.)google\./.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

export function ConvergenceOverlay({ gift, isOrganizer, onPlan, onReplay }: { gift: RevealGift; isOrganizer: boolean; onPlan(): void; onReplay(): void }) {
  const active = useConvergenceActive();
  const state = useConvergenceState();
  const leaving = useConvergenceLeaving();
  const reduced = useReducedMotion() ?? false;
  const [size, setSize] = useState({ w: 1440, h: 900 });
  const heading = useRef<HTMLHeadingElement>(null);

  // The one frame loop for the whole sequence.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      convergence.advance((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  useEffect(() => {
    const measure = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (convergence.holding) convergence.close();
      else convergence.skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  // When the reveal settles, move focus to it so keyboard and screen-reader users land on the gift.
  useEffect(() => {
    if (state === "complete") heading.current?.focus({ preventScroll: true });
  }, [state]);

  const { selection } = gift;
  const [focus, setFocus] = useState(0);
  useEffect(() => setFocus(0), [selection.id]);
  const items = selection.items;
  const item = items?.[Math.min(focus, items.length - 1)];
  const focusedId = item?.listingId ?? selection.listingId;
  const listing = gift.listings?.find(l => l.id === focusedId) ?? (gift.listing?.id === focusedId ? gift.listing : undefined);
  const recommendation = gift.recommendations?.find(r => r.listingId === focusedId) ?? (gift.recommendation?.listingId === focusedId ? gift.recommendation : undefined);
  const snapshot = item?.listingSnapshot ?? selection.listingSnapshot;
  const photoUrl = item?.listingSnapshot.imageUrl ?? listing?.imageUrl;
  const url = snapshot.sourceUrl || listing?.sourceUrl;
  const price = snapshot.priceStatus === "observed" && snapshot.priceMinor !== undefined ? formatMinor(snapshot.priceMinor, listing?.currency ?? "USD") : null;
  const why = useMemo(() => {
    const cited = (recommendation?.publishedClueIds ?? []).map((id) => gift.clues.find((c) => c.id === id)).filter((c): c is PublishedClue => !!c && c.status === "active");
    return cited.slice(0, 4);
  }, [recommendation, gift.clues]);
  const freshness = useMemo(() => (listing ? getPriceFreshness({ ...listing, retrievedAt: snapshot.retrievedAt }, Date.now()) : null), [listing, snapshot.retrievedAt]);
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => setPhotoFailed(false), [photoUrl]);

  const revealed = active && (state === "revealing" || state === "complete") && !leaving;
  const playing = active && !leaving && state !== "complete" && state !== "revealing";
  const wide = size.w / size.h >= 1.15;
  const panel = parchmentRect(size.w, size.h);
  // The present sits in the left share of the screen (see convergencePose); the frame appears where it was.
  const cx = wide ? size.w * 0.335 : size.w / 2;
  const frameW = Math.round(Math.min(wide ? 330 : 240, Math.max(190, size.h * 0.3)));
  const cy = wide ? size.h * 0.47 : size.h * 0.3;

  const sample = listing?.source === "manual_fixture";
  const gone = listing?.status === "invalid";

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {active ? STATE_CAPTION[state] : ""}
      </p>
      <AnimatePresence>
        {playing && (
          <motion.div key="captions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }} className="pointer-events-none absolute inset-x-0 bottom-9 z-20 flex flex-col items-center gap-3">
            <p aria-hidden className="rounded-full bg-paper/70 px-5 py-1.5 font-display text-[21px] text-dusk/85 shadow-[0_8px_24px_-14px_rgba(65,52,76,0.5)] backdrop-blur-sm">
              {STATE_CAPTION[state]}
            </p>
            {convergence.total > 0 && state !== "anticipation" && state !== "burst" && (
              <p aria-hidden className="rounded-full bg-paper/60 px-3 py-0.5 text-[12px] text-dusk/65 backdrop-blur-sm">
                {convergence.total} {convergence.total === 1 ? "thing" : "things"} shared by the room
              </p>
            )}
          </motion.div>
        )}
        {playing && (
          <motion.button key="skip" type="button" initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} exit={{ opacity: 0 }} whileHover={{ opacity: 1 }} transition={{ delay: 0.6 }} onClick={() => convergence.skip()} className="pointer-events-auto absolute right-6 bottom-6 z-30 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-dusk/60 hover:bg-paper/70 hover:text-dusk">
            Skip animation
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {revealed && (
          <motion.figure
            key="frame"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.15, rotate: -9, y: 30 }}
            animate={{ opacity: 1, scale: 1, rotate: -1.6, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.35 } }}
            transition={reduced ? { duration: 0.25 } : { type: "spring", stiffness: 130, damping: 13, mass: 0.9 }}
            className="pointer-events-none absolute z-20 m-0"
            style={{ left: cx - frameW / 2, top: cy - (frameW * 1.18) / 2, width: frameW }}
          >
            <motion.div animate={reduced ? undefined : { y: [0, -7, 0] }} transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }} className="relative rounded-[10px] bg-[#fbf3e3] p-3 pb-9 shadow-[0_28px_50px_-22px_rgba(60,36,30,0.65),0_0_0_1px_rgba(120,84,60,0.18)]">
              <span aria-hidden className="absolute -top-3 left-1/2 h-6 w-20 -translate-x-1/2 -rotate-2 rounded-[3px] bg-[#f3b9c4]/80 shadow-sm" />
              <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[6px] bg-[#fffaf1] ring-1 ring-[#c7a88a]/40">
                {photoUrl && !photoFailed ? (
                  <img src={photoUrl} alt={snapshot.title} className="h-full w-full object-contain" onError={() => setPhotoFailed(true)} />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_40%,#fff4d6,#f6dcc7)] px-5 text-center">
                    <span aria-hidden className="text-[#a07a2c]"><MapIcon name="present" size={44} /></span>
                    <span className="font-display text-[18px] leading-tight text-dusk">{snapshot.title}</span>
                    <span className="text-[11px] text-dusk/55">Photo unavailable</span>
                  </div>
                )}
              </div>
              <figcaption className="absolute inset-x-3 bottom-2.5 text-center font-display text-[15px] text-dusk/80">Gift selected — not purchased</figcaption>
            </motion.div>
          </motion.figure>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {revealed && (
          <motion.section
            key="panel"
            aria-label="Our gift"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.3 } }}
            transition={{ duration: reduced ? 0.2 : 0.7, delay: reduced ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="paper-card pointer-events-auto absolute z-30 flex flex-col gap-3 overflow-y-auto rounded-[24px] p-6"
            style={wide ? { left: panel.x, top: Math.max(20, size.h * 0.07), width: panel.w, maxHeight: size.h - Math.max(20, size.h * 0.07) - 24 } : { left: 16, right: 16, bottom: 12, maxHeight: "46vh" }}
          >
            <p className="text-[11.5px] font-semibold tracking-[0.14em] text-coral uppercase">{items && items.length > 1 ? `Our ${items.length} gifts` : "Our gift"}{sample ? " · sample" : ""}</p>
            {items && items.length > 1 && <div role="group" aria-label="Selected gifts" className="flex flex-wrap gap-2">
              {items.map((it, i) => <button key={it.listingId} type="button" aria-pressed={focus === i} onClick={() => setFocus(i)}
                className="rounded-lg border border-dusk/20 px-2 py-1 text-left text-xs" style={focus === i ? { background: "#eee4c9" } : undefined}>
                {i + 1}. {it.listingSnapshot.title}
              </button>)}
            </div>}
            <h2 ref={heading} tabIndex={-1} className="font-display text-[30px] leading-[1.05] text-dusk outline-none">{snapshot.title}</h2>
            <p className="text-[15px] text-dusk">
              <strong className="font-semibold">{price ?? "Price unknown"}</strong>
              <span className="text-dusk/60"> · {price ? "observed item price" : "no price was observed"}{listing ? ` · ${listing.currency}` : ""}</span>
            </p>
            <p className="text-[12.5px] leading-snug text-dusk/65">
              Shipping and tax: {listing?.shippingStatus === "observed" && listing.shippingMinor !== undefined ? `${formatMinor(listing.shippingMinor, listing.currency)} shipping observed; tax unknown` : "unknown"}.
              {" "}Observed {new Date(snapshot.retrievedAt).toLocaleString()}
              {freshness?.needsRefresh ? ` · ${freshness.label}` : ""}.
              {sample ? " This is clearly labelled sample data, not a live listing." : ""}
            </p>
            {gone && <p role="alert" className="rounded-xl bg-coral/12 px-3 py-2 text-[13px] text-[#8c3b2c]">This listing is marked unavailable. Check the source before you rely on it.</p>}

            <div className="rounded-[16px] bg-white/55 px-4 py-3">
              <h3 className="font-display text-[19px] leading-tight">Why this gift?</h3>
              {recommendation?.explanation ? <p className="mt-1 text-[13.5px] leading-snug text-dusk/80">{recommendation.explanation}</p> : <p className="mt-1 text-[13.5px] leading-snug text-dusk/70">The organizer picked this one. No written reasoning was saved with it.</p>}
              {why.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {why.map((c) => (
                    <li key={c.id} className="rounded-lg bg-[#fff6e3] px-2.5 py-1.5 text-[12.5px] leading-snug text-dusk/85">“{c.text}”</li>
                  ))}
                </ul>
              )}
              {convergence.total > 0 && <p className="mt-2 text-[12px] text-dusk/55">{convergence.total} {convergence.total === 1 ? "memory or idea" : "memories and ideas"} from the room led here.</p>}
            </div>

            <div className="flex flex-col gap-2">
              <button type="button" className="btn-primary h-12 justify-center px-5 text-[15px]" onClick={() => { convergence.close(); onPlan(); }}>Plan our contributions <span aria-hidden>→</span></button>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary h-11 px-4 text-[14px]">
                  {isGoogle(url) ? "View source listing (Google Shopping)" : "View product"} <span aria-hidden className="ml-1">↗</span>
                </a>
              ) : <p className="text-[12.5px] text-dusk/55">No source link was saved for this listing.</p>}
              <div className="flex gap-2">
                {isOrganizer && <button type="button" className="btn-secondary h-10 flex-1 px-3 text-[13.5px]" onClick={onReplay}>Replay reveal</button>}
                <button type="button" className="btn-secondary h-10 flex-1 px-3 text-[13.5px]" onClick={() => convergence.close()}>Back to the map</button>
              </div>
            </div>
            <p className="text-[12px] leading-snug text-dusk/55">Gift selected — not purchased. No money has been charged. Contributions are planned and approved next.</p>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

export { CONVERGENCE_TIMES };
