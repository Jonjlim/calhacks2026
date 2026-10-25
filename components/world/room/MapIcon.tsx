import type { ReactNode } from "react";

/**
 * Hand-drawn glyphs for the gift map, in place of emoji. One stroke weight,
 * rounded ends, drawn on a 24px grid so they sit inside pills, chips and clouds.
 * Colour comes from `currentColor`; a few glyphs fill a small accent with it.
 */

export type MapIconName =
  | "heart" | "drift" | "thread" | "present" | "home" | "coins" | "open" | "sprout" | "gather" | "scales"
  | "cloud" | "camera" | "spark" | "trash" | "undo" | "memory" | "wish" | "check" | "wait" | "redo" | "trend";

const PATHS: Record<MapIconName, ReactNode> = {
  // Feels like her: a heart with a small spark beside it.
  heart: <><path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20z" /><path d="M19.5 3.5v3M18 5h3" /></>,
  // Not really: a feather drifting away.
  drift: <><path d="M5 19c3-6 7-10 14-14-1 6-5 11-11 12" /><path d="M5 19l4-4M10 16l-1.5-3M13 13.5l-1-3" /></>,
  // Why: three memories joined by a thread to one point.
  thread: <><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2.4" /><path d="M7 6.8c5 .8 7 2.8 9.8 4.4M7 17.2c5-.8 7-2.8 9.8-4.4" /></>,
  // The box: a present with a bow.
  present: <><rect x="4" y="10" width="16" height="10" rx="1.5" /><path d="M3 10h18M12 10v10M12 10c-1.6-3.6-6-4-6-1.6S10 10 12 10zM12 10c1.6-3.6 6-4 6-1.6S14 10 12 10z" /></>,
  // She already has it: a little house with a tick.
  home: <><path d="M4 11l8-6.5 8 6.5M6 9.5V19h12V9.5" /><path d="M9.5 14.5l2 2 3.5-4" /></>,
  // Too pricey: a stack of coins, tipping.
  coins: <><ellipse cx="10" cy="7" rx="5.5" ry="2.2" /><path d="M4.5 7v4c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V7M4.5 11v4c0 1.2 2.5 2.2 5.5 2.2" /><circle cx="17" cy="16.5" r="3.5" /></>,
  // Open the listing: an arrow leaving a card.
  open: <><path d="M13 5h6v6M19 5l-8 8" /><path d="M17 14v4.5A1.5 1.5 0 0 1 15.5 20h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10" /></>,
  // Find gifts: a sprout.
  sprout: <><path d="M12 21v-9" /><path d="M12 12c0-4 2.5-6.5 7-6.5 0 4-2.5 6.5-7 6.5zM12 14.5c0-3-2-5-6-5 0 3 2 5 6 5z" /><path d="M8 21h8" /></>,
  // Group into themes: three small clouds drawn together.
  gather: <><path d="M4 9.5a2.5 2.5 0 0 1 4.6-1.4A3 3 0 0 1 14 9.6 2 2 0 0 1 13.4 13.5H5.5A2 2 0 0 1 4 9.5z" /><path d="M11 18.5a2 2 0 0 1 3.6-1.2 2.4 2.4 0 0 1 4.4 1 1.6 1.6 0 0 1-.4 3.2h-6.4A1.6 1.6 0 0 1 11 18.5z" /><path d="M16 7.5l2.5-2.5M18.5 9H21" /></>,
  // Help us choose: a balance.
  scales: <><path d="M12 4v16M8 20h8M5 7h14" /><path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" /></>,
  // Share a memory: a soft cloud.
  cloud: <path d="M6.5 18A4 4 0 0 1 6 10a5.5 5.5 0 0 1 10.6-1.6A4.2 4.2 0 0 1 17.5 18z" />,
  // A photo: a polaroid.
  camera: <><rect x="4.5" y="3.5" width="15" height="17" rx="1.5" /><rect x="7" y="6" width="10" height="9" rx=".8" /><circle cx="12" cy="10.5" r="2" /></>,
  // A gift idea: a spark, not yet a thing.
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M18 17l.7 1.8 1.8.7-1.8.7L18 22l-.7-1.8-1.8-.7 1.8-.7z" /></>,
  trash: <><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" /><path d="M10.5 11v5.5M13.5 11v5.5" /></>,
  undo: <><path d="M9 7L4.5 11 9 15" /><path d="M4.5 11H14a5 5 0 0 1 0 10h-3" /></>,
  // A memory: a thought cloud with its trail.
  memory: <><path d="M7.5 14.5A3.5 3.5 0 0 1 7.2 7.6a4.8 4.8 0 0 1 9.3-1A3.7 3.7 0 0 1 17 14.5z" /><circle cx="7" cy="18" r="1.4" /><circle cx="4.5" cy="21" r=".9" /></>,
  // A wish: a shooting star.
  wish: <><path d="M15 4l1.3 3.6 3.7 1.2-3.7 1.3L15 13.7l-1.3-3.6-3.7-1.3 3.7-1.2z" /><path d="M10 13l-6 6M12.5 16.5l-3.5 3.5M7 11l-3 3" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  wait: <><path d="M7 3.5h10M7 20.5h10M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5-8 8.5" /></>,
  // A trend: searches climbing over a little hill, ending in a spark.
  trend: <><path d="M3 19h18" /><path d="M4 16l4.5-4.5 3.5 3 6-6.5" /><path d="M14.5 8h3.5v3.5" /><circle cx="20" cy="5" r=".8" fill="currentColor" /></>,
  redo: <><path d="M15 7l4.5 4L15 15" /><path d="M19.5 11H10a5 5 0 0 0 0 10h3" /></>,
};

export function MapIcon({ name, size = 16, className }: { name: MapIconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {PATHS[name]}
    </svg>
  );
}
