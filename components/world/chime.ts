/**
 * A soft music-box chime synthesised with Web Audio (no audio files). Only
 * called after a user gesture and only when sound is enabled.
 */
let ctx: AudioContext | null = null;

const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];

export function playChime(variant: number) {
  if (typeof window === "undefined") return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
    const start = variant % 3;
    const notes = [0, 2, 4].map((k) => PENTATONIC[(start + k + (variant % 2)) % PENTATONIC.length]!);
    notes.forEach((freq, i) => {
      const t = now + i * 0.085;
      for (const [type, mult, level] of [
        ["sine", 1, 0.7],
        ["triangle", 2, 0.12],
      ] as const) {
        const osc = ctx!.createOscillator();
        const gain = ctx!.createGain();
        osc.type = type;
        osc.frequency.value = freq * mult;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        osc.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + 1.2);
      }
    });
  } catch {
    // Audio is a nicety; ignore browsers that refuse it.
  }
}
