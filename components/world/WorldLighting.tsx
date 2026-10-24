"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useScenePalette } from "./scenePalette";
import type { WorldQuality } from "./sceneConfig";

/**
 * One key light (the only shadow caster) plus a sky/ground hemisphere fill.
 * Day: golden sun, cool lavender shadows. Night: cool moonlight, so the warm
 * lanterns and windows become the focal glow.
 */
export function WorldLighting({ quality, interior = false }: { quality: WorldQuality; interior?: boolean }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const { light: tone } = useScenePalette();

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
      {/* Inside the tower the island's daylight is dimmed; the room's own lanterns carry the scene. */}
      <hemisphereLight args={[tone.hemiSky, tone.hemiGround, tone.hemiIntensity * (interior ? 0.35 : 1)]} />
      <directionalLight
        ref={sun}
        color={tone.key}
        intensity={tone.keyIntensity * (interior ? 0.12 : 1)}
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
      <directionalLight color={tone.bounce} intensity={tone.bounceIntensity * (interior ? 0 : 1)} position={[3, -8, 9]} />
      {/* Soft rim from behind to separate silhouettes from the sky. */}
      <directionalLight color={tone.rim} intensity={tone.rimIntensity * (interior ? 0.2 : 1)} position={[-6, 5, -10]} />
    </>
  );
}
