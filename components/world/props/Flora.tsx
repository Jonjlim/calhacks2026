"use client";

import { InkOutline } from "@/components/world/painterly/InkOutline";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries, paintByHeight, smoothNormals, wobble } from "../geometry";
import { fbm, mulberry32 } from "../painterly/noise";
import { paint } from "../painterly/materials";
import { foliageTexture, woodTexture } from "../painterly/textures";
import { distToGardenPaths, distToPath, groundAt, MAIN_ISLAND, polar } from "../terrain";
import { GIFT_SPOT } from "../sceneConfig";

const CANOPY_STOPS: [number, string][] = [
  [0, "#24493a"],
  [0.35, "#3e7440"],
  [0.65, "#6fa548"],
  [0.88, "#a9cc5c"],
  [1, "#d9e47a"],
];

export type TreeKind = "round" | "tall" | "windswept" | "blossom";

interface CanopyMass {
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * Branch skeleton for each archetype: where the leaf masses hang. Masses are
 * placed on bough ends rather than around a sphere, so silhouettes come out
 * irregular and asymmetric.
 */
function canopyLayout(kind: TreeKind, seed: number, blobs: number): { masses: CanopyMass[]; trunkH: number; lean: number } {
  const rng = mulberry32(seed * 3 + 11);
  const masses: CanopyMass[] = [];
  if (kind === "tall") {
    const trunkH = 1.5;
    const tiers = Math.max(4, blobs - 2);
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const a = rng() * Math.PI * 2;
      const off = 0.18 * (1 - t) + rng() * 0.08;
      masses.push({ x: Math.cos(a) * off, y: 0.25 + t * 2.3, z: Math.sin(a) * off, r: 0.62 * (1 - t * 0.55) + rng() * 0.08 });
    }
    return { masses, trunkH, lean: 0.04 };
  }
  if (kind === "windswept") {
    const trunkH = 1.55;
    for (let i = 0; i < blobs; i++) {
      const t = i / Math.max(1, blobs - 1);
      // Streamed out to one side, flattened, as if leaning into a steady wind.
      masses.push({ x: -0.3 + t * 1.6 + (rng() - 0.5) * 0.2, y: 0.25 + Math.sin(t * Math.PI) * 0.45 + (rng() - 0.5) * 0.15, z: (rng() - 0.5) * 0.9, r: 0.45 + rng() * 0.32 - t * 0.12 });
    }
    return { masses, trunkH, lean: 0.38 };
  }
  // Round & blossom: a crown of boughs, a big upper mass, smaller lower lobes.
  const trunkH = 1.6 + rng() * 0.2;
  masses.push({ x: 0.1, y: 0.75, z: 0, r: 0.8 + rng() * 0.15 });
  for (let i = 1; i < blobs; i++) {
    const a = (i / (blobs - 1)) * Math.PI * 2 + rng() * 0.8;
    const ring = 0.55 + rng() * 0.45;
    const low = rng();
    masses.push({ x: Math.cos(a) * ring, y: 0.1 + (1 - low) * 0.65, z: Math.sin(a) * ring * 0.85, r: 0.38 + rng() * 0.36 });
  }
  return { masses, trunkH, lean: 0.12 };
}

function leafMass(m: CanopyMass, seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(m.r, 2);
  const pos = g.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    // Leafy lumps: low-frequency bulges plus a finer scalloped edge.
    const lump = fbm(n.x * 1.8 + seed, n.y * 1.8 + n.z * 1.3, seed, 3) - 0.5;
    const scallop = Math.sin(n.x * 9 + seed) * Math.sin(n.z * 8 - seed) * 0.5;
    v.addScaledVector(n, m.r * (lump * 0.42 + scallop * 0.07));
    // Flatter underside, as real canopies have.
    if (v.y < 0) v.y *= 0.62;
    pos.setXYZ(i, v.x, v.y * 0.86, v.z);
  }
  g.translate(m.x, m.y, m.z);
  return g;
}

/** Warm coral-and-gold canopy for the present's tree, in the gift's own palette. */
const AUTUMN_STOPS: [number, string][] = [
  [0, "#a8493a"],
  [0.35, "#d9735e"],
  [0.65, "#e0a24a"],
  [0.88, "#f0c66a"],
  [1, "#fbe7a1"],
];

