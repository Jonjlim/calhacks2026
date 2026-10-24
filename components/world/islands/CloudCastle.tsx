"use client";

import { useCallback, useMemo } from "react";
import * as THREE from "three";
import { addKitTree, addTower, boxGeometry, gableGeometry, KitBuilder, type TowerSpec, windowGeometry } from "../kit";
import { mulberry32 } from "../painterly/noise";
import { WORLD_LAYOUT } from "../worldLayout";
import { CloudSkirt, FAR_DETAIL, FAR_PALETTE, Flag, FloatingPlacement, groundOn, IslandFlowers, KitMeshes } from "./shared";

const P = WORLD_LAYOUT.castle;
const SHAPE = P.shape;

const ROOF = { slate: "#6f86c4", lilac: "#9d8fcb", coral: "#cf765d", blue: "#7f9fd6" };

/** Towers at deliberately uneven heights; the keep is the tallest, off-centre. */
const TOWERS: TowerSpec[] = [
  { x: 0.3, z: -0.8, radius: 0.95, height: 6.6, roof: ROOF.slate, windows: 4, seed: 1, roofHeight: 3.6 },
  { x: -2.5, z: 0.5, radius: 0.62, height: 4.3, roof: ROOF.lilac, windows: 2, seed: 2 },
  { x: 2.7, z: 0.3, radius: 0.68, height: 4.9, roof: ROOF.coral, windows: 3, seed: 3 },
  { x: 1.6, z: -2.4, radius: 0.55, height: 5.7, roof: ROOF.lilac, windows: 2, seed: 4 },
  { x: -1.6, z: -2.5, radius: 0.5, height: 3.7, roof: ROOF.blue, windows: 2, seed: 5 },
  { x: 4.0, z: -1.5, radius: 0.46, height: 3.1, roof: ROOF.coral, windows: 1, seed: 6 },
  { x: -3.8, z: -1.3, radius: 0.48, height: 2.7, roof: ROOF.slate, windows: 1, seed: 7, flatTop: true },
  { x: -0.9, z: 1.7, radius: 0.36, height: 3.2, roof: ROOF.blue, windows: 1, seed: 8 },
];

const ground = (x: number, z: number) => groundOn(SHAPE, x, z) - 0.12;

function curtainWall(kit: KitBuilder, a: [number, number], b: [number, number], height: number, seed: number) {
  const [ax, az] = a;
  const [bx, bz] = b;
  const len = Math.hypot(bx - ax, bz - az);
  const ang = -Math.atan2(bz - az, bx - ax);
  const y = Math.min(ground(ax, az), ground(bx, bz));
  kit.at([(ax + bx) / 2, y, (az + bz) / 2], ang, 1, () => {
    kit.add("stone", boxGeometry(len, height, 0.34, seed), "#eedccd", undefined, 0.2);
    const n = Math.max(2, Math.floor(len / 0.32));
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + (i + 0.5) * (len / n);
      if (i % 2) continue;
      kit.add("stone", boxGeometry(0.18, 0.2, 0.36, seed + i), "#f2e2d4", new THREE.Matrix4().makeTranslation(x, height, 0));
    }
  });
}

