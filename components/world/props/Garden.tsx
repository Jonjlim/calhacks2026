"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { InkOutline } from "../painterly/InkOutline";
import { wobble } from "../geometry";
import { KitBuilder } from "../kit";
import { KitParts } from "../islands/shared";
import { mulberry32 } from "../painterly/noise";
import { flat, paint } from "../painterly/materials";
import { stoneTexture } from "../painterly/textures";
import { GIFT_SPOT } from "../sceneConfig";
import { groundAt } from "../terrain";
import { platformTop } from "./Stonework";

const INK = "#3d2c35";

function fillInstances(mesh: THREE.InstancedMesh | null, items: { m: THREE.Matrix4; c?: THREE.ColorRepresentation }[]) {
  if (!mesh) return;
  const color = new THREE.Color();
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    if (it.c) mesh.setColorAt(i, color.set(it.c));
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

const compose = (x: number, y: number, z: number, ry: number, s: THREE.Vector3Tuple, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));

/** Irregular stepping stones along a curve, with moss and tiny flowers tucked between them. */
export function SteppingStones({ points, seed, spacing = 0.42 }: { points: [number, number][]; seed: number; spacing?: number }) {
  const stones = useRef<THREE.InstancedMesh>(null);
  const moss = useRef<THREE.InstancedMesh>(null);
  const buds = useRef<THREE.InstancedMesh>(null);
  const max = 40;
  useLayoutEffect(() => {
    const rng = mulberry32(seed);
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal");
    const len = curve.getLength();
    const s: { m: THREE.Matrix4; c: string }[] = [];
    const mo: { m: THREE.Matrix4; c: string }[] = [];
    const bu: { m: THREE.Matrix4; c: string }[] = [];
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let d = 0.1; d < len && s.length < max; d += spacing * (0.8 + rng() * 0.45)) {
      curve.getPointAt(d / len, p);
      curve.getTangentAt(d / len, tan);
      const side = (rng() - 0.5) * 0.18;
      const x = p.x - tan.z * side;
      const z = p.z + tan.x * side;
      const size = 0.75 + rng() * 0.55;
      s.push({ m: compose(x, groundAt(x, z) + 0.015, z, rng() * 6, [size, 1, size * (0.75 + rng() * 0.3)], (rng() - 0.5) * 0.06), c: ["#f1e9dc", "#e5dccf", "#ece2cf", "#ddd5cc"][s.length % 4]! });
      for (let k = 0; k < 2; k++) {
        const a = rng() * Math.PI * 2;
        const mx = x + Math.cos(a) * 0.24;
        const mz = z + Math.sin(a) * 0.24;
        mo.push({ m: compose(mx, groundAt(mx, mz) + 0.01, mz, a, [0.7 + rng() * 0.6, 0.35, 0.5 + rng() * 0.4]), c: rng() > 0.5 ? "#6f9a45" : "#8cb256" });
      }
      if (rng() > 0.45) {
        const a = rng() * Math.PI * 2;
        const bx = x + Math.cos(a) * 0.27;
        const bz = z + Math.sin(a) * 0.27;
        bu.push({ m: compose(bx, groundAt(bx, bz) + 0.06, bz, 0, [1, 1, 1]), c: ["#ffffff", "#f6b7c6", "#fbe7a1", "#c9b6ee"][Math.floor(rng() * 4)]! });
      }
    }
    fillInstances(stones.current, s);
    fillInstances(moss.current, mo);
    fillInstances(buds.current, bu);
  }, [points, seed, spacing]);
  const stoneGeo = useMemo(() => wobble(new THREE.CylinderGeometry(0.17, 0.19, 0.07, 7, 1), 0.025, seed), [seed]);
  return (
    <>
      <instancedMesh ref={stones} args={[stoneGeo, paint("stone-cap", { map: stoneTexture(), color: "#f6f1ea" }), max]} castShadow receiveShadow userData={{ sketch: 5 }} />
      <instancedMesh ref={moss} args={[undefined, paint("moss", {}), max * 2]} receiveShadow>
        <sphereGeometry args={[0.09, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </instancedMesh>
      <instancedMesh ref={buds} args={[undefined, paint("path-bud", {}), max]}>
        <icosahedronGeometry args={[0.04, 0]} />
      </instancedMesh>
    </>
  );
}

/** A low dry-stone wall following a curve, capped with moss and the odd trailing flower. */
export function GardenWall({ points, seed, height = 2 }: { points: [number, number][]; seed: number; height?: number }) {
  const stones = useRef<THREE.InstancedMesh>(null);
  const caps = useRef<THREE.InstancedMesh>(null);
  const max = 90;
  useLayoutEffect(() => {
    const rng = mulberry32(seed);
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const len = curve.getLength();
    const s: { m: THREE.Matrix4; c: string }[] = [];
    const c: { m: THREE.Matrix4; c: string }[] = [];
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let row = 0; row < height; row++) {
      for (let d = row * 0.09; d < len && s.length < max; d += 0.2 + rng() * 0.06) {
        curve.getPointAt(d / len, p);
        curve.getTangentAt(d / len, tan);
        const ang = -Math.atan2(tan.z, tan.x);
        const y = groundAt(p.x, p.z) + 0.07 + row * 0.13;
        s.push({ m: compose(p.x, y, p.z, ang + (rng() - 0.5) * 0.3, [0.13 + rng() * 0.04, 0.075 + rng() * 0.02, 0.1 + rng() * 0.03], rng() * 0.3, rng() * 0.3), c: ["#e8dfd2", "#d8cec4", "#efe6d8", "#cfc4c0"][Math.floor(rng() * 4)]! });
        if (row === height - 1 && rng() > 0.35) {
          c.push({ m: compose(p.x, y + 0.07, p.z, ang, [1 + rng() * 0.6, 0.45, 0.8]), c: rng() > 0.85 ? "#f6b7c6" : rng() > 0.5 ? "#6f9a45" : "#8cb256" });
        }
      }
    }
    fillInstances(stones.current, s);
    fillInstances(caps.current, c);
  }, [points, seed, height]);
  return (
    <>
      <instancedMesh ref={stones} args={[undefined, paint("wall-stone", { map: stoneTexture() }), max]} castShadow receiveShadow userData={{ sketch: 9 }}>
        <dodecahedronGeometry args={[1, 0]} />
      </instancedMesh>
      <instancedMesh ref={caps} args={[undefined, paint("moss", {}), max]}>
        <sphereGeometry args={[0.09, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </instancedMesh>
    </>
  );
}

const CAP_COLORS = ["#e07a62", "#f2d27a", "#f6efe0", "#d9897a"];

/** Little toadstool clusters at tree roots and along walls. */
export function Mushrooms({ spots, seed }: { spots: [number, number][]; seed: number }) {
  const stems = useRef<THREE.InstancedMesh>(null);
  const capsRef = useRef<THREE.InstancedMesh>(null);
  const max = spots.length * 4;
  useLayoutEffect(() => {
    const rng = mulberry32(seed);
    const st: { m: THREE.Matrix4 }[] = [];
    const cp: { m: THREE.Matrix4; c: string }[] = [];
    for (const [sx, sz] of spots) {
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const x = sx + (rng() - 0.5) * 0.35;
        const z = sz + (rng() - 0.5) * 0.35;
        const s = 0.6 + rng() * 0.8;
        const y = groundAt(x, z) - 0.01;
        const tilt = (rng() - 0.5) * 0.3;
        st.push({ m: compose(x, y, z, 0, [s, s, s], tilt) });
        cp.push({ m: compose(x, y + 0.11 * s, z + tilt * 0.1 * s, rng() * 6, [s, s * (0.7 + rng() * 0.3), s], tilt), c: CAP_COLORS[Math.floor(rng() * CAP_COLORS.length)]! });
      }
    }
    fillInstances(stems.current, st);
    fillInstances(capsRef.current, cp);
  }, [spots, seed]);
  const stemGeo = useMemo(() => new THREE.CylinderGeometry(0.018, 0.026, 0.12, 6).translate(0, 0.06, 0), []);
  const capGeo = useMemo(() => new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1), []);
  return (
    <>
      <instancedMesh ref={stems} args={[stemGeo, paint("mushroom-stem", { color: "#f6eedf" }), max]} />
      <instancedMesh ref={capsRef} args={[capGeo, paint("mushroom-cap", {}), max]} castShadow />
    </>
  );
}