function canopyGeometry(masses: CanopyMass[], seed: number, stops = CANOPY_STOPS): THREE.BufferGeometry {
  const merged = mergeGeometries(masses.map((m, i) => leafMass(m, seed * 7 + i)));
  smoothNormals(merged);
  paintByHeight(merged, stops, 0.14, seed);
  // Sun-side warmth: lift the +x / top quadrant toward a yellow-green highlight.
  const col = merged.getAttribute("color");
  const nor = merged.getAttribute("normal");
  const warm = new THREE.Color("#d6e27c");
  const c = new THREE.Color();
  for (let i = 0; i < col.count; i++) {
    const lit = Math.max(0, nor.getX(i) * 0.6 + nor.getY(i) * 0.5 - nor.getZ(i) * 0.1);
    c.fromBufferAttribute(col, i).lerp(warm, lit * lit * 0.35);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return merged;
}

function trunkGeometry(height: number, radius: number, bend: number, seed: number, masses: CanopyMass[], lean: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radius * 0.55, radius, height, 9, 8);
  geo.translate(0, height / 2, 0);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / height;
    // Gentle S-curve, a lean for windswept trees, and a flared root base.
    const flare = Math.max(0, 0.18 - y) * 2.2;
    pos.setX(i, pos.getX(i) * (1 + flare) + Math.sin(y * Math.PI) * bend + y * y * lean);
    pos.setZ(i, pos.getZ(i) * (1 + flare) + Math.sin(y * 2.2 + seed) * bend * 0.4);
  }
  geo.computeVertexNormals();
  const parts: THREE.BufferGeometry[] = [wobble(geo, 0.015, seed)];
  // Boughs from the trunk top out to the larger leaf masses (partly visible through gaps).
  const top = new THREE.Vector3(lean, height - 0.05, 0);
  masses
    .filter((m) => m.r > 0.4)
    .slice(0, 5)
    .forEach((m, i) => {
      const end = new THREE.Vector3(m.x * 0.8 + 0.18, height + m.y - m.r * 0.5, m.z * 0.8);
      const mid = top.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.12, 0));
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([top.clone().setY(height - 0.35 - i * 0.05), mid, end]), 6, radius * (0.32 - i * 0.03), 5));
    });
  return mergeGeometries(parts);
}

export interface TreeProps {
  x: number;
  z: number;
  scale?: number;
  seed: number;
  blobs?: number;
  kind?: TreeKind;
  /** `autumn` paints the canopy in the gift's coral and gold. */
  palette?: "green" | "autumn";
  outline?: boolean;
  /** Ground height override when not standing on the main island. */
  y?: number;
}

const BLOSSOM = ["#f6b7c6", "#fde3ea", "#f3a1b0", "#ffffff"];

export function StylizedTree({ x, z, scale = 1, seed, blobs = 7, kind = "round", palette = "green", outline = true, y: groundY }: TreeProps) {
  const { trunk, canopy, blossoms, trunkH } = useMemo(() => {
    const { masses, trunkH, lean } = canopyLayout(kind, seed, blobs);
    let blossoms: THREE.BufferGeometry | null = null;
    if (kind === "blossom") {
      const rng = mulberry32(seed + 99);
      const dots: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 46; i++) {
        const m = masses[i % masses.length]!;
        const a = rng() * Math.PI * 2;
        const e = rng() * 1.2 - 0.25;
        const d = m.r * 0.95;
        dots.push(new THREE.IcosahedronGeometry(0.05 + rng() * 0.04, 0).translate(m.x + Math.cos(a) * Math.cos(e) * d, m.y + Math.sin(e) * d * 0.86, m.z + Math.sin(a) * Math.cos(e) * d));
      }
      blossoms = mergeGeometries(dots);
    }
    return { trunk: trunkGeometry(trunkH, 0.17, 0.18, seed, masses, lean), canopy: canopyGeometry(masses, seed, palette === "autumn" ? AUTUMN_STOPS : CANOPY_STOPS), blossoms, trunkH };
  }, [seed, blobs, kind, palette]);
  const y = (groundY ?? groundAt(x, z)) - 0.05;
  return (
    <group position={[x, y, z]} scale={scale} rotation={[0, seed, 0]} userData={{ sketch: 7, sketchRegion: true }}>
      <mesh geometry={trunk} material={paint("bark", { map: woodTexture(), color: "#8a6a58" })} castShadow receiveShadow>
        {outline && <InkOutline weight="fine" color="#3a2a2e" />}
      </mesh>
      <group position={[0.18, trunkH - 0.05, 0]}>
        <mesh geometry={canopy} material={paint("canopy", { map: foliageTexture(), vertexColors: true, wind: 0.012 })} castShadow receiveShadow>
          {outline && <InkOutline weight="medium" color={palette === "autumn" ? "#6a2e24" : "#20372b"} opacity={0.55} />}
        </mesh>
        {blossoms && <mesh geometry={blossoms} material={paint(`blossom-${seed % BLOSSOM.length}`, { color: BLOSSOM[seed % BLOSSOM.length] })} />}
      </group>
    </group>
  );
}

export function Shrub({ x, z, scale = 1, seed, flowers }: { x: number; z: number; scale?: number; seed: number; flowers?: string }) {
  const geo = useMemo(() => {
    const rng = mulberry32(seed);
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.IcosahedronGeometry(0.35 + rng() * 0.2, 1);
      g.translate((rng() - 0.5) * 0.6, 0.25 + rng() * 0.15, (rng() - 0.5) * 0.5);
      parts.push(g);
    }
    const m = mergeGeometries(parts);
    wobble(m, 0.04, seed);
    return paintByHeight(m, CANOPY_STOPS, 0.1, seed);
  }, [seed]);
  const blooms = useMemo(() => {
    if (!flowers) return null;
    const rng = mulberry32(seed + 5);
    const dots: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2;
      const r = 0.3 + rng() * 0.25;
      dots.push(new THREE.IcosahedronGeometry(0.045 + rng() * 0.025, 0).translate(Math.cos(a) * r, 0.42 + rng() * 0.28, Math.sin(a) * r));
    }
    return mergeGeometries(dots);
  }, [seed, flowers]);
  return (
    <group position={[x, groundAt(x, z) - 0.08, z]} scale={scale} userData={{ sketch: 7 }}>
      <mesh geometry={geo} material={paint("canopy", { map: foliageTexture(), vertexColors: true, wind: 0.012 })} castShadow receiveShadow />
      {blooms && <mesh geometry={blooms} material={paint(`shrub-bloom-${flowers}`, { color: flowers })} />}
    </group>
  );
}

