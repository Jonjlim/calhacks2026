"use client";

import { useFrame } from "@react-three/fiber";
import { useCallback, useMemo } from "react";
import * as THREE from "three";
import { addKitTree, boxGeometry, bushGeometry, KitBuilder } from "../kit";
import { mulberry32 } from "../painterly/noise";
import { paint } from "../painterly/materials";
import { cloudTexture, waterTexture } from "../painterly/textures";
import { OPENING_CAMERA } from "../sceneConfig";
import { rimRadius } from "../terrain";
import { WORLD_LAYOUT } from "../worldLayout";
import { CloudSkirt, FloatingPlacement, groundOn, IslandFlowers, KitMeshes, MID_DETAIL, MID_PALETTE } from "./shared";

const P = WORLD_LAYOUT.gardens;
const SHAPE = P.shape;
const ground = (x: number, z: number) => groundOn(SHAPE, x, z) - 0.05;

const TREE = { x: -0.9, z: -0.7 };
const POND = { x: 1.1, z: 0.5 };

/** The rim bearing that faces the main island, so the waterfall reads from the landing view. */
const FALL_THETA = (() => {
  const [cx, , cz] = OPENING_CAMERA.position;
  const toCamera = new THREE.Vector3(cx - P.position[0], 0, cz - P.position[2]).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -P.rotationY);
  return Math.atan2(toCamera.z, toCamera.x / SHAPE.stretch);
})();
const FALL = (() => {
  const r = rimRadius(SHAPE, FALL_THETA) * 0.985;
  const x = Math.cos(FALL_THETA) * r * SHAPE.stretch;
  const z = Math.sin(FALL_THETA) * r;
  return { x, z, y: groundOn(SHAPE, x, z) };
})();

function tube(points: [number, number, number][], radius: number, segments = 12) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), segments, radius, 6);
}

