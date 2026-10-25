"use client";

import { createRef, type RefObject } from "react";
import type * as THREE from "three";
import { GIFT_SPOT } from "../sceneConfig";
import { groundAt, MAIN_ISLAND } from "../terrain";

/**
 * Invisible stand-ins for the main island and what stands on it. The map's
 * floating labels are HTML, so by themselves they would be drawn over everything;
 * handing these to each label as its occluders makes a label vanish while the
 * island is between it and the camera, as a real object would. They are never
 * drawn: only ray-tested.
 */
export const OCCLUDERS = Array.from({ length: 5 }, () => createRef<THREE.Object3D>()) as RefObject<THREE.Object3D>[];

export function MainIslandOccluders() {
  const y = groundAt(0, 0);
  const R = MAIN_ISLAND.radius;
  return (
    <group visible={false}>
      {/* the lawn */}
      <mesh ref={OCCLUDERS[0] as RefObject<THREE.Mesh>} position={[0, y - 0.35, 0]} scale={[R * MAIN_ISLAND.stretch * 0.98, 0.9, R * 0.98]}>
        <cylinderGeometry args={[1, 1, 1, 24]} />
      </mesh>
      {/* the rock beneath, narrowing to a point */}
      <mesh ref={OCCLUDERS[1] as RefObject<THREE.Mesh>} position={[0, y - 0.8 - MAIN_ISLAND.depth * 0.45, 0]} rotation={[Math.PI, 0, 0]} scale={[R * MAIN_ISLAND.stretch * 0.95, MAIN_ISLAND.depth * 0.9, R * 0.95]}>
        <coneGeometry args={[1, 1, 24]} />
      </mesh>
      {/* the tower, the cottage, and the pedestal with its present */}
      <mesh ref={OCCLUDERS[2] as RefObject<THREE.Mesh>} position={[-3.7, y + 1.8, -2.7]}>
        <cylinderGeometry args={[0.9, 1.0, 4.4, 10]} />
      </mesh>
      <mesh ref={OCCLUDERS[3] as RefObject<THREE.Mesh>} position={[4.7, y + 0.9, -2.6]}>
        <boxGeometry args={[2.3, 2.2, 2.2]} />
      </mesh>
      <mesh ref={OCCLUDERS[4] as RefObject<THREE.Mesh>} position={[GIFT_SPOT.x, y + 1.7, GIFT_SPOT.z]}>
        <cylinderGeometry args={[1.5, 2.2, 3.6, 12]} />
      </mesh>
    </group>
  );
}
