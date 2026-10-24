"use client";

import { useFrame } from "@react-three/fiber";
import { type ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { IslandMesh } from "../FloatingIsland";
import { type KitBuilder, kitMaterial } from "../kit";
import { InkOutline } from "../painterly/InkOutline";
import { mulberry32 } from "../painterly/noise";
import { flagCloth, paint } from "../painterly/materials";
import { cloudTexture } from "../painterly/textures";
import { polar, terrainHeight, type IslandPalette, type IslandShape } from "../terrain";
import type { IslandPlacement } from "../worldLayout";

/** Background palette: slightly cooler and paler than the Gift Garden, for atmospheric depth. */
export const FAR_PALETTE: IslandPalette = {
  grassLow: "#6f9a58",
  grassHigh: "#a6c873",
  grassSun: "#cfe08c",
  rim: "#6b9258",
  path: "#d8c9a6",
  strata: [
    [0, "#7c9a5c"],
    [0.08, "#b9a07a"],
    [0.22, "#d2ae8c"],
    [0.42, "#c8b2b6"],
    [0.7, "#a4a2c8"],
    [1, "#8d8cb6"],
  ],
};

export const MID_PALETTE: IslandPalette = {
  grassLow: "#5a9242",
  grassHigh: "#94c35a",
  grassSun: "#c8dc78",
  rim: "#55853e",
  path: "#d6c39c",
  strata: [
    [0, "#64903f"],
    [0.06, "#8d8a4c"],
    [0.14, "#b07e56"],
    [0.3, "#d4a67a"],
    [0.5, "#c3a094"],
    [0.75, "#9b93b8"],
    [1, "#716c9c"],
  ],
};

export const MID_DETAIL = { rings: 18, segments: 96, layers: 18 };
export const FAR_DETAIL = { rings: 12, segments: 72, layers: 14 };

/** Ground height on a background island, in its local frame. */
export const groundOn = (shape: IslandShape, x: number, z: number) => terrainHeight(shape, x, z);

export function insideIsland(shape: IslandShape, x: number, z: number, margin = 0.88) {
  return polar(shape, x, z).f < margin;
}

/** Renders a built kit: one mesh per shared material, optionally inked. */
export function KitMeshes({ build, outline = "fine", shadows = false }: { build: () => KitBuilder; outline?: "fine" | "medium" | false; shadows?: boolean }) {
  const parts = useMemo(() => build().build(), [build]);
  return <KitParts parts={parts} outline={outline} shadows={shadows} />;
}

export function KitParts({ parts, outline = "fine", shadows = false }: { parts: ReturnType<KitBuilder["build"]>; outline?: "fine" | "medium" | false; shadows?: boolean }) {
  return (
    <>
      {parts.map(({ kind, geometry }) => (
        <mesh key={kind} geometry={geometry} material={kitMaterial(kind)} castShadow={shadows} receiveShadow={shadows}>
          {outline && kind !== "glow" && kind !== "leaf" && <InkOutline weight={outline} color="#3d2c35" opacity={0.6} />}
          {outline && kind === "leaf" && <InkOutline weight="fine" color="#223a2a" opacity={0.4} />}
        </mesh>
      ))}
    </>
  );
}

/** Island root: placement, gentle bob, and the painted rock itself. */
export function FloatingPlacement({
  placement,
  palette,
  detail,
  animate,
  scale = 1,
  children,
}: {
  placement: IslandPlacement;
  scale?: number;
  palette: IslandPalette;
  detail: typeof MID_DETAIL;
  animate: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const [amp, speed, phase] = placement.bob;
  useFrame(({ clock }) => {
    if (animate && ref.current) ref.current.position.y = Math.sin(clock.elapsedTime * speed + phase) * amp;
  });
  return (
    <group position={placement.position} rotation={[0, placement.rotationY, 0]} scale={scale} userData={{ sketch: 8, sketchRegion: true }}>
      <group ref={ref}>
        <IslandMesh shape={placement.shape} palette={palette} detail={detail} shadows={false} />
        {children}
      </group>
    </group>
  );
}

const flagGeometry = (() => {
  let g: THREE.BufferGeometry | null = null;
  return () => {
    if (g) return g;
    g = new THREE.PlaneGeometry(1, 0.5, 8, 2).translate(0.5, -0.25, 0);
    const pos = g.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      // Pennant: taper the fly end toward the centre line.
      const x = pos.getX(i);
      pos.setY(i, -0.25 + (pos.getY(i) + 0.25) * (1 - x * 0.55));
      col.set([1, 1, 1], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  };
})();

/** Pole with a fluttering pennant; flutter runs on the GPU from the shared wind clock. */
export function Flag({ position, height = 0.6, size = 0.32, color, rotationY = 0 }: { position: THREE.Vector3Tuple; height?: number; size?: number; color: string; rotationY?: number }) {
  const mat = useMemo(() => {
    const m = flagCloth().clone();
    m.color.set(color);
    m.onBeforeCompile = flagCloth().onBeforeCompile;
    m.customProgramCacheKey = flagCloth().customProgramCacheKey;
    return m;
  }, [color]);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, height / 2, 0]} material={paint("iron", { color: "#4b3d4c" })}>
        <cylinderGeometry args={[0.012, 0.014, height, 4]} />
      </mesh>
      <mesh geometry={flagGeometry()} material={mat} position={[0, height, 0]} scale={size} />
    </group>
  );
}

