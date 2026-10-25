"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { MapIcon } from "@/components/world/room/MapIcon";
import s from "@/components/world/room/gift-rings.module.css";
import type { TikTokLookView } from "./types";

/**
 * TikTok inspiration for one trend cloud (D23 trial): a few public posts for
 * the cloud's own search, played in TikTok's embedded player. Videos stream
 * from TikTok; Unwrap keeps only the links. Inspiration, never facts about her.
 */
export function TikTokBoard({ query, look, onClose }: { query: string; look: TikTokLookView | undefined; onClose(): void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const searching = !look || look.status === "pending" || look.status === "running";
  return createPortal(
    <div className={s.storyBackdrop} role="dialog" aria-modal="true" aria-label={`TikToks for ${query}`} onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>
      <div className={s.storyCard} onClick={(e) => e.stopPropagation()}>
        <header className={s.storyHead}>
          <div>
            <small>TikTok inspiration</small>
            <h2>“{query}”</h2>
            <p>Public TikToks for this trend idea. Inspiration only: not facts about her, and not products we checked.</p>
          </div>
          <button type="button" className={s.storyClose} data-sfx="silent" onClick={onClose} aria-label="Close"><MapIcon name="drift" size={16} /></button>
        </header>
        {searching ? (
          <p className={s.tiktokNote}><i className={s.spinner} aria-hidden /> Looking for public TikToks… this takes about a minute.</p>
        ) : look.status !== "succeeded" ? (
          <p className={s.tiktokNote}>The TikTok search didn’t finish{look.lastError ? `: ${look.lastError}` : "."} Try again in a little while.</p>
        ) : !look.posts.length ? (
          <p className={s.tiktokNote}>No recent public TikToks matched “{query}”.</p>
        ) : (
          <div className={s.tiktokGrid}>
            {look.posts.map((p) => (
              <figure key={p.videoId} className={s.tiktokCell}>
                <iframe src={`https://www.tiktok.com/embed/v2/${p.videoId}`} title={`TikTok post ${p.videoId}`} loading="lazy"
                  allow="encrypted-media; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" />
                <figcaption><a href={p.url} target="_blank" rel="noopener noreferrer">Open on TikTok ↗</a></figcaption>
              </figure>
            ))}
          </div>
        )}
        {look?.retrievedAt && <p className={s.storyFoot}>Found {new Date(look.retrievedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · shared with everyone in the room for a day.</p>}
      </div>
    </div>,
    document.body,
  );
}