const PARCELS: { a: number; r: number; size: number; paper: string; ribbon: string }[] = [
  { a: 0.55, r: 2.45, size: 0.36, paper: "#c9b6ee", ribbon: "#fff4d6" },
  { a: 0.85, r: 2.6, size: 0.26, paper: "#f6b7c6", ribbon: "#e07a62" },
  { a: 2.55, r: 2.4, size: 0.32, paper: "#a9d3c4", ribbon: "#fbe7a1" },
  { a: 2.85, r: 2.55, size: 0.22, paper: "#fbe7a1", ribbon: "#e07a62" },
];

function buildParcels(): KitBuilder {
  const kit = new KitBuilder();
  for (const p of PARCELS) {
    const x = GIFT_SPOT.x + Math.cos(p.a) * p.r;
    const z = GIFT_SPOT.z + Math.sin(p.a) * p.r;
    kit.at([x, groundAt(x, z) - 0.02, z], p.a * 2, 1, () => {
      const s = p.size;
      kit.add("plain", wobble(new THREE.BoxGeometry(s, s * 0.85, s, 2, 2, 2), 0.004, 3).translate(0, s * 0.425, 0), p.paper, undefined, 0.15);
      kit.add("plain", new THREE.BoxGeometry(s * 1.02, s * 0.87, s * 0.18).translate(0, s * 0.425, 0), p.ribbon);
      kit.add("plain", new THREE.BoxGeometry(s * 0.18, s * 0.87, s * 1.02).translate(0, s * 0.425, 0), p.ribbon);
      for (const side of [-1, 1]) kit.add("plain", new THREE.SphereGeometry(s * 0.16, 8, 6).scale(1.4, 0.8, 0.7).translate(side * s * 0.16, s * 0.9, 0), p.ribbon);
    });
  }
  return kit;
}

