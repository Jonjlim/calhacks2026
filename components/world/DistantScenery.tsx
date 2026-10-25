"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { CloudCastle } from "./islands/CloudCastle";
import { HangingGardens } from "./islands/HangingGardens";
import { Islets, WatchtowerOutpost } from "./islands/Outposts";
import { FAR_DETAIL, FAR_PALETTE } from "./islands/shared";
import { WindmillVillage } from "./islands/WindmillVillage";
import { IslandMesh } from "./FloatingIsland";
import { fbm, mulberry32 } from "./painterly/noise";
import { flat } from "./painterly/materials";
import { cliffTexture } from "./painterly/textures";
import { useScenePalette } from "./scenePalette";
import { Lantern } from "./props/Lantern";
import { bridgeEnd } from "./props/Stonework";
import { terrainHeight, type IslandShape } from "./terrain";

const ISLET: IslandShape = { seed: 89, radius: 1.25, stretch: 1.15, depth: 2.6, hilliness: 0.3 };

interface Peak {
  x: number;
  width: number;
  height: number;
  /** 0 = rounded hill, 1 = sharp crag. */
  sharp: number;
}

interface Range {
  z: number;
  base: number;
  seed: number;
  peaks: Peak[];
  lit: string;
  shade: string;
  snow: string;
  haze: string;
  /** Height above which peaks catch snow / pale highlights. */
  snowline: number;
}

function ridgeAt(r: Range, x: number) {
  let h = r.base;
  for (const p of r.peaks) {
    const d = Math.abs(x - p.x) / p.width;
    // Blend a soft bell with a sharper, craggy falloff.
    const bell = Math.exp(-0.5 * d * d);
    const crag = Math.exp(-1.6 * Math.pow(d, 1.15));
    h += p.height * (bell * (1 - p.sharp) + crag * p.sharp);
  }
  const ridged = 1 - Math.abs(fbm(x * 0.05, r.seed * 0.31, r.seed, 3) * 2 - 1);
  return h + ridged * 2.2 + fbm(x * 0.22, r.seed, r.seed + 1, 2) * 0.8;
}

/**
 * A mountain range as a vertical strip mesh, so colour can vary inside the
 * silhouette: sun-facing slopes warm, lee slopes cool lavender, pale snow
 * caps on the highest crags, and bases dissolving into haze.
 */
function rangeGeometry(r: Range): THREE.BufferGeometry {
  const step = 1.6;
  const left = -230;
  const right = 230;
  const rows = 14;
  const cols = Math.ceil((right - left) / step) + 1;
  const bottom = r.base - 26;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const lit = new THREE.Color(r.lit);
  const shade = new THREE.Color(r.shade);
  const snow = new THREE.Color(r.snow);
  const haze = new THREE.Color(r.haze);
  const c = new THREE.Color();
  const rng = mulberry32(r.seed);
  for (let i = 0; i < cols; i++) {
    const x = left + i * step;
    const top = ridgeAt(r, x);
    const slope = (ridgeAt(r, x + 0.8) - ridgeAt(r, x - 0.8)) / 1.6;
    // Sun sits right of the view: downhill-to-the-right faces it.
    const sun = THREE.MathUtils.clamp(0.5 - slope * 0.9, 0, 1);
    const streak = rng();
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const y = bottom + (top - bottom) * Math.pow(v, 0.7);
      pos.push(x, y, r.z);
      uv.push(x * 0.02, y * 0.03);
      const face = THREE.MathUtils.smoothstep(v, 0.35, 1) * (0.55 + 0.45 * sun) + (streak - 0.5) * 0.12 * v;
      c.copy(shade).lerp(lit, THREE.MathUtils.clamp(face, 0, 1));
      const snowy = THREE.MathUtils.smoothstep(top - r.snowline, 0, 4) * THREE.MathUtils.smoothstep(v, 0.82, 0.97) * (0.4 + 0.6 * sun);
      c.lerp(snow, snowy);
      c.lerp(haze, 1 - THREE.MathUtils.smoothstep(v, 0.05, 0.6));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < cols - 1; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = a + rows + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const RANGES: Range[] = [
  {
    z: -190,
    base: -30,
    seed: 3,
    peaks: [
      { x: -140, width: 22, height: 14, sharp: 0.6 },
      { x: -88, width: 30, height: 22, sharp: 0.8 },
      { x: -30, width: 20, height: 16, sharp: 0.5 },
      { x: 22, width: 26, height: 30, sharp: 0.9 },
      { x: 78, width: 30, height: 36, sharp: 0.85 },
      { x: 140, width: 24, height: 22, sharp: 0.6 },
    ],
    lit: "#e3d3d8",
    shade: "#a9a9c6",
    snow: "#fbf1ec",
    haze: "#dfe6ef",
    snowline: 0,
  },
  {
    z: -160,
    base: -36,
    seed: 9,
    peaks: [
      { x: -120, width: 26, height: 10, sharp: 0.3 },
      { x: -64, width: 20, height: 16, sharp: 0.7 },
      { x: -14, width: 30, height: 20, sharp: 0.6 },
      { x: 44, width: 22, height: 26, sharp: 0.8 },
      { x: 104, width: 28, height: 18, sharp: 0.5 },
    ],
    lit: "#d8b9b6",
    shade: "#8f88a8",
    snow: "#f8e6dc",
    haze: "#dde3ec",
    snowline: -4,
  },
  {
    z: -138,
    base: -42,
    seed: 15,
    peaks: [
      { x: -132, width: 24, height: 8, sharp: 0.2 },
      { x: -84, width: 22, height: 12, sharp: 0.4 },
      { x: -40, width: 18, height: 14, sharp: 0.6 },
      { x: 12, width: 24, height: 17, sharp: 0.5 },
      { x: 62, width: 20, height: 22, sharp: 0.7 },
      { x: 118, width: 26, height: 12, sharp: 0.3 },
    ],
    lit: "#b8a6a8",
    shade: "#6f7792",
    snow: "#efd6cb",
    haze: "#d6dde8",
    snowline: -8,
  },
];

function Mountains() {
  const geometries = useMemo(() => RANGES.map(rangeGeometry), []);
  // The storybook tracer draws only the ridgelines, not the strip meshes.
  const userData = useMemo(
    () => ({
      sketch: false,
      sketchLines: RANGES.slice(1).map((r) => ({ group: 8, points: Array.from({ length: 231 }, (_, i) => new THREE.Vector3(-230 + i * 2, ridgeAt(r, -230 + i * 2), r.z)) })),
    }),
    [],
  );
  const mat = flat("mountain-strata", "#ffffff", { map: cliffTexture(), vertexColors: true, fog: false });
  const { mountainTint } = useScenePalette().distant;
  // The material is cached and shared, so grade it in place when the time of day changes.
  useEffect(() => {
    mat.color.set(mountainTint);
  }, [mat, mountainTint]);
  return (
    <group userData={userData}>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g} material={mat} />
      ))}
    </group>
  );
}

