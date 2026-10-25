"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useRoomStage } from "@/components/room/roomStage";
import type { RoomWorld } from "./IslandWorldProvider";
import { GardenDecorating } from "./room/GardenDecorating";
import { CouncilFamiliars } from "./room/CouncilFamiliars";
import { GiftRings } from "./room/GiftRings";
import { TowerInterior } from "./room/TowerInterior";
import type { CouncilActor } from "@/lib/council/contracts";
import { AtmosphericSky, SurroundClouds } from "./AtmosphericSky";
import { Birds, Fireflies, FlowerPetals, ForegroundFoliage, MagicMotes } from "./AmbientEffects";
import { DistantScenery, MapSurround } from "./DistantScenery";
import { FloatingIsland } from "./FloatingIsland";
import { HeroGiftBox } from "./HeroGiftBox";
import { IntroBridge } from "./intro/IntroBridge";
import { IslandEnvironment } from "./IslandEnvironment";
import { windUniforms } from "./painterly/materials";
import { ScenePaletteContext, useTimeOfDay } from "./scenePalette";
import { OPENING_CAMERA, type WorldQuality } from "./sceneConfig";
import { paletteFor } from "./timeOfDay";
import { WorldCamera } from "./WorldCamera";
import { WorldLighting } from "./WorldLighting";

const KuwaharaCompare = lazy(() => import("./painterly/KuwaharaCompare").then((module) => ({ default: module.KuwaharaCompare })));

/** Keeps the renderer's clear colour in step with the time-of-day toggle. */
function ClearColor({ color }: { color: string }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.setClearColor(color);
    invalidate();
  }, [color, gl, invalidate]);
  return null;
}

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
  council?: RoomWorld | null;
  roomActive?: boolean;
  onAssetStatus?: (actor: CouncilActor, status: "ready" | "failed") => void;
}

/** The interactive 3D opening scene. Purely visual; holds no application state. */
export default function WorldCanvas({ reducedMotion, soundEnabled, painterlyStrength, introActive = false, onReady, council, roomActive = false, onAssetStatus }: WorldCanvasProps) {
  const stage = useRoomStage();
  const [quality, setQuality] = useState<WorldQuality>("high");
  const [canvasReady, setCanvasReady] = useState(false);
  const palette = paletteFor(useTimeOfDay());
  const night = palette.time === "night";
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
        gl.setClearColor(palette.clearColor);
        requestAnimationFrame(markReady);
      }}
      aria-hidden
    >
      <ScenePaletteContext.Provider value={palette}>
      <PerformanceMonitor onDecline={() => setQuality("low")} flipflops={2} />
      {painterlyStrength > 0 && canvasReady && (
        <Suspense fallback={null}>
          <KuwaharaCompare strength={painterlyStrength} />
        </Suspense>
      )}
      <fog key={palette.time} attach="fog" args={[palette.fog.color, palette.fog.near, palette.fog.far]} />
      <ClearColor color={palette.clearColor} />
      <WorldCamera parallax={animate && !introActive} roomActive={roomActive} reducedMotion={reducedMotion} />
      <IntroBridge />
      <WorldLighting quality={quality} interior={stage.shown === "tower" && !!council} />
      <Wind animate={animate} />

      <AtmosphericSky animate={animate} />
      <DistantScenery animate={animate} islets={stage.shown !== "map"} />

      <FloatingIsland />
      {/* The landing page shows only players who have really joined (unwrap/LobbySpirits). */}
      <IslandEnvironment animate={animate} quality={quality} showPlayers={!council && roomActive} />
      {council && onAssetStatus && stage.shown === "tower" && <TowerInterior world={council} animate={animate} onAssetStatus={onAssetStatus} />}
      {council && stage.shown === "garden" && <GardenDecorating world={council} animate={animate} arrival={stage.arrival} />}
      {council && stage.shown === "map" && <MapSurround animate={animate} />}
      {council && stage.shown === "map" && <SurroundClouds animate={animate} />}
      {council && stage.shown === "map" && <GiftRings animate={animate} />}
      {council && stage.shown === "map" && <CouncilFamiliars world={council} animate={animate} />}
      <HeroGiftBox animate={animate} soundEnabled={soundEnabled} />

      {night ? (
        <Fireflies animate={animate} count={quality === "high" ? 70 : 36} />
      ) : (
        <>
          <MagicMotes animate={animate} />
          <FlowerPetals animate={animate} count={quality === "high" ? 70 : 35} />
          <Birds animate={animate} />
        </>
      )}
      {stage.shown !== "map" && <ForegroundFoliage animate={animate} />}
      </ScenePaletteContext.Provider>
    </Canvas>
  );
}
