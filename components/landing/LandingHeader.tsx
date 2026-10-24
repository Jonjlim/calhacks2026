"use client";

import { motion } from "motion/react";
import { setTimeOfDay, useTimeOfDay } from "@/components/world/scenePalette";

export function LandingHeader({ soundEnabled, onToggleSound, onJoin }: { soundEnabled: boolean; onToggleSound: () => void; onJoin: () => void }) {
  const time = useTimeOfDay();
  const night = time === "night";
  return (
    <header className="pointer-events-auto flex items-center justify-between gap-3 px-5 pt-[max(20px,env(safe-area-inset-top))] sm:px-[clamp(40px,5vw,88px)] sm:pt-9">
      <a href="/" className="font-display shrink-0 text-[30px] leading-none font-semibold tracking-[-0.01em] text-dusk sm:text-[34px]">
        unwrap<span className="text-coral-soft">.</span>
      </a>
      <nav className="flex items-center gap-2" aria-label="Site">
        {/* Phones already have "Join with a code" under the headline. */}
        <button type="button" onClick={onJoin} className="chrome-link hidden rounded-full px-4 py-2 text-[14.5px] font-medium text-dusk/75 transition hover:bg-white/40 hover:text-dusk sm:inline-flex">
          Join a room
        </button>
        <motion.button
          type="button"
          onClick={onToggleSound}
          aria-pressed={soundEnabled}
          aria-label={soundEnabled ? "Sound on" : "Sound off"}
          whileTap={{ scale: 0.94 }}
          className="flex h-10 min-w-10 items-center justify-center gap-2 rounded-full border border-dusk/10 bg-paper/70 px-2.5 text-[13.5px] font-medium text-dusk/75 shadow-sm backdrop-blur-md transition hover:text-dusk sm:h-auto sm:px-3.5 sm:py-2"
        >
          <SoundIcon on={soundEnabled} />
          <span className="hidden sm:inline">{soundEnabled ? "Sound on" : "Sound off"}</span>
        </motion.button>
        <motion.button
          type="button"
          onClick={() => setTimeOfDay(night ? "day" : "night")}
          aria-label={night ? "Switch to daytime" : "Switch to night-time"}
          title={night ? "Switch to daytime" : "Switch to night-time"}
          whileTap={{ scale: 0.94 }}
          className="flex h-10 min-w-10 items-center justify-center gap-2 rounded-full border border-dusk/10 bg-paper/70 px-2.5 text-[13.5px] font-medium text-dusk/75 shadow-sm backdrop-blur-md transition hover:text-dusk sm:h-auto sm:px-3.5 sm:py-2"
        >
          <TimeIcon night={night} />
          <span className="hidden sm:inline">{night ? "Night" : "Day"}</span>
        </motion.button>
      </nav>
    </header>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 6.2h2.2l3.2-2.7v9l-3.2-2.7H2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      {on ? (
        <path d="M10.4 5.6c.9 1.4.9 3.4 0 4.8M12.3 4c1.7 2.4 1.7 5.6 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      ) : (
        <path d="M10.5 6l3.5 4M14 6l-3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      )}
    </svg>
  );
}

function TimeIcon({ night }: { night: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      {night ? (
        <path d="M12.8 10.2A5.4 5.4 0 0 1 5.8 3.2a5.4 5.4 0 1 0 7 7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      ) : (
        <>
          <circle cx="8" cy="8" r="2.8" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