/** Pink, peach, white, lavender and pale yellow wildflowers. */
const FLOWER_COLORS = ["#f6b7c6", "#ffffff", "#fbe7a1", "#f4b496", "#c9b6ee", "#fff4d6", "#f3a1b0", "#dccdf4"];

function isFreeGround(x: number, z: number): boolean {
  const { f } = polar(MAIN_ISLAND, x, z);
  if (f > 0.92) return false;
  if (distToPath(x, z) < 0.55) return false;
  if (distToGardenPaths(x, z) < 0.3) return false;
  if (Math.hypot(x - GIFT_SPOT.x, z - GIFT_SPOT.z) < 2.6) return false;
  return true;
}

/** Instanced meadow flowers in drifts, swaying with the shared wind uniform. */
export function FlowerMeadow({ count = 340 }: { count?: number }) {
  const heads = useRef<THREE.InstancedMesh>(null);
  const stems = useRef<THREE.InstancedMesh>(null);
  const headGeo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const petal = new THREE.SphereGeometry(0.045, 6, 4);
      petal.scale(1, 0.45, 0.7);
      petal.translate(0.045, 0, 0);
      petal.rotateY((k / 5) * Math.PI * 2);
      parts.push(petal);
    }
    const g = mergeGeometries(parts);
    g.translate(0, 0.26, 0);
    return g;
  }, []);
  const stemGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.008, 0.012, 0.26, 3);
    g.translate(0, 0.13, 0);
    return g;
  }, []);

  useLayoutEffect(() => {
    const rng = mulberry32(31);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    const drifts = Array.from({ length: 16 }, () => ({ x: (rng() - 0.5) * 14, z: (rng() - 0.5) * 11, c: Math.floor(rng() * FLOWER_COLORS.length) }));
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < count * 30) {
      const d = drifts[Math.floor(rng() * drifts.length)]!;
      const x = d.x + (rng() - 0.5) * 2.6;
      const z = d.z + (rng() - 0.5) * 2.0;
      if (!isFreeGround(x, z)) continue;
      const s = 0.7 + rng() * 0.7;
      m.compose(new THREE.Vector3(x, groundAt(x, z) - 0.02, z), q.setFromEuler(new THREE.Euler(0, rng() * 6, (rng() - 0.5) * 0.3)), new THREE.Vector3(s, s, s));
      heads.current?.setMatrixAt(placed, m);
      stems.current?.setMatrixAt(placed, m);
      const ci = rng() < 0.7 ? d.c : Math.floor(rng() * FLOWER_COLORS.length);
      heads.current?.setColorAt(placed, color.set(FLOWER_COLORS[ci]!));
      placed++;
    }
    for (const mesh of [heads.current, stems.current]) {
      if (!mesh) continue;
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [count]);

  return (
    <>
      <instancedMesh ref={stems} args={[stemGeo, paint("stem", { color: "#4f8a3a", wind: 1.6 }), count]} receiveShadow userData={{ sketch: false }} />
      <instancedMesh ref={heads} args={[headGeo, paint("flower", { wind: 1.6 }), count]} receiveShadow userData={{ sketch: 9 }} />
    </>
  );
}

/** Taller grass clumps scattered over the meadow (not only along the rim). */
export function MeadowGrass({ count = 420 }: { count?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.ConeGeometry(0.035, 0.26 + (i % 2) * 0.1, 3, 1);
      blade.translate(0, 0.13, 0);
      blade.rotateZ((i - 1.5) * 0.25);
      blade.rotateY(i * 1.6);
      parts.push(blade);
    }
    return mergeGeometries(parts);
  }, []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rng = mulberry32(47);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    const tones = ["#6a9f45", "#86b852", "#a7cb60", "#55893d"];
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < count * 20) {
      const x = (rng() - 0.5) * 16;
      const z = (rng() - 0.5) * 13;
      if (!isFreeGround(x, z)) continue;
      const s = 0.6 + rng() * 0.9;
      m.compose(new THREE.Vector3(x, groundAt(x, z) - 0.02, z), q.setFromEuler(new THREE.Euler(0, rng() * 6, 0)), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(placed, m);
      mesh.setColorAt(placed, color.set(tones[Math.floor(rng() * tones.length)]!));
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count]);
  return <instancedMesh ref={ref} args={[geo, paint("tuft", { wind: 0.5 }), count]} receiveShadow />;
}