/** Soft cloud puffs hugging an island's underside, drifting very slowly. */
export function CloudSkirt({ radius, depth, count = 5, seed, animate, opacity = 0.9, y = 0 }: { radius: number; depth: number; count?: number; seed: number; animate: boolean; opacity?: number; y?: number }) {
  const specs = useMemo(() => {
    const rng = mulberry32(seed);
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + rng();
      const r = radius * (0.6 + rng() * 0.6);
      return {
        p: [Math.cos(a) * r, y - depth * (0.35 + rng() * 0.45), Math.sin(a) * r * 0.8] as THREE.Vector3Tuple,
        w: radius * (1.5 + rng() * 1.3),
        tex: Math.floor(rng() * 9),
        warm: rng() > 0.5,
        phase: rng() * 6,
      };
    });
  }, [radius, depth, count, seed, y]);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  useFrame(({ clock }) => {
    if (!animate) return;
    const t = clock.elapsedTime;
    specs.forEach((s, i) => {
      const sp = refs.current[i];
      if (sp) sp.position.x = s.p[0] + Math.sin(t * 0.07 + s.phase) * radius * 0.25;
    });
  });
  return (
    <>
      {specs.map((s, i) => (
        <sprite
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={s.p}
          scale={[s.w, s.w * 0.5, 1]}
        >
          <spriteMaterial map={cloudTexture(s.tex, s.warm)} transparent depthWrite={false} opacity={opacity} />
        </sprite>
      ))}
    </>
  );
}

const HEAD_COLORS = ["#f6b7c6", "#ffffff", "#ffe08a", "#ef9a86", "#c9b6ee", "#fff4d6"];

/** Instanced flower dots scattered on an island top; one draw call. */
export function IslandFlowers({ shape, count, seed, colors = HEAD_COLORS, avoid }: { shape: IslandShape; count: number; seed: number; colors?: string[]; avoid?: (x: number, z: number) => boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rng = mulberry32(seed);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const drifts = Array.from({ length: 6 }, () => ({ a: rng() * Math.PI * 2, r: 0.3 + rng() * 0.55, c: Math.floor(rng() * colors.length) }));
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < count * 20) {
      const d = drifts[Math.floor(rng() * drifts.length)]!;
      const x = Math.cos(d.a) * d.r * shape.radius * shape.stretch + (rng() - 0.5) * shape.radius * 0.5;
      const z = Math.sin(d.a) * d.r * shape.radius + (rng() - 0.5) * shape.radius * 0.5;
      if (!insideIsland(shape, x, z) || avoid?.(x, z)) continue;
      const s = 0.6 + rng() * 0.7;
      m.compose(new THREE.Vector3(x, groundOn(shape, x, z) + 0.04, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.7, s));
      mesh.setMatrixAt(placed, m);
      mesh.setColorAt(placed, c.set(colors[rng() < 0.75 ? d.c : Math.floor(rng() * colors.length)]!));
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [shape, count, seed, colors, avoid]);
  return (
    <instancedMesh ref={ref} args={[undefined, paint("far-flower", {}), count]}>
      <icosahedronGeometry args={[0.07, 0]} />
    </instancedMesh>
  );
}
