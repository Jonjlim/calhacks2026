/**
 * Demo sound cues. Files live in public/sounds. Playback follows the
 * existing sound toggle: nothing plays until that is on, and the first
 * click is what unlocks the browser's audio policy.
 */

export type SfxCue = "tap" | "wish" | "coin" | "reveal";

const FILES = {
  tap: "/sounds/tap_a.mp3",
  wish: "/sounds/wish_twinkle_a.mp3",
  coin: "/sounds/coin_ding_b.mp3",
  reveal: "/sounds/reveal_combo_a.mp3",
  music: "/sounds/music_bluebonnet_loop.mp3",
} as const;

const VOLUME: Record<SfxCue, number> = {
  tap: 0.5,
  wish: 0.55,
  coin: 0.58,
  reveal: 0.64,
};

const MUSIC_VOLUME = 0.2;

let enabled = false;
let music: HTMLAudioElement | null = null;
let ducked = 0;

function preload(src: string) {
  const clip = new Audio(src);
  clip.preload = "auto";
  clip.load();
}

export function setSfxEnabled(on: boolean) {
  enabled = on;
  if (typeof window === "undefined") return;
  if (!on) {
    music?.pause();
    return;
  }
  for (const src of Object.values(FILES)) preload(src);
  music ??= Object.assign(new Audio(FILES.music), { loop: true, preload: "auto" as const });
  music.volume = MUSIC_VOLUME;
  if (music.paused) void music.play().catch(() => undefined);
}

/** Retry the loop after a gesture, if autoplay was blocked on load. */
export function resumeMusic() {
  if (!enabled || !music?.paused) return;
  music.volume = MUSIC_VOLUME;
  void music.play().catch(() => undefined);
}

export function playSfx(cue: SfxCue) {
  if (!enabled || typeof window === "undefined") return;
  try {
    const clip = new Audio(FILES[cue]);
    clip.volume = VOLUME[cue];
    void clip.play().catch(() => undefined);
    if (cue === "reveal" && music) {
      music.volume = 0.06;
      window.clearTimeout(ducked);
      ducked = window.setTimeout(() => {
        if (music && enabled) music.volume = MUSIC_VOLUME;
      }, 3200);
    }
  } catch {
    // Audio is a nicety; ignore browsers that refuse it.
  }
}

/** Which cue a DOM press should make. Null means the press is not a control. */
export function cueFromTarget(target: EventTarget | null): SfxCue | "silent" | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return null;
  const marked = target.closest("[data-sfx]");
  if (marked instanceof HTMLButtonElement && marked.disabled) return null;
  const cue = marked?.getAttribute("data-sfx");
  if (cue === "silent" || cue === "tap" || cue === "wish" || cue === "coin" || cue === "reveal") return cue;
  const clickable = target.closest("button, a, [role='button'], summary, [data-map-token]");
  if (clickable instanceof HTMLButtonElement && clickable.disabled) return null;
  return clickable ? "tap" : null;
}
