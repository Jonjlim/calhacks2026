import * as THREE from "three";
import { INTRO_TIMES } from "@/components/intro/introTimeline";
import { platformTop } from "./props/Stonework";
import { type CameraPose, GIFT_SPOT, type Vec3 } from "./sceneConfig";

/**
 * Authored live-camera tour, from the storybook framing to the landing view.
 * Position and look-at each follow a centripetal Catmull-Rom spline; time maps
 * onto the knots through a monotone cubic so the camera eases out of rest,
 * never stalls at a knot, and eases into the landing pose.
 */

interface Key {
  t: number;
  position: Vec3;
  target: Vec3;
  fov: number;
}

/** Camera starts moving a beat after the painting begins to fade. */
export const TOUR_START = INTRO_TIMES.enteringWorld + 0.3;

function tourKeys(): Key[] {
  const gy = platformTop() + 1.1;
  const gift: Vec3 = [GIFT_SPOT.x, gy, GIFT_SPOT.z];
  return [
    // Shot A — the push into the painting ends close on the present...
    { t: INTRO_TIMES.giftReveal, position: [2.6, gy + 1.2, 5.6], target: gift, fov: 34 },
    // ...and pulls back to show the platform, parcels and flowers.
    { t: 9.9, position: [4.4, gy + 2.1, 8.6], target: [0.5, gy - 0.5, -0.4], fov: 34 },
    // Shot B — glide left across the garden, past the spirits and the tower.
    { t: 11.0, position: [-3.2, gy + 2.4, 9.4], target: [-1.8, gy - 0.6, -1.2], fov: 36 },
    // Shot C — rise over the tower's shoulder and look out at the wider world.
    { t: 12.2, position: [-10.5, gy + 6.2, 6.5], target: [4, 3.5, -30], fov: 42 },
    { t: 13.3, position: [-3.5, gy + 8.5, 19], target: [6, 1.5, -22], fov: 38 },
  ];
}

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
    const keys: Key[] = [
      { t: TOUR_START, position: start.position, target: start.target, fov: start.fov },
      ...tourKeys(),
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
    // The editorial offset only arrives as the camera returns to the landing view.
    const k = THREE.MathUtils.smoothstep(t, INTRO_TIMES.returningToLanding, INTRO_TIMES.end);
    out.shiftX = THREE.MathUtils.lerp(this.start.shiftX, this.end.shiftX, k);
    out.shiftY = THREE.MathUtils.lerp(this.start.shiftY, this.end.shiftY, k);
  }
}
