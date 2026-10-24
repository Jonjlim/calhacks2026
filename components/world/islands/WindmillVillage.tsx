"use client";

import { useFrame } from "@react-three/fiber";
import { useCallback, useMemo, useRef } from "react";
import * as THREE from "three";
import { addFence, addHouse, addKitTree, boxGeometry, KitBuilder, spireGeometry, windowGeometry } from "../kit";
import { mulberry32 } from "../painterly/noise";
import { OPENING_CAMERA } from "../sceneConfig";
import { WORLD_LAYOUT } from "../worldLayout";
import { CloudSkirt, Flag, FloatingPlacement, groundOn, IslandFlowers, KitMeshes, KitParts, MID_DETAIL, MID_PALETTE } from "./shared";

const P = WORLD_LAYOUT.windmill;
const SHAPE = P.shape;
const ground = (x: number, z: number) => groundOn(SHAPE, x, z) - 0.06;

const MILL = { x: 1.7, z: -0.7, height: 2.7 };
/** The sails face the landing camera so their turning reads from the homepage. */
const MILL_FACING = (() => {
  const [cx, , cz] = OPENING_CAMERA.position;
  const c = Math.cos(P.rotationY);
  const s = Math.sin(P.rotationY);
  const wx = P.position[0] + MILL.x * c + MILL.z * s;
  const wz = P.position[2] - MILL.x * s + MILL.z * c;
  return Math.atan2(cx - wx, cz - wz) - P.rotationY;
})();

function buildVillage(): KitBuilder {
  const kit = new KitBuilder();
  const rng = mulberry32(19);
  const my = ground(MILL.x, MILL.z);

  kit.at([MILL.x, my, MILL.z], MILL_FACING, 1, () => {
    // Tapered octagonal tower with a stone foot.
    kit.add("stone", new THREE.CylinderGeometry(0.86, 0.92, 0.35, 8).translate(0, 0.17, 0), "#e0d2c2");
    const body = new THREE.CylinderGeometry(0.5, 0.78, MILL.height, 8, 3).translate(0, 0.35 + MILL.height / 2, 0);
    kit.add("plaster", body, "#f6e8d6", undefined, 0.2);
    kit.add("wood", new THREE.CylinderGeometry(0.6, 0.6, 0.1, 8).translate(0, 0.35 + MILL.height, 0), "#8a5d44");
    kit.add("roof", spireGeometry(0.68, 1.1, 0.04, 3).translate(0, 0.4 + MILL.height, 0), "#c46f56", undefined, 0.25);
    kit.add("wood", boxGeometry(0.34, 0.6, 0.06, 4), "#a9673f", new THREE.Matrix4().makeTranslation(0, 0.35, 0.78));
    kit.add("glow", windowGeometry(0.2, 0.32), "#ffd27f", new THREE.Matrix4().makeTranslation(0, 1.5, 0.66));
    kit.add("glow", windowGeometry(0.16, 0.26), "#ffcc72", new THREE.Matrix4().makeTranslation(0, 2.35, 0.56));
    // Little balcony under the sails.
    kit.add("wood", boxGeometry(0.9, 0.06, 0.4, 5), "#9a6a4a", new THREE.Matrix4().makeTranslation(0, 1.95, 0.62));
  });

  const houses = [
    { x: -1.9, z: 0.8, width: 1.3, depth: 1.0, height: 0.9, rotationY: 0.4, roof: "#cf765d", chimney: true, seed: 1 },
    { x: -0.4, z: 2.0, width: 1.0, depth: 0.85, height: 0.78, rotationY: -0.3, roof: "#7c8fc6", seed: 2 },
    { x: -2.9, z: -1.3, width: 1.1, depth: 0.9, height: 0.85, rotationY: 0.9, roof: "#a092cc", chimney: true, seed: 3 },
  ];
  for (const h of houses) addHouse(kit, { ...h, y: ground(h.x, h.z) });

  // Winding stepping-stone path from the houses to the mill door.
  const path = new THREE.CatmullRomCurve3(
    [
      [-0.6, 1.2],
      [0.4, 0.7],
      [1.0, 0.4],
      [1.9, 0.3],
      [2.9, 1.1],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  );
  for (let i = 0; i < 18; i++) {
    const p = path.getPoint(i / 17);
    const x = p.x + (rng() - 0.5) * 0.15;
    const z = p.z + (rng() - 0.5) * 0.15;
    kit.add("stone", new THREE.CylinderGeometry(0.13 + rng() * 0.05, 0.15, 0.05, 6), "#efe6d6", new THREE.Matrix4().makeTranslation(x, ground(x, z) + 0.04, z));
  }

  addFence(kit, [-3.2, -2.6, -1.8, -1.0, -0.2].map((x, i) => [x, ground(x, 1.9 + i * 0.25 - (i > 2 ? (i - 2) * 0.4 : 0)), 1.9 + i * 0.25 - (i > 2 ? (i - 2) * 0.4 : 0)] as [number, number, number]));
  addFence(kit, [2.6, 3.1, 3.6, 4.0].map((x, i) => [x, ground(x, -0.6 - i * 0.35), -0.6 - i * 0.35] as [number, number, number]));

  // Clothesline with drying laundry between two posts.
  const a = new THREE.Vector3(-1.2, ground(-1.2, -0.4), -0.4);
  const b = new THREE.Vector3(0.3, ground(0.3, -1.0), -1.0);
  for (const p of [a, b]) kit.add("wood", new THREE.CylinderGeometry(0.025, 0.03, 0.75, 5).translate(0, 0.37, 0), "#8a6448", new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
  const line = new THREE.CatmullRomCurve3([a.clone().setY(a.y + 0.72), a.clone().lerp(b, 0.5).setY((a.y + b.y) / 2 + 0.62), b.clone().setY(b.y + 0.72)]);
  kit.add("plain", new THREE.TubeGeometry(line, 10, 0.008, 3), "#e8dcc8");
  ["#f3a1b0", "#ffffff", "#9cc4e6", "#ffe08a"].forEach((c, i) => {
    const p = line.getPoint(0.2 + i * 0.2);
    const ang = -Math.atan2(b.z - a.z, b.x - a.x);
    kit.add("plain", new THREE.PlaneGeometry(0.2, 0.26).translate(0, -0.13, 0), c, new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ang, 0)), new THREE.Vector3(1, 1, 1)));
  });

  // Trees, hedges and a little garden bed.
  [
    [-3.6, 0.6, 0.9],
    [3.4, 1.8, 0.75],
    [0.2, -2.4, 0.95],
    [-1.4, -2.6, 0.7],
    [3.9, -2.0, 0.65],
  ].forEach(([x, z, s], i) => addKitTree(kit, x!, ground(x!, z!), z!, s!, 120 + i, i % 2 ? "#5f9545" : "#7aa94d"));
  return kit;
}