let hazeTex: THREE.CanvasTexture | null = null;
function hazeTexture() {
  if (hazeTex) return hazeTex;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,0.7)");
  g.addColorStop(0.72, "rgba(255,255,255,1)");
  g.addColorStop(0.86, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  hazeTex = new THREE.CanvasTexture(c);
  hazeTex.colorSpace = THREE.SRGBColorSpace;
  return hazeTex;
}

/** Soft veils of mist between the ranges: cheap atmospheric perspective. */
function HazeVeils() {
  const { hazeTint, hazeOpacity } = useScenePalette().distant;
  const veils = [
    { z: -150, y: -40, h: 36, color: "#e7ecf3", opacity: 0.7 },
    { z: -128, y: -44, h: 30, color: "#eef0f4", opacity: 0.8 },
    { z: -100, y: -36, h: 30, color: "#f1ede9", opacity: 0.55 },
  ];
  return (
    <>
      {veils.map((v, i) => (
        <mesh key={i} position={[0, v.y + v.h / 2, v.z]} renderOrder={-2}>
          <planeGeometry args={[520, v.h]} />
          <meshBasicMaterial map={hazeTexture()} color={hazeTint ?? v.color} transparent opacity={v.opacity * hazeOpacity} depthWrite={false} fog={false} />
        </mesh>
      ))}
    </>
  );
}

/**
 * The far kingdom on every side. The gift map's camera can orbit freely, so the
 * mountain ranges and haze are repeated to the left and right, and the whole
 * set of landmark islands (castle, windmill village, hanging gardens,
 * watchtower) is mirrored behind the viewer's default position. Geometry is
 * built per copy but shares its materials, and none of it is interactive.
 */
export function MapSurround({ animate }: { animate: boolean }) {
  return (
    <group>
      {[Math.PI / 2, -Math.PI / 2].map((turn) => (
        <group key={turn} rotation={[0, turn, 0]}>
          <Mountains />
          <HazeVeils />
        </group>
      ))}
      <group rotation={[0, Math.PI, 0]}>
        <Mountains />
        <HazeVeils />
        <group position={MAP_PUSH}>
          <CloudCastle animate={animate} />
          <WindmillVillage animate={animate} />
          <HangingGardens animate={animate} />
          <WatchtowerOutpost animate={animate} />
        </group>
      </group>
    </group>
  );
}

/** On the gift map the decoration islands drift well back and up into the haze, clear of the rings of memories and gifts. */
const MAP_PUSH: [number, number, number] = [0, 6, -34];

export function DistantScenery({ animate, islets = true }: { animate: boolean; islets?: boolean }) {
  const end = useMemo(() => bridgeEnd(), []);
  return (
    <group>
      <Mountains />
      <HazeVeils />

      <group position={islets ? [0, 0, 0] : MAP_PUSH}>
        <CloudCastle animate={animate} />
        <WindmillVillage animate={animate} />
        <HangingGardens animate={animate} />
        <WatchtowerOutpost animate={animate} />
      </group>
      {islets && <Islets animate={animate} />}

      {/* The islet the plank bridge reaches. */}
      <group position={[end.x + 0.9, end.y - 0.15, end.z + 0.3]} userData={{ sketch: 8 }}>
        <IslandMesh shape={ISLET} palette={FAR_PALETTE} detail={FAR_DETAIL} />
        <Lantern x={-0.5} z={-0.1} y={terrainHeight(ISLET, -0.5, -0.1)} animate={animate} />
      </group>
    </group>
  );
}
