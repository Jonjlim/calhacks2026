"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { lazy, Suspense, useCallback, useState } from "react";
import { AtmosphericSky } from "./AtmosphericSky";
import { Birds, ForegroundFoliage, MagicMotes } from "./AmbientEffects";
import { DistantScenery } from "./DistantScenery";
import { FloatingIsland } from "./FloatingIsland";
import { HeroGiftBox } from "./HeroGiftBox";
import { IntroBridge } from "./intro/IntroBridge";
import { IslandEnvironment } from "./IslandEnvironment";
import { windUniforms } from "./painterly/materials";
import { OPENING_CAMERA, type WorldQuality } from "./sceneConfig";
import { WorldCamera } from "./WorldCamera";
import { WorldLighting } from "./WorldLighting";

const KuwaharaCompare = lazy(() => import("./painterly/KuwaharaCompare").then((module) => ({ default: module.KuwaharaCompare })));

function Wind({ animate }: { animate: boolean }) {
  useFrame((_, dt) => {
    if (animate) windUniforms.uTime.value += Math.min(dt, 0.1);
  });
  return null;
}

export interface WorldCanvasProps {
  reducedMotion: boolean;
  soundEnabled: boolean;
  painterlyStrength: number;
  /** While the storybook intro runs, the camera follows the intro clock and pointer parallax is off. */
  introActive?: boolean;
  onReady?: () => void;
}

/** The interactive 3D opening scene. Purely visual; holds no application state. */
export default function WorldCanvas({ reducedMotion, soundEnabled, painterlyStrength, introActive = false, onReady }: WorldCanvasProps) {
  const [quality, setQuality] = useState<WorldQuality>("high");
  const [canvasReady, setCanvasReady] = useState(false);
  const animate = !reducedMotion;
  const markReady = useCallback(() => {
    setCanvasReady(true);
    onReady?.();
  }, [onReady]);

  return (
    <Canvas
      shadows="percentage"
      flat
      dpr={quality === "high" ? [1, 1.75] : 1}
      frameloop={animate ? "always" : "demand"}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: OPENING_CAMERA.fov, near: 0.5, far: 600, position: [...OPENING_CAMERA.position] }}
      onCreated={({ gl }) => {
        gl.setClearColor("#cfe0f0");
        requestAnimationFrame(markReady);
      }}
      aria-hidden
    >
      <PerformanceMonitor onDecline={() => setQuality("low")} flipflops={2} />
      {painterlyStrength > 0 && canvasReady && (
        <Suspense fallback={null}>
          <KuwaharaCompare strength={painterlyStrength} />
        </Suspense>
      )}
      <fog attach="fog" args={["#d9e4ef", 34, 190]} />
      <WorldCamera parallax={animate && !introActive} />
      <IntroBridge />
      <WorldLighting quality={quality} />
      <Wind animate={animate} />

      <AtmosphericSky animate={animate} />
      <DistantScenery animate={animate} />

      <FloatingIsland />
      <IslandEnvironment animate={animate} quality={quality} />
      <HeroGiftBox animate={animate} soundEnabled={soundEnabled} />

      <MagicMotes animate={animate} />
      <Birds animate={animate} />
      <ForegroundFoliage animate={animate} />
    </Canvas>
  );
}
