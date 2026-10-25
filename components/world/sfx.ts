/**
 * The map's small sound vocabulary, synthesised with Web Audio (no files): paper
 * for the book, graphite for the pencil, a soft wash for the watercolor, a ribbon
 * tick for saving, a warm tone for choosing, and a tiny clockwork click for the
 * council. Everything is quiet, short and only plays when the person has turned
 * sound on (the same switch as the chime), after a gesture.
 */
let ctx: AudioContext | null = null;
let enabled = false;

export const sfx = {
  setEnabled(on: boolean) {
    enabled = on;
  },
};

function audio(): AudioContext | null {
  if (!enabled || typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noise(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

function tone(c: AudioContext, freq: number, at: number, len: number, level: number, type: OscillatorType = "sine") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + len + 0.05);
}

/** Paper fluttering and a soft rising flourish: the book lifting and opening. */
export function playBookOpen() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const n = noise(c, 0.7);
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(1800, t);
  f.frequency.exponentialRampToValueAtTime(5200, t + 0.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  n.connect(f).connect(g).connect(c.destination);
  n.start(t);
  [523.25, 659.25, 783.99, 1046.5].forEach((fr, i) => tone(c, fr, t + 0.35 + i * 0.09, 0.9, 0.05));
}

/** Light graphite scratching while the pages draw themselves. */
export function playPencil(seconds: number) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const n = noise(c, seconds);
  const f = c.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 3200;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  // A scratch for each stroke: quick swells with small gaps.
  const strokes = Math.floor(seconds * 5);
  for (let i = 0; i < strokes; i++) {
    const s = t + (i / strokes) * seconds;
    g.gain.linearRampToValueAtTime(0.012 + Math.random() * 0.012, s + 0.04);
    g.gain.linearRampToValueAtTime(0.0008, s + 0.15);
  }
  g.gain.linearRampToValueAtTime(0.0001, t + seconds);
  n.connect(f).connect(g).connect(c.destination);
  n.start(t);
  return () => {
    n.stop();
    n.disconnect();
    f.disconnect();
    g.disconnect();
  };
}

/** A soft shimmering wash: pigment spreading into the page. */
export function playWash() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  [392, 587.33, 783.99, 987.77].forEach((fr, i) => tone(c, fr, t + i * 0.14, 1.6, 0.035, "triangle"));
}

/** A tiny ribbon tick: a gift saved, or put back. */
export function playTick(up = true) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  tone(c, up ? 880 : 520, t, 0.18, 0.06, "triangle");
  tone(c, up ? 1318.5 : 392, t + 0.07, 0.22, 0.04);
}

/** A warm confirming tone: the gift has been chosen. */
export function playChoose() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  [392, 523.25, 659.25, 783.99].forEach((fr, i) => tone(c, fr, t + i * 0.1, 1.4, 0.06));
}

/** A tiny clockwork click for a council member's real update. */
export function playCouncilTick() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  tone(c, 1800, t, 0.05, 0.03, "square");
  tone(c, 1200, t + 0.06, 0.06, 0.025, "square");
}

// ---------- Moments that deserve a sound (D23 trial) ----------
// Sound marks what you might miss: something finishing in the background, another friend acting, or a big beat.
// Every cue varies its pitch a touch so repeats never sound mechanical, and a cue fired again within a moment is dropped.

const lastPlayed = new Map<string, number>();
function once(name: string, gapMs: number): boolean {
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < gapMs) return false;
  lastPlayed.set(name, now);
  return true;
}
const vary = (f: number) => f * (1 + (Math.random() - 0.5) * 0.04);

/** A filtered breath of noise sweeping between two pitches: paper, satin and air. */
function sweep(c: AudioContext, at: number, len: number, from: number, to: number, level: number, type: BiquadFilterType = "bandpass", q = 1.2) {
  const n = noise(c, len);
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, at);
  f.frequency.exponentialRampToValueAtTime(to, at + len);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(level, at + len * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  n.connect(f).connect(g).connect(c.destination);
  n.start(at);
}

/** Pencil on paper while someone writes a memory: short scratches, never one per key. */
export function playWriting() {
  if (!once("writing", 380)) return;
  playPencil(0.32);
}

/** The note folds and swishes away to the ring as it's shared. */
export function playSend() {
  const c = audio();
  if (!c || !once("send", 200)) return;
  const t = c.currentTime;
  sweep(c, t, 0.12, 2400, 1400, 0.03);
  sweep(c, t + 0.1, 0.42, 900, 3600, 0.035);
  tone(c, vary(880), t + 0.36, 0.3, 0.025, "triangle");
}

