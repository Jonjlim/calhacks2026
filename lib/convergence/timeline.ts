/**
 * The Great Gift Convergence: one deterministic timeline, in seconds, that the
 * camera, the present, the ribbon, the artifacts and the DOM all read. Pure
 * numbers and curves (no Three.js), so the choreography can be tested.
 *
 *   open the box → memories gather inside → the camera pushes in → the box
 *   closes → the ribbon ties itself → the present rises → it shakes and
 *   charges → a soft burst → the chosen gift is revealed.
 */

export const CONVERGENCE_TIMES = {
  /** The world holds its breath and the present begins to glow. */
  anticipation: [0, 0.5],
  /** The ribbon unties itself, the lid hinges open and the walls fold down. */
  boxOpen: [0.15, 1.05],
  /** Artifacts arrive in staggered waves. */
  gather: [0.5, 3.6],
  /** The camera glides from the map to the close-up of the present. */
  cameraPush: [1.0, 3.8],
  /** Walls rise back to their places, then the lid settles. */
  wallsClose: [3.4, 4.2],
  lidClose: [4.15, 4.75],
  /** The coral ribbon winds round the box and ties its bow. */
  wrap: [4.65, 6.5],
  levitate: [6.4, 7.2],
  /** The shaking builds. */
  charge: [7.0, 9.25],
  /** Just before the burst the ribbon whips off the box, so the present bursts bare. */
  ribbonOff: [8.4, 9.1],
  /** The camera swings to the middle of the screen and closes in, ready for the explosion. */
  boom: [8.2, 9.2],
  burst: [9.3, 10.1],
  reveal: [9.8, 11.3],
  end: 11.3,
} as const;

/** How long the camera takes to glide back to the map once the reveal is closed. */
export const EXIT_TIME = 1.4;

export type ConvergenceState =
  | "idle"
  | "anticipation"
  | "gathering"
  | "cameraPush"
  | "closing"
  | "wrapping"
  | "levitating"
  | "charging"
  | "burst"
  | "revealing"
  | "complete";

const T = CONVERGENCE_TIMES;

/** Which beat of the story a moment belongs to. */
export function stateAt(t: number): ConvergenceState {
  if (t < 0) return "idle";
  if (t >= T.end) return "complete";
  if (t >= T.reveal[0]) return "revealing";
  if (t >= T.burst[0]) return "burst";
  if (t >= T.charge[0]) return "charging";
  if (t >= T.levitate[0]) return "levitating";
  if (t >= T.wrap[0]) return "wrapping";
  if (t >= T.wallsClose[0]) return "closing";
  if (t >= T.gather[1] - 0.8) return "cameraPush";
  if (t >= T.gather[0]) return "gathering";
  return "anticipation";
}

/** One short line for each beat, announced politely to screen readers. */
export const STATE_CAPTION: Record<ConvergenceState, string> = {
  idle: "",
  anticipation: "The present begins to glow…",
  gathering: "Every memory and idea is flying into the present…",
  cameraPush: "Everything we shared is gathering inside…",
  closing: "The present closes…",
  wrapping: "The ribbon ties itself into a bow…",
  levitating: "The present lifts off its pedestal…",
  charging: "It can hardly keep the surprise in…",
  burst: "A little magic…",
  revealing: "Our gift.",
  complete: "Our gift.",
};

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0 before a, 1 after b, linear between. */
export const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const smooth = (k: number) => k * k * (3 - 2 * k);
export const smoother = (k: number) => k * k * k * (k * (k * 6 - 15) + 10);
export const easeOutBack = (k: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};
/** A wall falling open: gathers speed, then a small bounce as it lands. */
export const flop = (k: number) => (k <= 0 ? 0 : k < 0.8 ? (k / 0.8) ** 2 : 1 - 0.07 * Math.sin(((k - 0.8) / 0.2) * Math.PI));

/** The four walls fold in this order (right, back, left, front is irrelevant; each is staggered a little). */
const WALL_COUNT = 4;
const BACK_WALL = 1;