function buildCastle(): KitBuilder {
  const kit = new KitBuilder();
  const rng = mulberry32(37);

  for (const t of TOWERS) kit.at([0, ground(t.x, t.z), 0], 0, 1, () => addTower(kit, t));

  // Curtain walls tie the towers into one silhouette.
  curtainWall(kit, [-2.5, 0.5], [-0.9, 1.7], 1.5, 11);
  curtainWall(kit, [-0.9, 1.7], [2.7, 0.3], 1.6, 12);
  curtainWall(kit, [2.7, 0.3], [4.0, -1.5], 1.3, 13);
  curtainWall(kit, [-2.5, 0.5], [-3.8, -1.3], 1.2, 14);
  curtainWall(kit, [-1.6, -2.5], [1.6, -2.4], 1.8, 15);

  // Great hall between the keep and the front wall.
  kit.at([0.6, ground(0.6, 0.4), 0.4], 0.05, 1, () => {
    kit.add("plaster", boxGeometry(2.6, 2.3, 1.5, 21), "#f4ddd2", undefined, 0.18);
    kit.add("roof", gableGeometry(2.9, 1.2, 1.7, 21), ROOF.coral, new THREE.Matrix4().makeTranslation(0, 2.3, 0), 0.2);
    for (let i = 0; i < 4; i++) kit.add("glow", windowGeometry(0.22, 0.42), "#ffcf7d", new THREE.Matrix4().makeTranslation(-0.9 + i * 0.6, 1.1, 0.76));
  });

  // Gate and a terrace with a stair down to the rim walk.
  const gx = 0.9;
  const gz = 1.05;
  const gy = ground(gx, gz);
  const arch = new THREE.Shape();
  arch.moveTo(-0.3, 0);
  arch.lineTo(0.3, 0);
  arch.lineTo(0.3, 0.5);
  arch.absarc(0, 0.5, 0.3, 0, Math.PI, false);
  arch.closePath();
  kit.add("plain", new THREE.ShapeGeometry(arch), "#4a3646", new THREE.Matrix4().compose(new THREE.Vector3(gx, gy, gz + 0.19), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.37, 0)), new THREE.Vector3(1, 1, 1)));
  kit.at([0.6, ground(0.6, 2.6), 2.6], -0.1, 1, () => {
    kit.add("stone", boxGeometry(4.6, 0.32, 1.6, 31), "#e7d8c6");
    for (let i = 0; i < 4; i++) kit.add("stone", boxGeometry(1.0, 0.12, 0.3, 32 + i), "#efe2d2", new THREE.Matrix4().makeTranslation(0.4, -0.12 * i, 0.95 + i * 0.28));
    for (let i = 0; i < 7; i++) kit.add("stone", boxGeometry(0.12, 0.3, 0.12, 40 + i), "#f3e8da", new THREE.Matrix4().makeTranslation(-2.2 + i * 0.73, 0.32, 0.78));
  });

  // Courtyard garden trees and hedges around the walls.
  const trees: [number, number, number][] = [
    [-4.8, 1.6, 1.1],
    [-5.9, -0.6, 0.9],
    [4.9, 1.2, 1.0],
    [5.9, -0.9, 1.2],
    [3.4, 2.6, 0.8],
    [-3.2, 2.8, 0.85],
    [-5.0, -2.8, 0.9],
    [6.6, 1.6, 0.7],
  ];
  trees.forEach(([x, z, s], i) => addKitTree(kit, x, ground(x, z), z, s, 300 + i, i % 3 ? "#6b9f4c" : "#86ad55"));

  // Ivy streaks down the front walls.
  for (let i = 0; i < 9; i++) {
    const x = -2.2 + rng() * 6;
    const z = 0.9 + rng() * 0.6;
    const len = 0.6 + rng() * 0.9;
    kit.add("leaf", new THREE.CylinderGeometry(0.07, 0.03, len, 5).translate(0, -len / 2, 0), "#5d8f44", new THREE.Matrix4().makeTranslation(x, ground(x, z) + 1.5, z + 0.05));
  }
  return kit;
}

export function CloudCastle({ animate }: { animate: boolean }) {
  const build = useCallback(buildCastle, []);
  const flags = useMemo(
    () =>
      TOWERS.filter((t) => !t.flatTop).slice(0, 5).map((t, i) => ({
        p: [t.x + (t.roofHeight ?? t.radius * 3.1) * 0.07, ground(t.x, t.z) + t.height + t.radius * 0.12 + (t.roofHeight ?? t.radius * 3.1) * 0.96, t.z] as THREE.Vector3Tuple,
        color: ["#e8806a", "#f2d27a", "#ffffff", "#e8806a", "#a9c7ee"][i]!,
      })),
    [],
  );
  return (
    <FloatingPlacement placement={P} palette={FAR_PALETTE} detail={FAR_DETAIL} animate={animate}>
      <KitMeshes build={build} outline="fine" />
      <IslandFlowers shape={SHAPE} count={90} seed={7} avoid={(x, z) => Math.abs(x) < 4.4 && z < 3.4 && z > -3.2} />
      {flags.map((f, i) => (
        <Flag key={i} position={f.p} height={0.9} size={0.7} color={f.color} rotationY={-0.6 + i * 0.3} />
      ))}
      <CloudSkirt radius={SHAPE.radius * 1.2} depth={SHAPE.depth} count={7} seed={5} animate={animate} />
    </FloatingPlacement>
  );
}
