"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { convergence } from "@/components/convergence/convergenceClock";
import { progress, UNWRAP_TIMES, unwrapClock } from "@/components/unwrap/unwrapTimeline";
import { CONVERGENCE_TIMES } from "@/lib/convergence/timeline";
import { paint } from "../painterly/materials";
import { ribbonTexture } from "../painterly/textures";
import { GIFT_BOX, RIBBON } from "./invitationLayout";

/**
 * The ribbon coming off the present as one continuous strip.
 *
 * The wrapped ribbon is two bands (HeroGiftBox). Both pass through the centre
 * of the lid, so they are really one path: over the top, round the box one
 * way, back over the top, round the other way. This strip starts out lying
 * exactly on that path (so swapping it in for the band meshes changes no
 * pixel), then a peel point runs along it. Everything behind the peel point
 * is free: it lifts off the paper and streams after the pulled end, curling
 * and fluttering, until the whole length has come away and sweeps offscreen.
 * One dynamic mesh rebuilt per frame; no physics.
 */

/** The band meshes hand over to this strip once the bow has collapsed into the knot. */
export const RIBBON_SWAP = UNWRAP_TIMES.ribbonPull + 0.4;
/** Free end already pulled out of the knot when the strip takes over. */
const LEAD = 0.9;
const STEP = 0.035;

interface PathSample {
  p: THREE.Vector3;
  across: THREE.Vector3;
  normal: THREE.Vector3;
}

/** A band's rounded-rectangle loop, starting and ending at the centre of the lid, resampled at `STEP`. */
function bandLoop(halfA: number, halfB: number, plane: "xy" | "zy"): PathSample[] {
  const r = 0.07;
  const raw: [number, number, number, number][] = []; // u, v, normal u, normal v
  const line = (u0: number, v0: number, u1: number, v1: number, nu: number, nv: number) => {
    for (let k = 0; k < 12; k++) raw.push([u0 + ((u1 - u0) * k) / 12, v0 + ((v1 - v0) * k) / 12, nu, nv]);
  };
  const arc = (cu: number, cv: number, a0: number) => {
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k / 8) * (Math.PI / 2);
      raw.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
    }
  };
  const a = halfA - r;
  const b = halfB - r;
  line(0, halfB, -a, halfB, 0, 1);
  arc(-a, b, Math.PI / 2);
  line(-halfA, b, -halfA, -b, -1, 0);
  arc(-a, -b, Math.PI);
  line(-a, -halfB, a, -halfB, 0, -1);
  arc(a, -b, (Math.PI * 3) / 2);
  line(halfA, -b, halfA, b, 1, 0);
  arc(a, b, 0);
  line(a, halfB, 0, halfB, 0, 1);
  raw.push([0, halfB, 0, 1]);

  const lift = GIFT_BOX.height / 2;
  const to3 = (u: number, v: number) => (plane === "xy" ? new THREE.Vector3(u, v + lift, 0) : new THREE.Vector3(0, v + lift, u));
  const norm3 = (u: number, v: number) => (plane === "xy" ? new THREE.Vector3(u, v, 0) : new THREE.Vector3(0, v, u)).normalize();
  const across = plane === "xy" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const pts = raw.map(([u, v]) => to3(u, v));
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const n = Math.max(2, Math.round(curve.getLength() / STEP));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const p = curve.getPointAt(t);
    const k = Math.min(raw.length - 1, Math.round(t * (raw.length - 1)));
    const [, , nu, nv] = raw[k]!;
    return { p, across, normal: norm3(nu, nv) };
  });
}

const easeInOut = (x: number) => x * x * (3 - 2 * x);

/** What drives the unravelling: the chapter-2 unwrap on the homepage, or the gift reveal's ribbon-off. */
export interface UnravelClock {
  on(): boolean;
  t(): number;
  run(): number;
  swap: number;
  peeled: number;
  gone: number;
}

const unwrapUnravel: UnravelClock = {
  on: () => unwrapClock.active && !unwrapClock.staticPreview,
  t: () => unwrapClock.t,
  run: () => unwrapClock.run,
  swap: RIBBON_SWAP,
  peeled: UNWRAP_TIMES.ribbonPeeled,
  gone: UNWRAP_TIMES.ribbonGone,
};

/** The same peel, quicker: the bow collapses, then the strip comes away just before the burst. */
export const CONVERGENCE_RIBBON_SWAP = CONVERGENCE_TIMES.ribbonOff[0] + 0.35;
export const convergenceUnravel: UnravelClock = {
  on: () => convergence.active && !convergence.instant && !convergence.leaving,
  t: () => convergence.t,
  run: () => convergence.run,
  swap: CONVERGENCE_RIBBON_SWAP,
  peeled: CONVERGENCE_TIMES.ribbonOff[1] - 0.2,
  gone: CONVERGENCE_TIMES.ribbonOff[1] + 0.25,
};

