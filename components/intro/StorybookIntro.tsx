"use client";

import { useEffect, useRef, useState } from "react";
import { INTRO_TIMES, introClock, type SketchData, smoothstep, useIntroPhase } from "./introTimeline";

/**
 * The storybook overlay: a book opens on a sunlit desk to a blank page, an
 * invisible hand pencils the island stroke by stroke, watercolour blooms
 * across it, and the painting dissolves into the live world beneath. It
 * also owns the one animation loop that advances the shared intro clock.
 *
 * The strokes and the painting both come from the live scene (see
 * IntroBridge), so the hand-off is a matched frame, not a guess.
 */

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const GRAPHITE = "58, 46, 56";

interface Blob {
  x: number;
  y: number;
  r: number;
  start: number;
  duration: number;
  lobes: { dx: number; dy: number; s: number }[];
}

function prepareBlobs(sketch: SketchData): Blob[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return sketch.regions.map((r) => ({
    ...r,
    r: r.radius,
    lobes: Array.from({ length: 5 }, (_, i) => {
      const a = rnd() * Math.PI * 2;
      const d = i === 0 ? 0 : 0.25 + rnd() * 0.3;
      return { dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.8, s: i === 0 ? 0.8 : 0.45 + rnd() * 0.35 };
    }),
  }));
}

/** Draws the part of a polyline between arc lengths d0 and d1, with a faint pencil wobble. */
function drawRange(ctx: CanvasRenderingContext2D, pts: Float32Array, d0: number, d1: number, seed: number) {
  let acc = 0;
  let started = false;
  ctx.beginPath();
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2]!;
    const ay = pts[i - 1]!;
    const bx = pts[i]!;
    const by = pts[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    const segEnd = acc + len;
    if (segEnd >= d0 && acc <= d1 && len > 0) {
      const t0 = Math.max(0, (d0 - acc) / len);
      const t1 = Math.min(1, (d1 - acc) / len);
      const j = Math.sin(i * 1.7 + seed) * 0.35;
      if (!started) {
        ctx.moveTo(ax + (bx - ax) * t0 + j, ay + (by - ay) * t0 - j);
        started = true;
      }
      ctx.lineTo(ax + (bx - ax) * t1 + j, ay + (by - ay) * t1 - j);
    }
    acc = segEnd;
    if (acc > d1) break;
  }
  ctx.stroke();
}

