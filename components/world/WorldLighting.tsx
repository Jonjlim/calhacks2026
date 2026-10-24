"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { WorldQuality } from "./sceneConfig";

/**
 * One warm key light (the only shadow caster) plus a sky/ground hemisphere
 * fill: golden highlights, cool lavender shadows.
 */
export function WorldLighting({ quality }: { quality: WorldQuality }) {
  const sun = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.target.position.set(0.4, 0, -0.6);
    light.target.updateMatrixWorld();
    // R3F sets the frustum props but does not rebuild the projection.
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.needsUpdate = true;
  }, []);

  // Fixed size: three does not reallocate an existing shadow map when mapSize
  // changes, so a mid-session quality drop would silently break shadows.
  const mapSize = 2048;

  return (
    <>
      <hemisphereLight args={["#d4e3ff", "#9d8cc0", 0.95]} />
      <directionalLight
        ref={sun}
        color="#ffe1ad"
        intensity={3.0}
        position={[11, 12, -4.5]}
        castShadow
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
        shadow-radius={4}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
        shadow-camera-near={1}
        shadow-camera-far={40}
      />
      {/* Warm bounce off the cloud sea so the underside reads as painted rock, not void. */}
      <directionalLight color="#f6d8c4" intensity={0.9} position={[3, -8, 9]} />
      {/* Soft rim from behind to separate silhouettes from the sky. */}
      <directionalLight color="#c7d2ff" intensity={0.55} position={[-6, 5, -10]} />
    </>
  );
}
