"use client";

import { useEffect, useState } from "react";
import { book, useBookOpen } from "./bookStore";
import s from "./book.module.css";

/**
 * The way in to the Book of Possibilities: a small storybook in the bottom-left
 * corner, always there. It draws itself in pencil when the map opens and then
 * the color washes in. It lifts when you reach for it, its pages flutter and
 * it glows; a short label says what it is. A badge counts the researched gifts
 * inside (the real number). Pressing it, or B, opens the book.
 */
export function BookCorner({ count }: { count: number }) {
  const open = useBookOpen();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (open) return null;
  const active = hover || focus;
  return (
    <div className={s.corner0}>
      <button
        type="button"
        className={`${s.cornerBook} ${active ? s.cornerActive : ""} ${mounted ? s.cornerDrawn : ""}`}
        onClick={() => book.show()}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        aria-label={`Open the Book of Possibilities${count ? `, ${count} researched ${count === 1 ? "gift" : "gifts"}` : ""}`}
      >
        <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden>
          {/* Watercolor first, under the pencil. */}
          <g className={s.cornerColor}>
            <path d="M8 18 L30 22 L30 54 L8 50 Z" fill="#c9694d" />
            <path d="M56 18 L34 22 L34 54 L56 50 Z" fill="#b85a45" />
            <path d="M12 21 L30 24.5 L30 51 L12 47.5 Z" fill="#fbf1d8" />
            <path d="M52 21 L34 24.5 L34 51 L52 47.5 Z" fill="#f6e8c8" />
            <circle cx="32" cy="14" r="3.4" fill="#f2c46d" />
          </g>
          {/* The right page flutters. */}
          <g className={s.cornerFlutter}>
            <path d="M34 24.5 L52 21 L52 47.5 L34 51 Z" fill="#fff6e0" stroke="#5b4a52" strokeWidth="1.2" strokeLinejoin="round" pathLength={1} className={s.cornerStroke} />
          </g>
          <g className={s.cornerPencil} fill="none" stroke="#5b4a52" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 18 L30 22 L30 54 L8 50 Z" pathLength={1} className={s.cornerStroke} style={{ ["--n" as string]: 0 }} />
            <path d="M56 18 L34 22 L34 54 L56 50 Z" pathLength={1} className={s.cornerStroke} style={{ ["--n" as string]: 1 }} />
            <path d="M30 22 L34 22 M30 54 L34 54 M32 22 L32 54" pathLength={1} className={s.cornerStroke} style={{ ["--n" as string]: 2 }} />
            <path d="M15 28 L26 30 M15 33 L26 35 M15 38 L24 39.5" pathLength={1} className={s.cornerStroke} style={{ ["--n" as string]: 3 }} />
            <path d="M32 10.6 L33.1 13 L35.6 13.3 L33.8 15 L34.3 17.5 L32 16.3 L29.7 17.5 L30.2 15 L28.4 13.3 L30.9 13 Z" pathLength={1} className={s.cornerStroke} style={{ ["--n" as string]: 4 }} />
          </g>
        </svg>
        {count > 0 && <b className={s.cornerBadge}>{count > 99 ? "99+" : count}</b>}
      </button>
      <span className={`${s.cornerLabel} ${active ? s.cornerLabelOn : ""}`} aria-hidden>See all gift ideas</span>
    </div>
  );
}