const BULB = new THREE.Color("#fff1c6");

let glowTexture: THREE.CanvasTexture | null = null;
function warmGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(255,226,170,0.9)");
  g.addColorStop(0.5, "rgba(255,210,150,0.35)");
  g.addColorStop(1, "rgba(255,200,140,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/**
 * Everything that frames the present without hiding it: a ring of low
 * flowers around the pedestal (left clear at the steps), a few small
 * parcels, fairy lights on garden stakes and a warm glow pooled beneath.
 */
export function GiftSurround({ animate }: { animate: boolean }) {
  const ring = useRef<THREE.InstancedMesh>(null);
  const lights = useRef<THREE.InstancedMesh>(null);
  const parcels = useMemo(() => buildParcels().build(), []);
  const bulb = useMemo(() => flat("fairy-bulb", "#fff1c6"), []);
  useLayoutEffect(() => {
    const rng = mulberry32(808);
    const r: { m: THREE.Matrix4; c: string }[] = [];
    const colors = ["#f4b496", "#fff4d6", "#f6b7c6", "#e07a62", "#ffffff", "#fbe7a1"];
    for (let i = 0; i < 120; i++) {
      const a = rng() * Math.PI * 2;
      // Keep the front steps (toward +z) clear.
      if (Math.abs(a - Math.PI / 2) < 0.42) continue;
      const rad = 2.22 + rng() * 0.32;
      const x = GIFT_SPOT.x + Math.cos(a) * rad;
      const z = GIFT_SPOT.z + Math.sin(a) * rad;
      const s = 0.8 + rng() * 0.6;
      r.push({ m: compose(x, groundAt(x, z) + 0.05 + rng() * 0.05, z, 0, [s, s * 0.8, s]), c: colors[Math.floor(rng() * colors.length)]! });
    }
    fillInstances(ring.current, r);
    const l: { m: THREE.Matrix4 }[] = [];
    for (let i = 0; i < 9; i++) {
      const a = -0.6 + (i / 8) * (Math.PI + 1.2) + Math.PI;
      const x = GIFT_SPOT.x + Math.cos(a) * 2.7;
      const z = GIFT_SPOT.z + Math.sin(a) * 2.5;
      l.push({ m: compose(x, groundAt(x, z) + 0.55, z, 0, [1, 1, 1]) });
    }
    fillInstances(lights.current, l);
  }, []);
  useFrame(({ clock }) => {
    if (!animate) return;
    bulb.color.copy(BULB).multiplyScalar(0.92 + Math.sin(clock.elapsedTime * 1.6) * 0.08);
  });
  const top = platformTop();
  return (
    <group userData={{ sketch: 9 }}>
      <instancedMesh ref={ring} args={[undefined, paint("ring-flower", {}), 120]}>
        <icosahedronGeometry args={[0.065, 0]} />
      </instancedMesh>
      <KitParts parts={parcels} outline="fine" shadows />
      <instancedMesh ref={lights} args={[undefined, bulb, 9]}>
        <sphereGeometry args={[0.045, 8, 6]} />
      </instancedMesh>
      <FairyStakes />
      <mesh position={[GIFT_SPOT.x, top + 0.012, GIFT_SPOT.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <circleGeometry args={[1.5, 32]} />
        <meshBasicMaterial map={warmGlowTexture()} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.55} />
      </mesh>
    </group>
  );
}

function FairyStakes() {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const a = -0.6 + (i / 8) * (Math.PI + 1.2) + Math.PI;
      const x = GIFT_SPOT.x + Math.cos(a) * 2.7;
      const z = GIFT_SPOT.z + Math.sin(a) * 2.5;
      parts.push(new THREE.CylinderGeometry(0.012, 0.016, 0.52, 4).translate(x, groundAt(x, z) + 0.26, z));
    }
    const merged = new THREE.BufferGeometry();
    const all = parts.map((p) => p.toNonIndexed());
    const pos = new Float32Array(all.reduce((n, p) => n + p.getAttribute("position").count * 3, 0));
    let o = 0;
    for (const p of all) {
      pos.set(p.getAttribute("position").array as Float32Array, o);
      o += p.getAttribute("position").count * 3;
    }
    merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    merged.computeVertexNormals();
    return merged;
  }, []);
  return (
    <mesh geometry={geo} material={paint("iron", { color: "#4b3d4c" })}>
      <InkOutline weight="fine" color={INK} opacity={0.4} />
    </mesh>
  );
}