export interface GiftChoreography {
  /** True while the shells (hollow box) stand in for the solid box. */
  hollow: boolean;
  /** 0..1 fold of each wall (1 = flat on the ground). */
  wall: number[];
  /** 0..1: how far the lid rides down with the back wall. */
  backFold: number;
  /** The lid's hinge angle as a fraction of its open angle (can overshoot 1 a little). */
  lid: number;
  /** Draw progress, 0..1, of each part of the ribbon. */
  ribbon: { bandX: number; bandZ: number; tails: number; bow: number };
  /** Lift above the pedestal, in world units. */
  lift: number;
  /** Extra tilt of the whole present, radians. */
  tiltZ: number;
  tiltX: number;
  /** Side-to-side and back-and-forth shake offsets, world units. */
  shakeX: number;
  shakeZ: number;
  shakeY: number;
  /** Squash and stretch applied to the body (1 = none). */
  scaleY: number;
  scaleXZ: number;
  /** The whole present, 0 once it has burst into light. */
  presence: number;
  /** 0..1 energy of the shaking (also drives the glow and sparkle emission). */
  charge: number;
  /** 0..1 interior and edge glow from artifacts and charging combined. */
  glow: number;
  /** Warm pool of light beneath the present, 0..1. */
  halo: number;
  /** 0..1 while the ribbon is whipped off the box, before the burst. */
  ribbonLift: number;
  /** 0..1 through the burst: the walls, lid, floor and ribbon fly outward. */
  burst: number;
}

/** Highest lift in world units. About a fifth of the present's height. */
export const LEVITATE_HEIGHT = 0.42;

/**
 * Everything the present does, as a pure function of the timeline.
 * `fill` is the share of artifacts that have already arrived (0..1).
 */
export function giftChoreography(t: number, fill: number): GiftChoreography {
  // --- The box: opens, receives, closes. ---------------------------------
  const open = span(t, T.boxOpen[0], T.boxOpen[1]);
  const lidClose = smooth(span(t, T.lidClose[0], T.lidClose[1]));
  const closing = t >= T.lidClose[0];
  const lidOpen = 1 + 1.8 * Math.pow(open - 1, 3) + 0.8 * Math.pow(open - 1, 2);
  const lid = closing ? 1 - lidClose : lidOpen;

  const wall: number[] = [];
  for (let i = 0; i < WALL_COUNT; i++) {
    const opening = span(t, 0.5 + i * 0.07, T.boxOpen[1] - (3 - i) * 0.05);
    const shutting = smoother(span(t, T.wallsClose[0] + (3 - i) * 0.05, T.wallsClose[1] - i * 0.03));
    // At the burst the walls stay upright: the box shatters from whole (see `burst`).
    wall.push(t >= T.wallsClose[0] ? Math.min(1, flop(opening)) * (1 - shutting) : flop(opening));
  }
  const backFold = clamp01(wall[BACK_WALL]! * 1.15);
  const burstEnd = T.burst[1];
  const hollow = (t >= T.boxOpen[0] && t < T.lidClose[1]) || (t >= T.burst[0] && t < burstEnd);

  // --- The ribbon: unties quickly, then winds back on. -------------------
  const untie = (a: number, b: number) => 1 - smooth(span(t, a, b));
  const wind = (a: number, b: number) => smooth(span(t, a, b));
  const wrapped = t >= T.wrap[0];
  const off = t >= T.ribbonOff[0];
  const ribbon = off
    ? { bandX: 1, bandZ: 1, tails: 1, bow: 1 } // whipped off whole (see `ribbonLift`), not unwound
    : wrapped
      ? { bandX: wind(4.65, 5.35), bandZ: wind(5.0, 5.75), tails: wind(5.5, 6.05), bow: easeOutBack(span(t, 5.8, 6.5)) }
      : { bandX: untie(0.35, 0.85), bandZ: untie(0.3, 0.8), tails: untie(0.2, 0.5), bow: untie(0.0, 0.35) };
  const ribbonLift = smoother(span(t, T.ribbonOff[0], T.ribbonOff[1]));

  // --- Levitation, charging, shaking. -----------------------------------
  const rise = smoother(span(t, T.levitate[0], T.levitate[1]));
  const bob = rise * Math.sin(t * 2.6) * 0.03;
  const charge = Math.pow(span(t, T.charge[0], T.charge[1]), 1.6);
  const anticipate = span(t, T.burst[0] - 0.3, T.burst[0]) * (1 - span(t, T.burst[0], T.burst[0] + 0.05));
  const wobble = Math.sin(t * (24 + 10 * charge)) * (0.5 + 0.5 * Math.sin(t * 7.3));
  const shake = charge * (1 - anticipate * 0.6);
  const shakeX = wobble * (0.012 + 0.05 * shake);
  const shakeZ = Math.sin(t * 17.1 + 1.3) * 0.01 * shake;
  const shakeY = Math.abs(Math.sin(t * (13 + 7 * charge))) * (0.01 + 0.035 * shake) * (charge > 0 ? 1 : 0);
  const tiltZ = rise * 0.05 + Math.sin(t * (21 + 9 * charge)) * (0.015 + 0.09 * shake) + anticipate * -0.08;
  const tiltX = Math.sin(t * 18.3 + 0.6) * 0.03 * shake + anticipate * 0.05;

  // --- Burst: a brief swell, then the present gives way to the gift. ------
  // The present bursts open and outward: it never shrinks, its parts fly away and it is gone once they have.
  const pop = span(t, T.burst[0], T.burst[0] + 0.14);
  const presence = t < burstEnd ? 1 + 0.08 * smooth(pop) : 0;
  const burst = span(t, T.burst[0], burstEnd);
  const squash = anticipate * 0.1;

  const interior = Math.min(1, fill) * 0.7;
  const glow = clamp01(interior * (1 - smooth(span(t, T.lidClose[1], T.wrap[1]))) * 0.9 + 0.25 * span(t, 0, 0.5) * (1 - smooth(span(t, 3.4, 4.7))) + charge * 0.8 + anticipate * 0.2);
  const halo = rise * (1 - smooth(span(t, T.burst[0] + 0.3, T.reveal[1])) * 0.55);

  return {
    hollow,
    wall,
    backFold,
    lid,
    ribbon,
    lift: rise * LEVITATE_HEIGHT + bob + shakeY,
    tiltZ,
    tiltX,
    shakeX,
    shakeZ,
    shakeY,
    scaleY: (1 - squash) * (1 + 0.02 * charge * Math.sin(t * 29)),
    scaleXZ: 1 + squash * 0.6,
    presence,
    charge,
    glow,
    halo,
    ribbonLift,
    burst,
  };
}