function Sails({ animate }: { animate: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (animate && ref.current) ref.current.rotation.z -= Math.min(dt, 0.1) * 0.45;
  });
  const geometry = useMemo(() => {
    const kit = new KitBuilder();
    for (let i = 0; i < 4; i++) {
      kit.at([0, 0, 0], 0, 1, () => {
        kit.add("wood", new THREE.BoxGeometry(0.06, 1.55, 0.05).translate(0, 0.8, 0), "#7a5038");
        kit.add("plain", new THREE.PlaneGeometry(0.36, 1.1).translate(0.22, 0.95, 0.03), "#f8efdf");
        for (let k = 0; k < 4; k++) kit.add("wood", new THREE.BoxGeometry(0.4, 0.025, 0.04).translate(0.2, 0.45 + k * 0.3, 0.04), "#8a5d44");
      }, 0, (i / 4) * Math.PI * 2);
    }
    kit.add("wood", new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8).rotateX(Math.PI / 2), "#5a3e30");
    return kit.build();
  }, []);
  const my = ground(MILL.x, MILL.z);
  // Hub sits on the tower's front face, in the mill's facing direction.
  const hub: THREE.Vector3Tuple = [MILL.x + Math.sin(MILL_FACING) * 0.62, my + 2.55, MILL.z + Math.cos(MILL_FACING) * 0.62];
  return (
    <group position={hub} rotation={[0, MILL_FACING, 0]}>
      <group ref={ref} rotation={[0, 0, 0.4]}>
        <KitParts parts={geometry} outline="fine" />
      </group>
    </group>
  );
}

export function WindmillVillage({ animate }: { animate: boolean }) {
  const build = useCallback(buildVillage, []);
  const my = ground(MILL.x, MILL.z);
  return (
    <FloatingPlacement placement={P} palette={MID_PALETTE} detail={MID_DETAIL} animate={animate}>
      <KitMeshes build={build} outline="fine" />
      <Sails animate={animate} />
      <Flag position={[MILL.x, my + MILL.height + 1.4, MILL.z]} height={0.5} size={0.42} color="#f2d27a" rotationY={0.5} />
      <IslandFlowers shape={SHAPE} count={120} seed={23} avoid={(x, z) => Math.hypot(x - MILL.x, z - MILL.z) < 1.1} />
      <CloudSkirt radius={SHAPE.radius} depth={SHAPE.depth} count={4} seed={9} animate={animate} opacity={0.85} />
    </FloatingPlacement>
  );
}
