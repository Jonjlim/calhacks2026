"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { QrModulesSvg } from "@/components/unwrap/QrModulesSvg";
import { appOrigin, isLoopbackUrl } from "@/lib/invite";
import { inviteQrModules } from "@/lib/invitation/realQr";
import { storySentence } from "@/lib/story/sentence";
import { GiftStoryBook } from "./GiftStoryBook";
import s from "./story-book.module.css";

/**
 * Under the revealed gift (D26): one line of what the room did, a button that
 * plays the story book, and, for the organizer, the opt-in gift tag: a QR and
 * link the recipient opens to read how friends chose it. Photos stay off the
 * tag unless the organizer ticks the box. The tag can be taken back any time.
 */
export function StoryCard({ roomId, isOrganizer }: { roomId: Id<"rooms">; isOrganizer: boolean }) {
  const summary = useQuery(api.story.summary, { roomId });
  const tagRes = useQuery(api.story.tag, { roomId });
  const createTag = useMutation(api.story.createTag);
  const revokeTag = useMutation(api.story.revokeTag);
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(appOrigin(window.location.origin)), []);

  const tag = tagRes?.ok ? tagRes.value : null;
  const url = tag && origin ? `${origin}/gift/${tag.token}` : null;
  const modules = useMemo(() => (url ? inviteQrModules(url) : null), [url]);
  if (!summary?.ok) return null;
  const story = summary.value;

  const run = async (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) setError(res.error?.message ?? "That didn’t work.");
    } catch {
      setError("That didn’t work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.summary}>
      <p>{storySentence(story.stats, { gifts: story.gifts.length || 1 })}</p>
      <button type="button" className="btn-secondary h-10 px-4 text-[13.5px]" onClick={() => setOpen(true)}>Play our story <span aria-hidden className="ml-1">▸</span></button>

      {tag && url && modules ? (
        <div className={s.tag}>
          <div className={s.qr}><QrModulesSvg modules={modules} className="h-auto w-full" label={`QR code for ${story.recipientName}’s gift tag`} scannable /></div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <strong className="font-display text-[17px] text-dusk">Gift tag for {story.recipientName}</strong>
            <span className={s.small}>Print it or send the link. It shows {story.recipientName} the kind memories and the gift, never prices or anything private{tag.includePhotos ? ", plus the room’s photos" : ""}.</span>
            {isLoopbackUrl(url) && <span className={s.small}>This is a localhost link; phones can’t open it.</span>}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="btn-secondary h-8 px-3 text-[12.5px]" onClick={async () => {
                try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
              }}>{copied ? "Link copied" : "Copy link"}</button>
              <a className="btn-secondary h-8 px-3 text-[12.5px]" href={url} target="_blank" rel="noopener noreferrer">Preview ↗</a>
              {isOrganizer && <button type="button" className="h-8 px-2 text-[12.5px] text-dusk/60 underline-offset-2 hover:underline" disabled={busy}
                onClick={() => run(() => revokeTag({ roomId }))}>Take it back</button>}
            </div>
          </div>
        </div>
      ) : isOrganizer ? (
        <div className={s.tag}>
          <div className="flex flex-1 flex-col gap-1.5">
            <strong className="font-display text-[17px] text-dusk">Make a gift tag</strong>
            <span className={s.small}>A QR {story.recipientName} scans to read how you chose it: the kind memories friends published and the gift. No prices, no private notes. You can take it back.</span>
            <label className={s.toggle}><input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} /> Include the room’s photos ({story.stats.photos})</label>
            <button type="button" className="btn-primary h-10 justify-center px-4 text-[13.5px]" disabled={busy} onClick={() => run(() => createTag({ roomId, includePhotos: photos }))}>
              {busy ? "Making…" : "Make the tag"}
            </button>
          </div>
        </div>
      ) : null}
      {error && <p role="alert" className="text-[12.5px] text-[#8c3b2c]">{error}</p>}

      {open && createPortal(<GiftStoryBook story={story} audience="room" onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}