export function RibbonUnravel({ driver = unwrapUnravel }: { driver?: UnravelClock }) {
  const mesh = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const path = useMemo(() => {
    const W = GIFT_BOX.width;
    const H = GIFT_BOX.height;
    // Outer band first (it lies on top), then the inner one.
    const outer = bandLoop(W / 2 + RIBBON.insetZ, H / 2 + RIBBON.insetZ, "zy");
    const inner = bandLoop(W / 2 + RIBBON.insetX, H / 2 + RIBBON.insetX, "xy");
    return [...outer, ...inner.slice(1)];
  }, []);
  const rows = path.length + Math.round(LEAD / STEP);
  const length = (path.length - 1) * STEP;

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rows * 2 * 3), 3));
    const uv = new Float32Array(rows * 2 * 2);
    for (let i = 0; i < rows; i++) {
      // Same UV scale as the wrapped bands, so the satin texture doesn't jump at the swap.
      const u = ((rows - 1 - i) * STEP) / (RIBBON.width * 3);
      uv.set([u, 0, u, 1], i * 4);
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const index: number[] = [];
    for (let i = 0; i < rows - 1; i++) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    g.setIndex(index);
    return g;
  }, [rows]);
  const material = useMemo(() => paint("gift-ribbon-strip", { map: ribbonTexture(), color: "#ffffff", side: THREE.DoubleSide }), []);

  const tmp = useMemo(
    () => ({
      pull: new THREE.Vector3(),
      side: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      v: new THREE.Vector3(),
      a: new THREE.Vector3(),
      twist: new THREE.Vector3(),
      anchor: new THREE.Vector3(),
      run: -1,
    }),
    [],
  );

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const c = driver;
    const now = c.t();
    const on = c.on() && now >= c.swap && now < c.gone;
    m.visible = on;
    if (!on) return;
    const parent = m.parent;
    if (!parent) return;

    // The pull heads up and across the left of the scene, a little toward the viewer, and out of frame.
    if (tmp.run !== c.run()) {
      tmp.run = c.run();
      camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const back = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
      const world = new THREE.Vector3(0, 1, 0).addScaledVector(right, -0.45).addScaledVector(back, 0.35).normalize();
      parent.getWorldQuaternion(tmp.q).invert();
      tmp.pull.copy(world).applyQuaternion(tmp.q).normalize();
      tmp.side.copy(right).applyQuaternion(tmp.q).projectOnPlane(tmp.pull).normalize();
    }

    const time = clock.elapsedTime;
    const peel = length * easeInOut(progress(now, c.swap, c.peeled));
    const fly = progress(now, c.peeled - 0.25, c.gone);
    const flyDist = fly * fly * 14;

    // Where the ribbon is still lying on the box.
    const pi = Math.min(path.length - 1, peel / STEP);
    const i0 = Math.floor(pi);
    const at = path[i0]!;
    const next = path[Math.min(path.length - 1, i0 + 1)]!;
    tmp.anchor.copy(at.p).lerp(next.p, pi - i0).addScaledVector(tmp.pull, flyDist);
    const normal = at.normal;

    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const lead = rows - path.length;
    const hw = RIBBON.width / 2;
    for (let row = 0; row < rows; row++) {
      // Rows run from the free end (row 0) to the last point that leaves the box.
      const s = (row - lead) * STEP;
      let across: THREE.Vector3;
      if (s > peel && row >= lead) {
        const sample = path[row - lead]!;
        tmp.v.copy(sample.p);
        across = sample.across;
      } else {
        const d = peel - s;
        const reach = Math.min(1, d);
        const curl = d * 0.32;
        // Lifts off the paper, streams after the pull with a slow S-curve, and flutters at the end.
        tmp.v
          .copy(tmp.anchor)
          .addScaledVector(normal, 0.16 * (1 - Math.exp(-d * 3)) + (1 - Math.cos(curl)) * 0.7)
          .addScaledVector(tmp.pull, d * 0.92)
          .addScaledVector(tmp.side, Math.sin(curl) * 0.85 + Math.sin(d * 2.6 - time * 6.5) * 0.11 * reach)
          .addScaledVector(normal, Math.cos(d * 2.1 - time * 5) * 0.07 * reach);
        tmp.twist.copy(tmp.side).applyAxisAngle(tmp.pull, Math.sin(d * 1.3 - time * 3) * 0.55);
        across = tmp.a.copy(at.across).lerp(tmp.twist, Math.min(1, d * 2)).normalize();
      }
      pos.setXYZ(row * 2, tmp.v.x - across.x * hw, tmp.v.y - across.y * hw, tmp.v.z - across.z * hw);
      pos.setXYZ(row * 2 + 1, tmp.v.x + across.x * hw, tmp.v.y + across.y * hw, tmp.v.z + across.z * hw);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return <mesh ref={mesh} geometry={geometry} material={material} visible={false} frustumCulled={false} castShadow />;
}
