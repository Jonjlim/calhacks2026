"use client";

import { useCallback, useMemo } from "react";
import * as THREE from "three";
import { addHouse, addKitTree, boxGeometry, KitBuilder, spireGeometry, windowGeometry } from "../kit";
import { mulberry32 } from "../painterly/noise";
import { Lantern } from "../props/Lantern";
import { type IslandShape } from "../terrain";
import { ISLETS, type IsletPlacement, WORLD_LAYOUT } from "../worldLayout";
import { CloudSkirt, FAR_DETAIL, FAR_PALETTE, Flag, FloatingPlacement, groundOn, IslandFlowers, KitMeshes } from "./shared";

const W = WORLD_LAYOUT.watchtower;

function buildWatchtower(): KitBuilder {
  const kit = new KitBuilder();
  const s = W.shape;
  const g = (x: number, z: number) => groundOn(s, x, z) - 0.08;
  const tx = 0.3;
  const tz = -0.2;
  const y = g(tx, tz);
  kit.at([tx, y, tz], 0.3, 1, () => {
    // Stone foot, a tall slender shaft, then a timber lookout and pointed cap.
    kit.add("stone", new THREE.CylinderGeometry(0.55, 0.7, 0.9, 9).translate(0, 0.45, 0), "#ddd0c2", undefined, 0.25);
    kit.add("plaster", new THREE.CylinderGeometry(0.34, 0.46, 3.6, 9, 3).translate(0, 0.9 + 1.8, 0), "#f1e2d2", undefined, 0.22);
    kit.add("wood", new THREE.CylinderGeometry(0.7, 0.6, 0.12, 10).translate(0, 4.55, 0), "#8a5d44");
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      kit.add("wood", new THREE.CylinderGeometry(0.025, 0.025, 0.45, 4).translate(0, 4.8, 0), "#7a5038", new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62));
    }
    kit.add("wood", new THREE.TorusGeometry(0.62, 0.025, 4, 20).rotateX(Math.PI / 2).translate(0, 5.0, 0), "#7a5038");
    kit.add("roof", spireGeometry(0.85, 1.4, 0.12, 9).translate(0, 5.05, 0), "#cf765d", undefined, 0.25);
    kit.add("glow", windowGeometry(0.16, 0.3), "#ffd27f", new THREE.Matrix4().makeTranslation(0, 2.6, 0.41));
    kit.add("glow", windowGeometry(0.14, 0.26), "#ffcc72", new THREE.Matrix4().makeTranslation(0.36, 3.6, 0.12).multiply(new THREE.Matrix4().makeRotationY(1.2)));
    kit.add("wood", boxGeometry(0.26, 0.5, 0.05, 2), "#a9673f", new THREE.Matrix4().makeTranslation(0, 0, 0.66));
  });
  // Winding path down to the rim.
  const rng = mulberry32(5);
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const x = tx + Math.sin(t * 3) * 0.6 + t * 0.8;
    const z = tz + 0.8 + t * 1.0;
    kit.add("stone", new THREE.CylinderGeometry(0.1 + rng() * 0.04, 0.12, 0.05, 6), "#efe6d6", new THREE.Matrix4().makeTranslation(x, g(x, z) + 0.05, z));
  }
  addKitTree(kit, -1.1, g(-1.1, 0.4), 0.4, 0.75, 601, "#6c9e4a");
  addKitTree(kit, 1.5, g(1.5, -0.6), -0.6, 0.6, 602, "#7aa94d");
  for (let i = 0; i < 6; i++) {
    const a = rng() * 6;
    const r = 0.8 + rng() * 0.9;
    kit.add("stone", new THREE.DodecahedronGeometry(0.1 + rng() * 0.12, 0).scale(1.2, 0.7, 1), "#d8cfc4", new THREE.Matrix4().makeTranslation(Math.cos(a) * r, g(Math.cos(a) * r, Math.sin(a) * r) + 0.05, Math.sin(a) * r));
  }
  return kit;
}

export function WatchtowerOutpost({ animate }: { animate: boolean }) {
  const build = useCallback(buildWatchtower, []);
  const top = groundOn(W.shape, 0.3, -0.2) - 0.08 + 6.35;
  return (
    <FloatingPlacement placement={W} palette={FAR_PALETTE} detail={FAR_DETAIL} animate={animate}>
      <KitMeshes build={build} outline="fine" />
      <Flag position={[0.3 + 0.1, top, -0.2]} height={0.7} size={0.5} color="#f2d27a" />
      <IslandFlowers shape={W.shape} count={40} seed={3} />
      <CloudSkirt radius={W.shape.radius * 1.3} depth={W.shape.depth * 0.7} count={4} seed={17} animate={animate} />
    </FloatingPlacement>
  );
}

// --- Islets --------------------------------------------------------------------