/** Progress of the camera's push from the map to the close-up, 0..1 (eased). */
export function cameraPush(t: number): number {
  return smoother(span(t, T.cameraPush[0], T.cameraPush[1]));
}

/** 0 on the reveal's resting composition, 1 on the centred, closer "boom" framing used for the explosion. */
export function boomAmount(t: number): number {
  return smoother(span(t, CONVERGENCE_TIMES.boom[0], CONVERGENCE_TIMES.boom[1])) * (1 - smoother(span(t, CONVERGENCE_TIMES.burst[1] - 0.05, CONVERGENCE_TIMES.reveal[1])));
}

/**
 * The camera's shake as offsets in its own frame (world units, radians for
 * roll): a tremor that grows with the charge and a hard hit that fades over
 * about a second at the burst. Never used with reduced motion (that path
 * skips the performance).
 */
export function cameraShake(t: number): { x: number; y: number; roll: number } {
  const T0 = CONVERGENCE_TIMES;
  const charge = Math.pow(span(t, T0.charge[0] + 0.4, T0.burst[0]), 2.2);
  const since = t - T0.burst[0];
  const hit = since >= 0 ? Math.exp(-since * 4.2) * (1 - Math.exp(-since * 60)) : 0;
  const a = 0.012 * charge + 0.34 * hit;
  const n1 = Math.sin(t * 61.7) + 0.6 * Math.sin(t * 97.3 + 1.1);
  const n2 = Math.sin(t * 73.1 + 2.4) + 0.6 * Math.sin(t * 111.7);
  return { x: a * n1, y: a * 0.8 * n2, roll: (0.004 * charge + 0.05 * hit) * Math.sin(t * 53.9 + 0.7) };
}
