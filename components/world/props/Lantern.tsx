"use client";

import { InkOutline } from "@/components/world/painterly/InkOutline";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { paint } from "../painterly/materials";
import { toonRamp } from "../painterly/textures";
import { groundAt } from "../terrain";

const INK = "#3d2c35";

/** Iron lamp post with a hanging glass lantern that flickers softly. */
export function Lantern({
  x,
  z,
  y: groundY,
  rotationY = 0,
  light = false,
  animate,
}: {
  x: number;
  z: number;
  /** Ground height override when not standing on the main island. */
  y?: number;
  rotationY?: number;
  light?: boolean;
  animate: boolean;
}) {
  const y = (groundY ?? groundAt(x, z)) - 0.05;
  const glow = useMemo(
    () => new THREE.MeshToonMaterial({ color: "#ffe2a0", emissive: "#ffb24a", emissiveIntensity: 1.2, gradientMap: toonRamp() }),
    [],
  );
  const lamp = useRef<THREE.PointLight>(null);
  const phase = useMemo(() => x * 3.1 + z * 1.7, [x, z]);
  const swing = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!animate) return;
    const t = clock.elapsedTime + phase;
    const flicker = 1 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 13.1) * 0.04 + Math.sin(t * 2.1) * 0.05;
    glow.emissiveIntensity = 1.2 * flicker;
    if (lamp.current) lamp.current.intensity = 2.2 * flicker;
    if (swing.current) swing.current.rotation.x = Math.sin(t * 1.2) * 0.05;
  });

  const iron = paint("iron", { color: "#4b3d4c" });
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]} userData={{ sketch: 9 }}>
      <mesh position={[0, 0.7, 0]} material={iron} castShadow>
        <cylinderGeometry args={[0.03, 0.045, 1.4, 6]} />
        <InkOutline weight="fine" color={INK} />
      </mesh>
      <mesh position={[0, 0.06, 0]} material={paint("stone-cap", {})} castShadow>
        <cylinderGeometry args={[0.12, 0.15, 0.12, 7]} />
      </mesh>
      <mesh position={[0.16, 1.38, 0]} rotation={[0, 0, Math.PI / 2]} material={iron}>
        <cylinderGeometry args={[0.018, 0.018, 0.34, 5]} />
      </mesh>
      <group ref={swing} position={[0.3, 1.36, 0]}>
        <group position={[0, -0.2, 0]}>
          <mesh position={[0, 0.17, 0]} material={iron}>
            <coneGeometry args={[0.12, 0.1, 4]} />
          </mesh>
          <mesh material={glow}>
            <boxGeometry args={[0.15, 0.22, 0.15]} />
            <InkOutline weight="fine" color={INK} />
          </mesh>
          <mesh position={[0, -0.13, 0]} material={iron}>
            <boxGeometry args={[0.18, 0.03, 0.18]} />
          </mesh>
          {light && <pointLight ref={lamp} color="#ffb766" intensity={2.2} distance={4.5} decay={2} />}
        </group>
      </group>
    </group>
  );
}