function isletShape(i: IsletPlacement): IslandShape {
  return { seed: i.seed, radius: 1.15 + (i.seed % 3) * 0.15, stretch: 1.15, depth: 2.4 + (i.seed % 4) * 0.3, hilliness: 0.3 };
}

function buildIslet(i: IsletPlacement, shape: IslandShape): KitBuilder {
  const kit = new KitBuilder();
  const g = (x: number, z: number) => groundOn(shape, x, z) - 0.05;
  const rng = mulberry32(i.seed);
  switch (i.kind) {
    case "tree":
      addKitTree(kit, 0.1, g(0.1, 0), 0, 1.3, i.seed, "#7aa94d");
      break;
    case "shrine": {
      // A tiny stone shrine with a little roof and a lit niche.
      kit.add("stone", boxGeometry(0.9, 0.15, 0.7, 1), "#e6dccd", new THREE.Matrix4().makeTranslation(0, g(0, 0), 0));
      for (const x of [-0.3, 0.3]) kit.add("stone", new THREE.CylinderGeometry(0.06, 0.07, 0.7, 6).translate(0, 0.5, 0), "#efe5d6", new THREE.Matrix4().makeTranslation(x, g(0, 0), 0.2));
      kit.add("roof", spireGeometry(0.62, 0.55, 0, 3).scale(1, 1, 0.8), "#cf765d", new THREE.Matrix4().makeTranslation(0, g(0, 0) + 0.85, 0.05));
      kit.add("glow", new THREE.SphereGeometry(0.09, 8, 6), "#ffd27f", new THREE.Matrix4().makeTranslation(0, g(0, 0) + 0.4, 0));
      addKitTree(kit, -0.7, g(-0.7, -0.4), -0.4, 0.55, i.seed + 1, "#6c9e4a");
      break;
    }
    case "cottage":
      addHouse(kit, { x: 0, z: 0, y: g(0, 0), width: 1.0, depth: 0.8, height: 0.75, roof: "#7c8fc6", chimney: true, seed: i.seed, rotationY: 0.5 });
      addKitTree(kit, 0.8, g(0.8, -0.5), -0.5, 0.6, i.seed + 2, "#6fa84f");
      break;
    case "lamp":
      for (let k = 0; k < 7; k++) {
        const a = rng() * 6;
        kit.add("plain", new THREE.IcosahedronGeometry(0.08, 0), ["#f6b7c6", "#ffffff", "#ffe08a", "#c9b6ee"][k % 4]!, new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.5, g(0, 0) + 0.06, Math.sin(a) * 0.4));
      }
      break;
    case "ruin":
      for (let k = 0; k < 3; k++) {
        const x = -0.4 + k * 0.4;
        const h = 0.4 + rng() * 0.6;
        kit.add("stone", new THREE.CylinderGeometry(0.11, 0.12, h, 8).translate(0, h / 2, 0), "#e8dfd2", new THREE.Matrix4().makeTranslation(x, g(x, 0), (rng() - 0.5) * 0.3));
      }
      kit.add("stone", boxGeometry(1.2, 0.12, 0.3, 4), "#e2d8ca", new THREE.Matrix4().makeTranslation(-0.2, g(0, 0) + 0.85, 0).multiply(new THREE.Matrix4().makeRotationZ(-0.15)));
      kit.add("leaf", new THREE.IcosahedronGeometry(0.2, 1).scale(1.4, 0.6, 1.2), "#6e9b4c", new THREE.Matrix4().makeTranslation(0.3, g(0.3, 0.2) + 0.1, 0.2));
      break;
  }
  return kit;
}

function Islet({ islet, animate }: { islet: IsletPlacement; animate: boolean }) {
  const shape = useMemo(() => isletShape(islet), [islet]);
  const build = useCallback(() => buildIslet(islet, shape), [islet, shape]);
  const placement = useMemo(() => ({ position: islet.position, rotationY: islet.seed, shape, bob: [0.25, 0.4 + (islet.seed % 5) * 0.05, islet.seed] as [number, number, number] }), [islet, shape]);
  return (
    <FloatingPlacement placement={placement} palette={FAR_PALETTE} detail={FAR_DETAIL} animate={animate} scale={islet.scale}>
      <KitMeshes build={build} outline="fine" />
      {islet.kind === "lamp" && <Lantern x={0} z={0} y={groundOn(shape, 0, 0)} animate={animate} />}
      {islet.kind === "tree" && <IslandFlowers shape={shape} count={14} seed={islet.seed} />}
    </FloatingPlacement>
  );
}

export function Islets({ animate }: { animate: boolean }) {
  return (
    <>
      {ISLETS.map((i) => (
        <Islet key={i.seed} islet={i} animate={animate} />
      ))}
    </>
  );
}