function buildGarden(): KitBuilder {
  const kit = new KitBuilder();
  const rng = mulberry32(61);
  const ty = ground(TREE.x, TREE.z);

  // The great tree: a twisting trunk that splits into reaching boughs.
  kit.at([TREE.x, ty, TREE.z], 0, 1, () => {
    kit.add("wood", new THREE.CylinderGeometry(0.42, 0.75, 0.5, 9).translate(0, 0.2, 0), "#7d5a48");
    kit.add("wood", tube([[0, 0, 0], [0.15, 0.8, 0.05], [-0.1, 1.7, 0.1], [0.05, 2.5, 0]], 0.32, 16), "#86624e");
    const boughs: [number, number, number][][] = [
      [[0.05, 2.2, 0], [0.8, 2.9, 0.3], [1.7, 3.3, 0.5]],
      [[0, 2.3, 0], [-0.9, 3.0, 0.2], [-1.8, 3.2, -0.2]],
      [[0, 2.4, 0], [0.2, 3.3, -0.7], [0.4, 4.0, -1.2]],
      [[0, 2.4, 0], [-0.2, 3.4, 0.7], [-0.3, 4.1, 1.1]],
      [[0, 2.5, 0], [0.1, 3.6, 0], [0.0, 4.6, 0.1]],
    ];
    for (const b of boughs) kit.add("wood", tube(b, 0.13, 10), "#86624e");
    // Layered canopy masses at the bough ends, darker below, sunlit on top.
    const masses: [number, number, number, number][] = [
      [1.8, 3.2, 0.5, 1.15],
      [-1.9, 3.1, -0.2, 1.2],
      [0.4, 3.9, -1.3, 1.1],
      [-0.3, 4.0, 1.2, 1.05],
      [0.0, 4.6, 0.1, 1.35],
      [0.9, 4.4, 0.6, 0.9],
      [-1.0, 4.4, -0.6, 0.95],
    ];
    masses.forEach(([x, y, z, r], i) => {
      kit.add("leaf", bushGeometry(r, 400 + i, 6).translate(0, -r * 0.6, 0), i % 3 === 0 ? "#5d9a4b" : i % 3 === 1 ? "#77ac52" : "#4f8743", new THREE.Matrix4().makeTranslation(x, y, z), 0.5);
    });
    // Blossom clusters on the canopy surface.
    for (let i = 0; i < 70; i++) {
      const m = masses[i % masses.length]!;
      const a = rng() * Math.PI * 2;
      const e = (rng() - 0.2) * 1.1;
      const r = m[3] * 0.92;
      kit.add("plain", new THREE.IcosahedronGeometry(0.07 + rng() * 0.05, 0), rng() > 0.4 ? "#f6b7c6" : "#fff0f3", new THREE.Matrix4().makeTranslation(m[0] + Math.cos(a) * Math.cos(e) * r, m[1] + Math.sin(e) * r * 0.85, m[2] + Math.sin(a) * Math.cos(e) * r));
    }
  });

  // Mossy ruins: broken columns, a fallen drum and half an arch.
  const ruins: [number, number, number][] = [
    [2.4, -1.4, 1.3],
    [3.0, -0.6, 0.7],
    [2.1, -2.3, 0.95],
  ];
  ruins.forEach(([x, z, h], i) => {
    const y = ground(x, z);
    kit.add("stone", new THREE.CylinderGeometry(0.2, 0.22, h, 10).translate(0, h / 2, 0), "#e8dfd2", new THREE.Matrix4().makeTranslation(x, y, z), 0.25);
    kit.add("stone", boxGeometry(0.55, 0.12, 0.55, i), "#ddd3c3", new THREE.Matrix4().makeTranslation(x, y, z));
    kit.add("leaf", new THREE.IcosahedronGeometry(0.16, 1).scale(1.3, 0.6, 1.3), "#6e9b4c", new THREE.Matrix4().makeTranslation(x, y + h, z));
  });
  kit.add("stone", new THREE.CylinderGeometry(0.2, 0.2, 0.9, 10).rotateZ(Math.PI / 2 - 0.2), "#e2d8ca", new THREE.Matrix4().makeTranslation(3.0, ground(3.0, -1.8) + 0.18, -1.8));
  const arch = new THREE.TorusGeometry(0.75, 0.13, 6, 14, Math.PI * 0.72).rotateZ(0.05);
  kit.add("stone", arch, "#e6dccd", new THREE.Matrix4().compose(new THREE.Vector3(2.0, ground(2.0, 1.9) + 0.05, 1.9), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.7, 0)), new THREE.Vector3(1, 1.2, 1)));
  kit.add("stone", new THREE.CylinderGeometry(0.14, 0.16, 0.9, 8).translate(0, 0.45, 0), "#e6dccd", new THREE.Matrix4().makeTranslation(2.0 + Math.cos(0.7) * 0.75, ground(2.6, 1.4), 1.9 - Math.sin(0.7) * 0.75));

  // Pond and stream to the rim.
  const py = ground(POND.x, POND.z);
  kit.add("stone", new THREE.TorusGeometry(0.62, 0.09, 5, 16).rotateX(Math.PI / 2).scale(1.3, 1, 1), "#ddd3c3", new THREE.Matrix4().makeTranslation(POND.x, py + 0.04, POND.z));
  kit.add("plain", new THREE.CircleGeometry(0.62, 18).rotateX(-Math.PI / 2).scale(1.3, 1, 1), "#8fc0df", new THREE.Matrix4().makeTranslation(POND.x, py + 0.05, POND.z));
  const stream = new THREE.CatmullRomCurve3([
    new THREE.Vector3(POND.x + 0.4, 0, POND.z + 0.3),
    new THREE.Vector3((POND.x + FALL.x) / 2 + 0.3, 0, (POND.z + FALL.z) / 2 - 0.2),
    new THREE.Vector3(FALL.x, 0, FALL.z),
  ]);
  for (let i = 0; i < 16; i++) {
    const p = stream.getPoint(i / 15);
    kit.add("plain", new THREE.CircleGeometry(0.2, 8).rotateX(-Math.PI / 2), "#9ccbe6", new THREE.Matrix4().makeTranslation(p.x, ground(p.x, p.z) + 0.07, p.z));
    if (i % 2) kit.add("stone", new THREE.DodecahedronGeometry(0.07, 0).scale(1, 0.6, 1), "#e4dccf", new THREE.Matrix4().makeTranslation(p.x + 0.26, ground(p.x, p.z) + 0.05, p.z - 0.1));
  }

  [
    [-3.3, 1.3, 0.75],
    [3.6, 1.4, 0.65],
    [-2.6, -2.4, 0.7],
  ].forEach(([x, z, s], i) => addKitTree(kit, x!, ground(x!, z!), z!, s!, 500 + i, "#6fa84f"));
  return kit;
}

