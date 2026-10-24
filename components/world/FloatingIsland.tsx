"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "./geometry";
import { mulberry32 } from "./painterly/noise";
import { paint } from "./painterly/materials";
import { cliffTexture, grassTexture } from "./painterly/textures";
import {
  createIslandGeometry,
  MAIN_ISLAND,
  MAIN_PALETTE,
  rimPoints,
  type IslandGeometryOptions,
  type IslandPalette,
  type IslandShape,
} from "./terrain";

export function IslandMesh({
  shape,
  palette,
  detail,
  shadows = true,
}: {
  shape: IslandShape;
  palette: IslandPalette;
  detail?: IslandGeometryOptions;
  shadows?: boolean;
}) {
  const geometry = useMemo(() => createIslandGeometry(shape, palette, detail), [shape, palette, detail]);
  const materials = useMemo(
    () => [
      paint("island-grass", { map: grassTexture(), vertexColors: true }),
      paint("island-cliff", { map: cliffTexture(), vertexColors: true }),
    ],
    [],
  );
  return <mesh geometry={geometry} material={materials} receiveShadow={shadows} castShadow={shadows} />;
}

/** Thin vines and moss curtains draping over the rim. */
function HangingVines() {
  const geometry = useMemo(() => {
    const rng = mulberry32(5);
    const geos: THREE.BufferGeometry[] = [];
    const blooms: THREE.BufferGeometry[] = [];
    const pts = rimPoints(MAIN_ISLAND, 64, 1.0);
    for (const p of pts) {
      // Vines cluster on the camera-facing side.
      if (Math.sin(p.theta) < -0.2 || rng() < 0.62) continue;
      const strands = 1 + Math.floor(rng() * 3);
      for (let s = 0; s < strands; s++) {
        const len = 0.6 + rng() * 2.2;
        const out = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(0.12);
        const ox = (rng() - 0.5) * 0.35;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(p.x + ox, p.y + 0.02, p.z),
          new THREE.Vector3(p.x + ox + out.x, p.y - 0.12, p.z + out.z),
          new THREE.Vector3(p.x + ox + out.x * 1.3, p.y - len * 0.5, p.z + out.z * 1.3),
          new THREE.Vector3(p.x + ox + out.x * 0.9 + (rng() - 0.5) * 0.2, p.y - len, p.z + out.z * 0.9),
        ]);
        geos.push(new THREE.TubeGeometry(curve, 12, 0.012 + rng() * 0.01, 4, false));
        // Leaf dabs along the vine.
        for (let k = 0; k < 2 + len * 2.5; k++) {
          const leaf = new THREE.IcosahedronGeometry(0.03 + rng() * 0.035, 0);
          const pos = curve.getPoint(rng());
          leaf.scale(1.4, 0.8, 1);
          leaf.translate(pos.x, pos.y, pos.z);
          geos.push(leaf);
        }
        // Some vines flower.
        if (rng() > 0.55) {
          for (let k = 0; k < 2 + len; k++) {
            const pos = curve.getPoint(0.15 + rng() * 0.8);
            blooms.push(new THREE.IcosahedronGeometry(0.035 + rng() * 0.015, 0).translate(pos.x + 0.03, pos.y, pos.z + 0.03));
          }
        }
      }
    }
    return { vines: mergeGeometries(geos), blooms: mergeGeometries(blooms) };
  }, []);
  return (
    <>
      <mesh geometry={geometry.vines} material={paint("vine", { color: "#4d7d3a" })} castShadow />
      <mesh geometry={geometry.blooms} material={paint("vine-bloom", { color: "#f6b7c6" })} />
    </>
  );
}

