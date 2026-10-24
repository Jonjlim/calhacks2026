"use client";

import { motion } from "motion/react";
import type { CreateRoomDraft, LandingActions, LandingRoomEntry } from "@/lib/mocks/landing";
import { CreateJoinPanel } from "./CreateJoinPanel";

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] },
}) as const;

export function LandingHero({
  actions,
  joinRequest,
  onRoomCreated,
}: {
  actions: LandingActions;
  joinRequest: number;
  onRoomCreated?: (entry: LandingRoomEntry, draft: CreateRoomDraft) => void;
}) {
  return (
    <section aria-labelledby="hero-title" className="pointer-events-auto flex max-w-[620px] flex-col">
      <motion.h1 id="hero-title" {...rise(0.15)} className="font-display text-[clamp(56px,5.4vw,84px)] leading-[0.98] font-medium tracking-[-0.02em] text-dusk">
        Thoughtful gifts,
        <br />
        together.
      </motion.h1>
      <motion.p {...rise(0.3)} className="mt-6 max-w-[400px] text-[clamp(17px,1.35vw,20px)] leading-[1.55] text-dusk/75">
        A little magic happens when friends put their memories together.
      </motion.p>
      <motion.div {...rise(0.45)} className="mt-10">
        <CreateJoinPanel actions={actions} joinRequest={joinRequest} onRoomCreated={onRoomCreated} />
      </motion.div>
    </section>
  );
}
