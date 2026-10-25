"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GiftStoryBook } from "./GiftStoryBook";
import s from "./story-book.module.css";

/** The recipient's gift tag page (D26). No sign-in: the token in the link is the key. */
export function PublicGiftStory({ token }: { token: string }) {
  const res = useQuery(api.story.byToken, { token });
  return (
    <main className={s.public}>
      {res === undefined ? (
        <p className="font-display text-[22px] text-dusk/70">Opening your gift tag…</p>
      ) : !res.ok ? (
        <div className="paper-card max-w-[420px] rounded-[24px] p-6 text-center">
          <h1 className="font-display text-[28px] text-dusk">This gift tag isn’t here</h1>
          <p className="mt-2 text-[14px] text-dusk/70">It may have been taken back, or the link is incomplete. Ask whoever gave it to you.</p>
        </div>
      ) : (
        <div className="flex w-full flex-col items-center gap-4">
          <GiftStoryBook story={res.value} audience="recipient" inline />
          <p className="max-w-[560px] text-center text-[12px] text-dusk/55">Made with Unwrap. Only memories friends chose to share are shown.</p>
        </div>
      )}
    </main>
  );
}