/** Instanced grass tufts and small rocks; one draw call each. */
function GroundScatter() {
  const tufts = useRef<THREE.InstancedMesh>(null);
  const rocks = useRef<THREE.InstancedMesh>(null);
  const tuftGeo = useMemo(() => {
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const blade = new THREE.ConeGeometry(0.045, 0.34 + (i % 3) * 0.08, 3, 1);
      blade.translate(0, 0.17, 0);
      blade.rotateZ((i - 2) * 0.22);
      blade.rotateY(i * 1.3);
      geos.push(blade);
    }
    return mergeGeometries(geos);
  }, []);

  useLayoutEffect(() => {
    const rng = mulberry32(17);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const color = new THREE.Color();
    const tones = ["#5d9440", "#79ad4b", "#9cc45b", "#4b7f3a"];
    const rim = rimPoints(MAIN_ISLAND, 220, 0.96);
    const mesh = tufts.current;
    if (mesh) {
      for (let i = 0; i < mesh.count; i++) {
        const p = rim[i % rim.length]!;
        const jitter = 0.3 * rng();
        const x = p.x * (1 - jitter * 0.05) + (rng() - 0.5) * 0.3;
        const z = p.z * (1 - jitter * 0.05) + (rng() - 0.5) * 0.3;
        const s = 0.7 + rng() * 0.8;
        e.set((rng() - 0.5) * 0.3, rng() * Math.PI, (rng() - 0.5) * 0.3);
        m.compose(new THREE.Vector3(x, p.y - 0.03, z), q.setFromEuler(e), new THREE.Vector3(s, s, s));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color.set(tones[Math.floor(rng() * tones.length)]!));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    const rockMesh = rocks.current;
    if (rockMesh) {
      const rimR = rimPoints(MAIN_ISLAND, rockMesh.count, 0.93);
      for (let i = 0; i < rockMesh.count; i++) {
        const p = rimR[(i * 7) % rimR.length]!;
        const s = 0.12 + rng() * 0.28;
        e.set(rng() * 3, rng() * 3, rng() * 3);
        m.compose(new THREE.Vector3(p.x + (rng() - 0.5) * 0.6, p.y + s * 0.2, p.z + (rng() - 0.5) * 0.6), q.setFromEuler(e), new THREE.Vector3(s * 1.3, s * 0.8, s));
        rockMesh.setMatrixAt(i, m);
        rockMesh.setColorAt(i, color.set(["#d8cfc4", "#c4b8bf", "#e6dccb"][i % 3]!));
      }
      rockMesh.instanceMatrix.needsUpdate = true;
      if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
    }
  }, []);

  return (
    <>
      <instancedMesh ref={tufts} args={[tuftGeo, paint("tuft", { wind: 0.5 }), 260]} receiveShadow userData={{ sketch: false }} />
      <instancedMesh ref={rocks} args={[undefined, paint("rock-small", { map: cliffTexture() }), 26]} castShadow receiveShadow userData={{ sketch: 9 }}>
        <dodecahedronGeometry args={[1, 0]} />
      </instancedMesh>
    </>
  );
}

const MAIN_DETAIL: IslandGeometryOptions = { rings: 34, segments: 160, layers: 28, showPath: true };

/**
 * Hand-authored strokes for the storybook tracer: rock strata rings and
 * cracks on the underside, broken grass contours on top, plus sample points
 * where the watercolour first blooms.
 */
function useIslandSketch() {
  return useMemo(() => {
    const { rings = 34, segments = 160, layers = 28 } = MAIN_DETAIL;
    const geo = createIslandGeometry(MAIN_ISLAND, MAIN_PALETTE, MAIN_DETAIL);
    const pos = geo.getAttribute("position");
    geo.dispose();
    const cols = segments + 1;
    const base = (rings + 1) * cols;
    const at = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const rng = mulberry32(91);
    const lines: { group: number; points: THREE.Vector3[] }[] = [];
    for (const k of [3, 7, 11, 16, 21]) {
      lines.push({ group: 2, points: Array.from({ length: cols }, (_, j) => at(base + k * cols + j)) });
    }
    for (let j = 0; j < segments; j += 7) {
      const from = 2 + Math.floor(rng() * 4);
      const to = Math.min(layers, from + 6 + Math.floor(rng() * 10));
      const pts: THREE.Vector3[] = [];
      for (let k = from; k <= to; k++) pts.push(at(base + k * cols + j + Math.round(Math.sin(k) * 0.6)));
      lines.push({ group: 2, points: pts });
    }
    for (const i of [17, 25, 31]) {
      // Broken arcs, not full rings: contours suggested, not ruled.
      let arc: THREE.Vector3[] = [];
      for (let j = 0; j <= segments; j++) {
        if (rng() < 0.06 && arc.length > 6) {
          lines.push({ group: 3, points: arc });
          arc = [];
          j += 4 + Math.floor(rng() * 8);
          continue;
        }
        arc.push(at(i * cols + j).add(new THREE.Vector3(0, 0.03, 0)));
      }
      if (arc.length > 6) lines.push({ group: 3, points: arc });
    }
    const grass: THREE.Vector3[] = [];
    for (let i = 6; i <= rings; i += 7) for (let j = 0; j < segments; j += 16) grass.push(at(i * cols + j));
    const rock: THREE.Vector3[] = [];
    for (let k = 4; k <= layers; k += 6) for (let j = 0; j < segments; j += 20) rock.push(at(base + k * cols + j));
    return { sketch: 1, sketchLines: lines, paintSamples: [{ kind: "grass", points: grass }, { kind: "rock", points: rock }] };
  }, []);
}

export function FloatingIsland() {
  const userData = useIslandSketch();
  return (
    <group userData={userData}>
      <IslandMesh shape={MAIN_ISLAND} palette={MAIN_PALETTE} detail={MAIN_DETAIL} />
      <group userData={{ sketch: 9 }}>
        <HangingVines />
      </group>
      <GroundScatter />
    </group>
  );
}
