"use client";

import { motion } from "motion/react";

export function LandingHeader({ soundEnabled, onToggleSound, onJoin }: { soundEnabled: boolean; onToggleSound: () => void; onJoin: () => void }) {
  return (
    <header className="pointer-events-auto flex items-center justify-between px-[clamp(40px,5vw,88px)] pt-9">
      <a href="/" className="font-display text-[34px] leading-none font-semibold tracking-[-0.01em] text-dusk">
        unwrap<span className="text-coral-soft">.</span>
      </a>
      <nav className="flex items-center gap-2" aria-label="Site">
        <button type="button" onClick={onJoin} className="rounded-full px-4 py-2 text-[14.5px] font-medium text-dusk/75 transition hover:bg-white/40 hover:text-dusk">
          Join a room
        </button>
        <motion.button
          type="button"
          onClick={onToggleSound}
          aria-pressed={soundEnabled}
          whileTap={{ scale: 0.94 }}
          className="flex items-center gap-2 rounded-full border border-dusk/10 bg-paper/70 px-3.5 py-2 text-[13.5px] font-medium text-dusk/75 shadow-sm backdrop-blur-md transition hover:text-dusk"
        >
          <SoundIcon on={soundEnabled} />
          {soundEnabled ? "Sound on" : "Sound off"}
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
