"use client";

import { useGLTF } from "@react-three/drei";
import { Component, type ReactNode, Suspense, useMemo } from "react";
import * as THREE from "three";
import { toToon } from "@/components/characters/StorybookAvatar";
import { INTERIOR } from "./stageLayout";

/**
 * Third-party props for the tower interior (Quaternius, via Poly Pizza; see
 * public/props/asset-sources.json). Each is fitted at runtime to a target
 * height and grounded at y = 0, because the exports carry a ×100 node scale.
 * Materials are re-shaded with the lobby's toon ramp; their authored flat
 * colours are kept.
 */

export const PROP_URLS = {
  bookcase: "/props/bookcase.glb",
  barrel: "/props/barrel.glb",
  crate: "/props/crate.glb",
  coinBag: "/props/coin-bag.glb",
} as const;
type PropId = keyof typeof PROP_URLS;

function Prop({ id, height, position, rotationY = 0 }: { id: PropId; height: number; position: [number, number, number]; rotationY?: number }) {
  const { scene } = useGLTF(PROP_URLS[id]);
  const fitted = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toToon) : toToon(mesh.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    // Fit by measured bounds: scale to the requested height, centre on x/z, sit on the floor.
    const box = new THREE.Box3().setFromObject(c);
    const size = box.getSize(new THREE.Vector3());
    const k = height / Math.max(1e-6, size.y);
    const centre = box.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    c.position.set(-centre.x, -box.min.y, -centre.z);
    holder.add(c);
    holder.scale.setScalar(k);
    return holder;
  }, [scene, height]);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive object={fitted} />
    </group>
  );
}

/** A prop that fails to load is simply left out; it is decoration, not information. */
class PropBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const R = INTERIOR.radius;
/** A point against the wall at `angle` (radians, -π/2 is the window), facing the room's centre. */
const wall = (angle: number, inset: number): { position: [number, number, number]; rotationY: number } => {
  const x = Math.cos(angle) * (R - inset);
  const z = Math.sin(angle) * (R - inset);
  return { position: [x, 0, z], rotationY: Math.atan2(-x, -z) };
};

export function TowerProps({ keeperAngle }: { keeperAngle: number }) {
  // The coin bag sits on the table in front of the Keeper.
  const bag: [number, number, number] = [Math.cos(keeperAngle) * (INTERIOR.tableRadius - 0.3), INTERIOR.tableHeight + 0.05, Math.sin(keeperAngle) * (INTERIOR.tableRadius - 0.3)];
  return (
    <PropBoundary>
      <Suspense fallback={null}>
        {/* Back half of the room, where the table camera looks (the window is at -π/2). */}
        <Prop id="bookcase" height={2.5} {...wall(-Math.PI / 2 - 0.98, 0.5)} />
        <Prop id="bookcase" height={2.5} {...wall(-Math.PI / 2 + 0.98, 0.5)} />
        {/* Barrels and crates on the floor in front of the tall cabinets, inside the frame on every screen. */}
        <Prop id="barrel" height={0.8} {...wall(-Math.PI / 2 + 0.7, 1.35)} />
        <Prop id="barrel" height={0.62} {...wall(-Math.PI / 2 + 0.86, 1.75)} />
        <Prop id="crate" height={0.6} {...wall(-Math.PI / 2 - 0.72, 1.35)} />
        <Prop id="crate" height={0.4} position={[...wall(-Math.PI / 2 - 0.72, 1.35).position.map((v, i) => (i === 1 ? 0.6 : v)) as [number, number, number]]} rotationY={0.5} />
        <Prop id="crate" height={0.45} {...wall(-Math.PI / 2 - 0.9, 1.8)} />
        <Prop id="coinBag" height={0.22} position={bag} rotationY={keeperAngle} />
      </Suspense>
    </PropBoundary>
  );
}

for (const url of Object.values(PROP_URLS)) useGLTF.preload(url);
