/**
 * QA: camera composition math used by the landing + intro
 * (components/world/sceneConfig.ts, cameraPath.ts). Pure functions only.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { INTRO_TIMES } from "../../components/intro/introTimeline";
import { CameraTour, TOUR_START } from "../../components/world/cameraPath";
import { type CameraPose, landingPose, OPENING_CAMERA, storybookPose } from "../../components/world/sceneConfig";

const VIEWPORTS: [string, number, number][] = [
  ["iPhone SE", 375, 667],
  ["iPhone 14", 390, 844],
  ["tablet portrait", 768, 1024],
  ["laptop", 1440, 900],
  ["1080p", 1920, 1080],
  ["ultrawide", 3440, 1440],
];

const finite = (n: number) => Number.isFinite(n);
const poseIsSane = (p: CameraPose) =>
  [...p.position, ...p.target, p.fov, p.shiftX, p.shiftY].every(finite) && p.fov > 15 && p.fov < 70 && Math.abs(p.shiftX) < 0.5 && Math.abs(p.shiftY) < 0.5;
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("responsive camera poses", () => {
  it.each(VIEWPORTS)("landingPose and storybookPose are finite and sane at %s (%ix%i)", (_n, w, h) => {
    expect(poseIsSane(landingPose(w, h))).toBe(true);
    expect(poseIsSane(storybookPose(w, h))).toBe(true);
  });

  it("is deterministic", () => {
    expect(landingPose(1440, 900)).toEqual(landingPose(1440, 900));
  });

  it("does not produce NaN/Infinity for a zero-height viewport", () => {
    expect(poseIsSane(landingPose(1440, 0))).toBe(true);
    expect(poseIsSane(landingPose(0, 900))).toBe(true);
    expect(poseIsSane(storybookPose(1440, 0))).toBe(true);
  });

  // DEFECT QA-1 (components/world/sceneConfig.ts storybookPose): aspect = 0 makes
  // `pull = 1.5 / aspect` Infinity, so the camera position becomes non-finite. WorldCamera
  // calls storybookPose(size.width, size.height), so a zero-width canvas (hidden or not yet
  // laid out) would feed a NaN pose into CameraTour. `it.fails` keeps CI green while the defect
  // exists and turns red the moment it is fixed, at which point switch this to a normal `it`.
  it.fails("DEFECT QA-1: storybookPose stays finite for a zero-width viewport", () => {
    expect(poseIsSane(storybookPose(0, 900))).toBe(true);
  });

  it("centres the island (no horizontal shift) on a phone-portrait viewport, where the copy sits above it", () => {
    expect(landingPose(390, 844).shiftX).toBe(0);
  });

  it("reserves room for the left editorial column on desktop (island pushed right)", () => {
    expect(landingPose(1440, 900).shiftX).toBeGreaterThan(0.1);
  });

  it("steps the camera back on narrow screens compared with the opening composition", () => {
    const base = dist(OPENING_CAMERA.position, OPENING_CAMERA.target);
    expect(dist(landingPose(390, 844).position, OPENING_CAMERA.target)).toBeGreaterThan(base);
  });

  it("looks at the same target regardless of aspect ratio", () => {
    for (const [, w, h] of VIEWPORTS) expect(landingPose(w, h).target).toEqual(OPENING_CAMERA.target);
  });
});

describe("CameraTour (intro flythrough)", () => {
  const start = landingPose(1440, 900);
  // Tour starts from the storybook framing and returns to the landing framing.
  const from = storybookPose(1440, 900);
  const tour = new CameraTour(from, start);
  const out = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 0, shiftX: 0, shiftY: 0 };
  const sample = (t: number) => {
    tour.sample(t, out);
    return { p: out.position.clone(), g: out.target.clone(), fov: out.fov, shiftX: out.shiftX, shiftY: out.shiftY };
  };

  it("starts exactly on the storybook pose and ends exactly on the landing pose", () => {
    const a = sample(TOUR_START);
    expect(a.p.distanceTo(new THREE.Vector3(...from.position))).toBeLessThan(1e-6);
    expect(a.fov).toBeCloseTo(from.fov, 6);
    const z = sample(INTRO_TIMES.end);
    expect(z.p.distanceTo(new THREE.Vector3(...start.position))).toBeLessThan(1e-6);
    expect(z.fov).toBeCloseTo(start.fov, 6);
    expect(z.shiftX).toBeCloseTo(start.shiftX, 6);
    expect(z.shiftY).toBeCloseTo(start.shiftY, 6);
  });

  it("clamps outside the tour window instead of extrapolating", () => {
    const early = sample(-5);
    const first = sample(TOUR_START);
    expect(early.p.distanceTo(first.p)).toBeLessThan(1e-6);
    const late = sample(INTRO_TIMES.end + 10);
    const last = sample(INTRO_TIMES.end);
    expect(late.p.distanceTo(last.p)).toBeLessThan(1e-6);
  });

  it("every sample is finite and keeps the field of view in a sensible range", () => {
    for (let t = TOUR_START; t <= INTRO_TIMES.end; t += 0.05) {
      const s = sample(t);
      expect([s.p.x, s.p.y, s.p.z, s.g.x, s.g.y, s.g.z, s.fov, s.shiftX, s.shiftY].every(finite), `t=${t}`).toBe(true);
      expect(s.fov, `fov at t=${t}`).toBeGreaterThan(25);
      expect(s.fov, `fov at t=${t}`).toBeLessThan(50);
    }
  });

  it("moves continuously: no single 1/60s step jumps the camera more than a few units", () => {
    let prev = sample(TOUR_START).p;
    let worst = 0;
    for (let t = TOUR_START + 1 / 60; t <= INTRO_TIMES.end; t += 1 / 60) {
      const cur = sample(t).p;
      worst = Math.max(worst, cur.distanceTo(prev));
      prev = cur;
    }
    expect(worst).toBeLessThan(1);
  });

  it("eases in and out (near-rest at both ends of the tour)", () => {
    const step = (t: number) => sample(t + 1 / 60).p.distanceTo(sample(t).p);
    const mid = step((TOUR_START + INTRO_TIMES.end) / 2);
    expect(step(TOUR_START)).toBeLessThan(mid);
    expect(step(INTRO_TIMES.end - 1 / 60)).toBeLessThan(mid);
  });

  it("only applies the editorial offset as the camera returns to the landing view", () => {
    expect(sample(INTRO_TIMES.giftReveal).shiftX).toBeCloseTo(from.shiftX, 6);
    expect(sample(INTRO_TIMES.returningToLanding - 0.01).shiftX).toBeCloseTo(from.shiftX, 3);
  });
});