/** Gifts arrived from a search: one soft pop per gift, rising. */
export function playGiftsLanded(count: number) {
  const c = audio();
  if (!c || !once("gifts", 1500)) return;
  const t = c.currentTime;
  [523.25, 659.25, 783.99, 1046.5, 1318.5].slice(0, Math.max(1, Math.min(5, count))).forEach((fr, i) => {
    tone(c, vary(fr), t + i * 0.11, 0.35, 0.05, "sine");
    tone(c, vary(fr * 2), t + i * 0.11, 0.12, 0.015, "triangle");
  });
}

/** Memories drifting into themes: a soft harp run. */
export function playRegroup() {
  const c = audio();
  if (!c || !once("regroup", 3000)) return;
  const t = c.currentTime;
  [392, 440, 523.25, 587.33, 659.25, 783.99].forEach((fr, i) => tone(c, vary(fr), t + i * 0.06, 1.1, 0.03, "triangle"));
}

/** A branch of the weave attaches: notes of one chord, so several branches build it together. */
export function playPluck(index: number) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const chord = [392, 493.88, 587.33, 739.99, 783.99, 987.77];
  const fr = vary(chord[index % chord.length]!);
  tone(c, fr, t, 0.9, 0.045, "triangle");
  tone(c, fr * 2, t, 0.25, 0.012, "sine");
}

/** A refused idea's thread snaps. */
export function playSnap() {
  const c = audio();
  if (!c || !once("snap", 120)) return;
  const t = c.currentTime;
  sweep(c, t, 0.08, 3000, 1500, 0.04, "highpass", 0.7);
  tone(c, vary(220), t, 0.18, 0.03, "triangle");
}

/** Another friend pulled something in or passed on it: a quieter version of your own cue. */
export function playFriendSignal(up: boolean) {
  const c = audio();
  if (!c || !once(`friend-${up}`, 600)) return;
  const t = c.currentTime;
  tone(c, vary(up ? 740 : 440), t, 0.16, 0.025, "triangle");
  tone(c, vary(up ? 988 : 330), t + 0.06, 0.18, 0.018);
}

/** Everyone approved the box. */
export function playAllApproved() {
  const c = audio();
  if (!c || !once("approved", 4000)) return;
  const t = c.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((fr) => tone(c, vary(fr), t, 1.8, 0.04, "triangle"));
  [1318.5, 1567.98, 2093].forEach((fr, i) => tone(c, vary(fr), t + 0.25 + i * 0.08, 0.5, 0.02));
}

/** Something didn't work: a soft, low thud, not an alarm. */
export function playThud() {
  const c = audio();
  if (!c || !once("thud", 1500)) return;
  const t = c.currentTime;
  tone(c, 110, t, 0.35, 0.07, "sine");
  sweep(c, t, 0.18, 400, 160, 0.03, "lowpass", 0.6);
}

/** The camera pulls back from the present to the map. */
export function playWhoosh() {
  const c = audio();
  if (!c || !once("whoosh", 1500)) return;
  sweep(c, c.currentTime, 1.1, 300, 2200, 0.05, "bandpass", 0.9);
}

/** The reveal's ribbon, beat by beat: untie, wind and tie, whip off; then the paper bursts. */
export function playRibbon(beat: "untie" | "wrap" | "whip" | "burst") {
  const c = audio();
  if (!c || !once(`ribbon-${beat}`, 800)) return;
  const t = c.currentTime;
  if (beat === "untie") {
    sweep(c, t, 0.6, 1200, 2600, 0.04, "bandpass", 1.6);
    tone(c, vary(659.25), t + 0.45, 0.4, 0.03, "triangle");
  } else if (beat === "wrap") {
    // Satin sliding round the box, then the bow pulled tight.
    for (let i = 0; i < 3; i++) sweep(c, t + i * 0.45, 0.5, 900, 1900, 0.03, "bandpass", 1.4);
    tone(c, vary(587.33), t + 1.45, 0.25, 0.04, "triangle");
    tone(c, vary(880), t + 1.58, 0.3, 0.035, "triangle");
  } else if (beat === "whip") {
    sweep(c, t, 0.35, 600, 5200, 0.06, "bandpass", 0.8);
  } else {
    // Paper tearing open, then a shimmer.
    for (let i = 0; i < 6; i++) sweep(c, t + i * 0.04, 0.09, 2600 + i * 300, 1200, 0.05, "highpass", 0.6);
    [1046.5, 1318.5, 1567.98, 2093].forEach((fr, i) => tone(c, vary(fr), t + 0.2 + i * 0.07, 0.8, 0.025));
  }
}