export function StorybookIntro() {
  const phase = useIntroPhase();
  const deskRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const leafRef = useRef<HTMLDivElement>(null);
  const turnShadeRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const sketchRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState({ w: 300, h: 405 });
  const [slowLoad, setSlowLoad] = useState(false);

  // Book proportions follow the viewport.
  useEffect(() => {
    const fit = () => {
      const w = Math.min(window.innerWidth * 0.3, window.innerHeight * 0.6 * 0.74);
      setPage({ w, h: w / 0.74 });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    if (phase !== "loading") return;
    const id = window.setTimeout(() => setSlowLoad(true), 1500);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") introClock.finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The intro's single animation loop: advance the clock, then paint the overlay for that time.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let run = -1;
    let sketch: SketchData | null = null;
    let drawn = new Float32Array(0);
    let blobs: Blob[] = [];
    let mask: HTMLCanvasElement | null = null;
    let paintedFor = -1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const sizeCanvas = (c: HTMLCanvasElement | null, w: number, h: number) => {
      if (!c) return null;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // A backgrounded tab simply pauses the story.
      if (!document.hidden) introClock.advance(dt);
      if (!introClock.active) return;
      const t = introClock.phase === "loading" ? 0 : introClock.t;

      if (run !== introClock.run || (!sketch && introClock.sketch)) {
        run = introClock.run;
        sketch = introClock.sketch;
        drawn = new Float32Array(sketch?.strokes.length ?? 0);
        blobs = sketch ? prepareBlobs(sketch) : [];
        paintedFor = -1;
        sizeCanvas(sketchRef.current, sketch?.width ?? 1, sketch?.height ?? 1)?.clearRect(0, 0, sketch?.width ?? 1, sketch?.height ?? 1);
        sizeCanvas(paintRef.current, sketch?.width ?? 1, sketch?.height ?? 1)?.clearRect(0, 0, sketch?.width ?? 1, sketch?.height ?? 1);
        if (sketch) {
          mask = document.createElement("canvas");
          mask.width = Math.ceil(sketch.width / 4);
          mask.height = Math.ceil(sketch.height / 4);
        }
      }

      renderBook(t);

      const art = artRef.current;
      if (art) {
        // The page fills the screen as the camera reaches it; later the painting dissolves into the world.
        const enter = smoothstep(1.85, 2.05, t);
        const leave = smoothstep(INTRO_TIMES.enteringWorld, INTRO_TIMES.enteringWorld + 0.85, t);
        art.style.opacity = String(enter * (1 - leave));
        art.style.visibility = enter * (1 - leave) > 0.001 ? "visible" : "hidden";
        if (sketch) {
          art.style.transformOrigin = `${sketch.gift.x}px ${sketch.gift.y}px`;
          art.style.transform = `scale(${1 + 0.06 * easeInOut(leave)})`;
        }
      }
      if (deskRef.current) deskRef.current.style.visibility = t < 2.1 ? "visible" : "hidden";
      if (!sketch) return;

      // --- Pencil: draw only what is new since last frame. -----------------
      const sk = sketchRef.current?.getContext("2d");
      if (sk && t >= INTRO_TIMES.sketching) {
        sk.lineCap = "round";
        sk.lineJoin = "round";
        const strokes = sketch.strokes;
        for (let i = 0; i < strokes.length; i++) {
          const s = strokes[i]!;
          if (s.start > t) break;
          const target = easeInOut(Math.min(1, (t - s.start) / s.duration)) * s.length;
          if (target <= drawn[i]! + 0.25) continue;
          sk.strokeStyle = `rgba(${GRAPHITE}, ${s.alpha})`;
          sk.lineWidth = s.weight;
          drawRange(sk, s.points, Math.max(0, drawn[i]! - 0.5), target, i);
          // A lighter second pass, slightly offset, reads as graphite grain.
          sk.strokeStyle = `rgba(${GRAPHITE}, ${s.alpha * 0.28})`;
          sk.lineWidth = s.weight * 0.6;
          drawRange(sk, s.points, Math.max(0, drawn[i]! - 0.5), target, i + 3.7);
          drawn[i] = target;
        }
      }
      if (sketchRef.current) sketchRef.current.style.opacity = String(1 - 0.22 * smoothstep(INTRO_TIMES.watercolor, INTRO_TIMES.enteringWorld, t) - 0.78 * smoothstep(INTRO_TIMES.enteringWorld - 0.05, INTRO_TIMES.enteringWorld + 0.5, t));

      // --- Watercolour: grow soft blooms in a low-res mask, reveal the painting through it.
      const snap = introClock.snapshot;
      const pc = paintRef.current?.getContext("2d");
      if (pc && snap && mask && t >= INTRO_TIMES.watercolor && paintedFor < INTRO_TIMES.enteringWorld + 0.05) {
        paintedFor = t;
        const m = mask.getContext("2d")!;
        const sx = mask.width / sketch.width;
        m.setTransform(1, 0, 0, 1, 0, 0);
        m.clearRect(0, 0, mask.width, mask.height);
        for (const b of blobs) {
          const p = smoothstep(b.start, b.start + b.duration, t);
          if (p <= 0) continue;
          const rad = b.r * (0.2 + 0.8 * easeOut(p)) * sx;
          const a = Math.min(1, p * 1.8);
          for (const l of b.lobes) {
            const cx = b.x * sx + l.dx * b.r * sx;
            const cy = b.y * sx + l.dy * b.r * sx;
            const r = rad * l.s;
            const g = m.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, `rgba(0,0,0,${a})`);
            g.addColorStop(0.62, `rgba(0,0,0,${a * 0.9})`);
            g.addColorStop(1, "rgba(0,0,0,0)");
            m.fillStyle = g;
            m.fillRect(cx - r, cy - r, r * 2, r * 2);
          }
        }
        // Guarantee the finished painting is the whole frame, ready for the hand-off.
        const full = smoothstep(INTRO_TIMES.enteringWorld - 0.45, INTRO_TIMES.enteringWorld, t);
        if (full > 0) {
          m.fillStyle = `rgba(0,0,0,${full})`;
          m.fillRect(0, 0, mask.width, mask.height);
        }
        pc.globalCompositeOperation = "source-over";
        pc.clearRect(0, 0, sketch.width, sketch.height);
        pc.drawImage(snap, 0, 0, sketch.width, sketch.height);
        pc.globalCompositeOperation = "destination-in";
        pc.imageSmoothingEnabled = true;
        pc.drawImage(mask, 0, 0, sketch.width, sketch.height);
        pc.globalCompositeOperation = "source-over";
      }
    };

    const renderBook = (t: number) => {
      const book = bookRef.current;
      const cover = coverRef.current;
      const leaf = leafRef.current;
      if (!book || !cover || !leaf || t > 2.1) return;
      const pw = book.offsetWidth / 2;
      const ph = book.offsetHeight;
      const open = easeInOut(smoothstep(0.2, 1.05, t));
      const turn = easeInOut(smoothstep(0.95, 1.62, t));
      const zoom = easeInOut(smoothstep(1.35, 2.0, t));
      const cover0 = -180 * open;
      cover.style.transform = `translateZ(${2 + Math.sin(open * Math.PI) * 30}px) rotateY(${cover0}deg)`;
      // The page lifts and curls slightly as it turns.
      // Ends just above the opened cover so its blank back lies on top.
      leaf.style.transform = `translateZ(${1 + turn * 2.5 + Math.sin(turn * Math.PI) * 22}px) rotateY(${-178 * turn}deg) skewY(${Math.sin(turn * Math.PI) * -2.5}deg)`;
      if (turnShadeRef.current) turnShadeRef.current.style.opacity = String(Math.sin(turn * Math.PI) * 0.35);
      const S = Math.max(window.innerWidth / pw, window.innerHeight / ph) * 1.04;
      const s = lerp(1, S, zoom * zoom);
      const centred = lerp(-pw / 2, 0, open);
      const tx = lerp(centred, (-pw / 2) * s, zoom);
      const tilt = lerp(24, 0, Math.max(zoom, open * 0.4));
      book.style.transform = `translate3d(${tx}px, ${lerp(10, 0, zoom)}px, 0) scale(${s}) rotateX(${tilt}deg)`;
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 overflow-hidden" role="dialog" aria-label="Storybook introduction">
      <div ref={deskRef} className="intro-desk absolute inset-0" aria-hidden>
        <div className="absolute inset-0 flex items-center justify-center" style={{ perspective: "2000px", perspectiveOrigin: "50% 40%" }}>
          <div ref={bookRef} className="relative" style={{ width: page.w * 2, height: page.h, transformStyle: "preserve-3d", transform: `translate3d(${-page.w / 2}px, 10px, 0) rotateX(24deg)` }}>
            {/* The page block on the right, its top page blank. */}
            <div className="intro-page intro-page-block absolute top-0 right-0 h-full w-1/2 rounded-r-[5px]" />
            {/* Spine crease. */}
            <div className="absolute top-0 left-1/2 h-full w-10 -translate-x-1/2" style={{ background: "linear-gradient(90deg, rgba(60,40,30,0) 0%, rgba(60,40,30,0.22) 50%, rgba(60,40,30,0) 100%)", transform: "translateZ(0.5px)" }} />
            {/* The turning leaf: title page in front, blank on its back. */}
            <div ref={leafRef} className="absolute top-0 right-0 h-full w-1/2" style={{ transformOrigin: "0% 50%", transformStyle: "preserve-3d" }}>
              <div className="intro-face intro-page flex flex-col items-center justify-center text-center">
                <svg width="54" height="54" viewBox="0 0 54 54" fill="none" aria-hidden className="mb-4 opacity-70">
                  <rect x="11" y="21" width="32" height="25" rx="2" stroke="#4a3a48" strokeWidth="1.3" />
                  <path d="M27 21v25M11 30h32M27 21c-4-9-13-8-11-2 1 3 7 2 11 2zM27 21c4-9 13-8 11-2-1 3-7 2-11 2z" stroke="#c46f5a" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                <p className="font-display text-[clamp(22px,2.2vw,34px)] leading-none text-[#41344c]">The Gift Garden</p>
                <p className="font-hand mt-2 text-[clamp(14px,1.2vw,19px)] text-[#41344c]/60">a story of thoughtful gifts</p>
              </div>
              <div className="intro-face back intro-page" />
              <div ref={turnShadeRef} className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(40,25,15,0.5), rgba(40,25,15,0) 60%)", opacity: 0 }} />
            </div>
            {/* The cover: cloth and gold outside, patterned endpaper inside. */}
            <div ref={coverRef} className="absolute top-0 right-0 h-full w-1/2" style={{ transformOrigin: "0% 50%", transformStyle: "preserve-3d", transform: "translateZ(2px)" }}>
              <div className="intro-face intro-cover flex flex-col items-center justify-center">
                <p className="font-display text-[clamp(34px,3.6vw,58px)] leading-none font-semibold tracking-[-0.01em] text-[#e9cf93]">
                  unwrap<span className="text-[#e7a58f]">.</span>
                </p>
                <div className="mt-4 h-px w-1/3 bg-[#d9b66f]/60" />
                <p className="font-hand mt-3 text-[clamp(14px,1.3vw,20px)] text-[#e9cf93]/80">thoughtful gifts, together</p>
              </div>
              <div className="intro-face back intro-endpaper" />
            </div>
          </div>
        </div>
        {phase === "loading" && slowLoad && <p className="font-hand absolute bottom-[12%] w-full text-center text-[20px] text-[#f3e3c6]/80">the storybook is waking up…</p>}
      </div>

      <div ref={artRef} className="intro-page absolute inset-0" style={{ opacity: 0, visibility: "hidden" }} aria-hidden>
        <canvas ref={paintRef} className="absolute inset-0 h-full w-full" />
        <div className="paper-grain pointer-events-none absolute inset-0" />
        <canvas ref={sketchRef} className="absolute inset-0 h-full w-full" style={{ mixBlendMode: "multiply" }} />
      </div>

      <button
        type="button"
        onClick={() => introClock.finish()}
        className="pointer-events-auto absolute right-6 bottom-6 z-10 rounded-full border border-white/30 bg-[#2a1f2c]/40 px-4 py-2 text-[13.5px] font-medium text-white/90 backdrop-blur-md transition hover:bg-[#2a1f2c]/60 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#d9b66f]"
      >
        Skip intro
      </button>
    </div>
  );
}