/** Vines hanging from the canopy and the rim; their own material so sway grows with length. */
function buildVines(): KitBuilder {
  const kit = new KitBuilder();
  const rng = mulberry32(71);
  const add = (x: number, y: number, z: number, len: number, flowers: boolean) => {
    kit.at([x, y, z], 0, 1, () => {
      const pts: [number, number, number][] = [
        [0, 0, 0],
        [(rng() - 0.5) * 0.15, -len * 0.4, (rng() - 0.5) * 0.15],
        [(rng() - 0.5) * 0.2, -len, (rng() - 0.5) * 0.2],
      ];
      kit.add("leaf", tube(pts, 0.025, 8), "#4f8a3c");
      const n = Math.floor(len * 4);
      for (let k = 0; k < n; k++) {
        const t = rng();
        kit.add("leaf", new THREE.IcosahedronGeometry(0.06 + rng() * 0.04, 0).scale(1.4, 0.8, 1), rng() > 0.3 ? "#5f9a45" : "#86b65a", new THREE.Matrix4().makeTranslation(pts[1]![0] * t, -len * t, pts[1]![2] * t));
        if (flowers && rng() > 0.6) kit.add("leaf", new THREE.IcosahedronGeometry(0.05, 0), "#f6b7c6", new THREE.Matrix4().makeTranslation(pts[1]![0] * t + 0.05, -len * t, pts[1]![2] * t + 0.05));
      }
    });
  };
  const ty = ground(TREE.x, TREE.z);
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const r = 1.4 + rng() * 1.2;
    add(TREE.x + Math.cos(a) * r, ty + 2.6 + rng() * 0.8, TREE.z + Math.sin(a) * r, 0.6 + rng() * 1.4, true);
  }
  for (let i = 0; i < 30; i++) {
    const th = rng() * Math.PI * 2;
    const rr = rimRadius(SHAPE, th) * 1.0;
    const x = Math.cos(th) * rr * SHAPE.stretch;
    const z = Math.sin(th) * rr;
    add(x, groundOn(SHAPE, x, z), z, 1.0 + rng() * 2.6, rng() > 0.5);
  }
  return kit;
}

function Vines() {
  const parts = useMemo(() => buildVines().build(), []);
  const mat = paint("garden-vine", { vertexColors: true, wind: 0.05, windHang: true });
  return (
    <>
      {parts.map(({ geometry }, i) => (
        <mesh key={i} geometry={geometry} material={mat} />
      ))}
    </>
  );
}

/** A thin painted ribbon of falling water: scrolling streaks on a curved strip, plus spray at the foot. */
function Waterfall({ animate }: { animate: boolean }) {
  const map = useMemo(() => {
    const t = waterTexture().clone();
    t.repeat.set(1, 1.6);
    t.needsUpdate = true;
    return t;
  }, []);
  const geometry = useMemo(() => {
    const drop = 5.2;
    const g = new THREE.PlaneGeometry(0.5, drop, 1, 16).translate(0, -drop / 2, 0);
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const d = -pos.getY(i) / drop;
      // Arc out over the lip, then fall and fan slightly.
      pos.setZ(i, Math.sqrt(d) * 0.6);
      pos.setX(i, pos.getX(i) * (1 + d * 0.8));
    }
    g.computeVertexNormals();
    return g;
  }, []);
  useFrame((_, dt) => {
    if (animate) map.offset.y += Math.min(dt, 0.1) * 0.9;
  });
  const out = Math.atan2(FALL.x, FALL.z);
  return (
    <group position={[FALL.x, FALL.y + 0.02, FALL.z]} rotation={[0, out, 0]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial map={map} color="#dcecf6" transparent opacity={0.88} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <sprite position={[0, -5.0, 0.9]} scale={[2.4, 1.2, 1]}>
        <spriteMaterial map={cloudTexture(2, false)} transparent depthWrite={false} opacity={0.75} />
      </sprite>
    </group>
  );
}

export function HangingGardens({ animate }: { animate: boolean }) {
  const build = useCallback(buildGarden, []);
  return (
    <FloatingPlacement placement={P} palette={MID_PALETTE} detail={MID_DETAIL} animate={animate}>
      <KitMeshes build={build} outline="fine" />
      <Vines />
      <Waterfall animate={animate} />
      <IslandFlowers
        shape={SHAPE}
        count={180}
        seed={41}
        colors={["#f6b7c6", "#ffffff", "#ffe08a", "#c9b6ee", "#ef9a86", "#f3a1b0"]}
        avoid={(x, z) => Math.hypot(x - POND.x, z - POND.z) < 0.9 || Math.hypot(x - TREE.x, z - TREE.z) < 0.8}
      />
      <CloudSkirt radius={SHAPE.radius} depth={SHAPE.depth} count={4} seed={13} animate={animate} opacity={0.8} />
    </FloatingPlacement>
  );
}
