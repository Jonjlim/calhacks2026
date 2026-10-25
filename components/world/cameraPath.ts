import * as THREE from "three";
import { INTRO_TIMES } from "@/components/intro/introTimeline";
import { platformTop } from "./props/Stonework";
import { type CameraPose, GIFT_SPOT, type Vec3 } from "./sceneConfig";

/**
 * Authored live-camera approach, from the storybook framing to the close-up
 * on the present where the opening ends. Position and look-at each follow a
 * centripetal Catmull-Rom spline; time maps onto the knots through a monotone
 * cubic so the camera eases out of rest, never stalls at a knot, and comes to
 * a complete stop on the close-up.
 */

interface Key {
  t: number;
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** Camera starts moving a beat after the painting begins to fade. */
export const TOUR_START = INTRO_TIMES.enteringWorld + 0.3;

/**
 * The opening's resting view: close on the present, its bow and the hanging
 * "Begin" tag, with the tower, spirits and distant islands framing it.
 * Authored at ~16:9; narrower windows step back along the same line of sight
 * so the box and tag never clip.
 */
export function giftClosePose(width: number, height: number): CameraPose {
  const aspect = width / Math.max(1, height);
  const gy = platformTop() + 1.1;
  const target: Vec3 = [GIFT_SPOT.x, gy, GIFT_SPOT.z];
  const position: Vec3 = [2.6, gy + 1.2, 5.6];
  const pull = Math.min(2.6, Math.max(1, Math.pow(1.75 / aspect, 0.85)));
  return {
    position: [target[0] + (position[0] - target[0]) * pull, target[1] + (position[1] - target[1]) * pull, target[2] + (position[2] - target[2]) * pull],
    target,
    fov: 34,
    shiftX: 0,
    shiftY: aspect < 1 ? 0.06 : 0,
  };
}

const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const d = xs.slice(0, -1).map((x, i) => (ys[i + 1]! - ys[i]!) / (xs[i + 1]! - x));
  const m = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1]! * d[i]! <= 0) continue;
    // Harmonic mean (Fritsch–Butland) keeps the mapping monotone.
    m[i] = 2 / (1 / d[i - 1]! + 1 / d[i]!);
  }
  // Zero end tangents: start from rest, settle at rest.
  return m;
}

function hermite(xs: number[], ys: number[], ms: number[], x: number): number {
  if (x <= xs[0]!) return ys[0]!;
  const last = xs.length - 1;
  if (x >= xs[last]!) return ys[last]!;
  let i = 0;
  while (x > xs[i + 1]!) i++;
  const h = xs[i + 1]! - xs[i]!;
  const s = (x - xs[i]!) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * ys[i]! + (s3 - 2 * s2 + s) * h * ms[i]! + (-2 * s3 + 3 * s2) * ys[i + 1]! + (s3 - s2) * h * ms[i + 1]!;
}

const v = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);

export class CameraTour {
  private positions: THREE.CatmullRomCurve3;
  private targets: THREE.CatmullRomCurve3;
  private times: number[];
  private knots: number[];
  private tangents: number[];
  private fovs: number[];
  private fovTangents: number[];
  private start: CameraPose;
  private end: CameraPose;

  constructor(start: CameraPose, end: CameraPose) {
    this.start = start;
    this.end = end;
    // Most of the distance is covered by the time the camera starts settling;
    // the last few percent are a long, gentle ease into the close-up.
    const near = 0.93;
    const keys: Key[] = [
      { t: TOUR_START, position: start.position, target: start.target, fov: start.fov },
      { t: INTRO_TIMES.cameraSettling, position: lerp3(start.position, end.position, near), target: lerp3(start.target, end.target, near), fov: start.fov + (end.fov - start.fov) * near },
      { t: INTRO_TIMES.end, position: end.position, target: end.target, fov: end.fov },
    ];
    this.positions = new THREE.CatmullRomCurve3(keys.map((k) => v(k.position)), false, "centripetal");
    this.targets = new THREE.CatmullRomCurve3(keys.map((k) => v(k.target)), false, "centripetal");
    this.times = keys.map((k) => k.t);
    this.knots = keys.map((_, i) => i / (keys.length - 1));
    this.tangents = monotoneTangents(this.times, this.knots);
    this.fovs = keys.map((k) => k.fov);
    this.fovTangents = monotoneTangents(this.times, this.fovs);
  }

  /** Writes the pose for intro time `t` into `out`. */
  sample(t: number, out: { position: THREE.Vector3; target: THREE.Vector3; fov: number; shiftX: number; shiftY: number }) {
    const u = THREE.MathUtils.clamp(hermite(this.times, this.knots, this.tangents, t), 0, 1);
    this.positions.getPoint(u, out.position);
    this.targets.getPoint(u, out.target);
    out.fov = hermite(this.times, this.fovs, this.fovTangents, t);
    const k = THREE.MathUtils.smoothstep(t, TOUR_START, INTRO_TIMES.end);
    out.shiftX = THREE.MathUtils.lerp(this.start.shiftX, this.end.shiftX, k);
    out.shiftY = THREE.MathUtils.lerp(this.start.shiftY, this.end.shiftY, k);
  }
}
