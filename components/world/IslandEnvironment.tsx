"use client";

import { AvatarCast } from "@/components/characters/AvatarCast";
import { Cottage, StorybookTower } from "./props/Architecture";
import { FlowerMeadow, MeadowGrass, Shrub, StylizedTree, type TreeKind } from "./props/Flora";
import { GardenWall, GiftSurround, Mushrooms, SteppingStones } from "./props/Garden";
import { Lantern } from "./props/Lantern";
import { GiftPlatform, PathStones, PlankBridge, WoodenFence } from "./props/Stonework";
import type { WorldQuality } from "./sceneConfig";
import { GARDEN_PATHS } from "./terrain";

/**
 * The Gift Garden. Trees vary in kind and height and frame the present
 * rather than surround it; paths lead the eye in from the bridge and the two
 * houses; flowers gather in drifts and beds instead of an even scatter.
 */
const TREES: { x: number; z: number; scale: number; seed: number; kind: TreeKind; blobs?: number }[] = [
  { x: -5.3, z: -1.0, scale: 1.12, seed: 3, kind: "round", blobs: 9 },
  { x: -1.9, z: -4.2, scale: 1.0, seed: 5, kind: "blossom", blobs: 8 },
  { x: 2.5, z: -4.4, scale: 1.0, seed: 8, kind: "tall" },
  { x: 6.4, z: 0.4, scale: 0.85, seed: 12, kind: "windswept", blobs: 6 },
  { x: -6.6, z: -3.1, scale: 0.95, seed: 14, kind: "tall" },
  { x: 5.7, z: -3.6, scale: 0.78, seed: 16, kind: "blossom", blobs: 6 },
  { x: -0.4, z: -5.4, scale: 0.8, seed: 18, kind: "round", blobs: 6 },
];

const SHRUBS: [number, number, number, string?][] = [
  [-2.5, 0.7, 0.85, "#f6b7c6"],
  [2.9, -1.6, 0.95],
  [-3.9, 3.0, 0.8, "#fff4d6"],
  [3.9, 1.8, 0.75, "#f4b496"],
  [1.3, -3.2, 0.9],
  [-0.9, 3.8, 0.7, "#c9b6ee"],
  [5.4, -1.0, 0.85],
  [-3.2, -1.2, 0.7],
  [-4.6, -0.2, 0.6, "#f6b7c6"],
  [4.4, -3.1, 0.7],
];

const FENCE: [number, number][] = [
  [1.95, 2.35],
  [2.6, 2.6],
  [3.25, 2.8],
  [3.9, 2.95],
  [4.55, 3.1],
  [5.2, 3.3],
];

/** Curved wall around the raised flower bed by the front-left garden. */
const BED_WALL: [number, number][] = [
  [-4.4, 2.2],
  [-3.6, 3.35],
  [-2.5, 3.6],
  [-1.7, 3.2],
];

/** A short terrace wall below the tower. */
const TOWER_WALL: [number, number][] = [
  [-5.0, -1.9],
  [-4.4, -1.35],
  [-3.6, -1.05],
];

const MUSHROOMS: [number, number][] = [
  [-4.8, -0.4],
  [-1.5, -3.7],
  [3.0, -3.9],
  [6.0, 0.95],
  [-2.2, 3.4],
  [-6.1, -2.6],
];

export function IslandEnvironment({ animate, quality, showPlayers = true }: { animate: boolean; quality: WorldQuality; showPlayers?: boolean }) {
  return (
    <group>
      <GiftPlatform />
      <GiftSurround animate={animate} />
      <PathStones />
      {GARDEN_PATHS.map((p, i) => (
        <SteppingStones key={i} points={p} seed={60 + i} />
      ))}
      <PlankBridge />
      <WoodenFence points={FENCE} />
      <GardenWall points={BED_WALL} seed={71} />
      <GardenWall points={TOWER_WALL} seed={73} height={3} />

      <StorybookTower x={-3.7} z={-2.7} rotationY={0.35} />
      <Cottage x={4.7} z={-2.6} rotationY={-0.5} animate={animate} />

      {TREES.map((t) => (
        <StylizedTree key={t.seed} {...t} />
      ))}
      {SHRUBS.map(([x, z, s, flowers], i) => (
        <Shrub key={i} x={x} z={z} scale={s} seed={100 + i} flowers={flowers} />
      ))}
      <Mushrooms spots={MUSHROOMS} seed={9} />

      {/* Beside the pedestal rather than in front of it, so it never stands between the camera and the present. */}
      <Lantern x={3.2} z={0.25} rotationY={-1.1} light animate={animate} />
      <Lantern x={3.6} z={4.25} rotationY={2.6} animate={animate} />
      <Lantern x={-1.7} z={1.35} rotationY={0.4} animate={animate} />

      <FlowerMeadow count={quality === "high" ? 420 : 220} />
      <MeadowGrass count={quality === "high" ? 460 : 220} />

      <AvatarCast animate={animate} cast={showPlayers} />
    </group>
  );
}
