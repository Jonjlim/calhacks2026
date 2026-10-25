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
