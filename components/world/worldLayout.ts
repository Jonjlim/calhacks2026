import type { IslandShape } from "./terrain";

/**
 * Where every background landmark floats. Composed for two cameras at once:
 * the landing view (islands peek around the Gift Garden and through the sky
 * on the right) and the intro tour's wide reveal (camera over the tower,
 * looking out toward the castle). Islands sit at varied heights and depths so
 * nothing lines up, and the far ones are left to the fog.
 */

export interface IslandPlacement {
  position: [number, number, number];
  rotationY: number;
  shape: IslandShape;
  /** Bobbing amplitude / speed / phase. */
  bob: [number, number, number];
}

export const WORLD_LAYOUT = {
  /** Midground: readable, closest of the landmarks, strong parallax. */
  windmill: {
    position: [6, 2.2, -32],
    rotationY: 2.6,
    shape: { seed: 101, radius: 3.6, stretch: 1.25, depth: 4.6, hilliness: 0.55 },
    bob: [0.18, 0.33, 0.4],
  },
  /** Distant hero landmark, partly wrapped in cloud. */
  castle: {
    position: [-5, -3.6, -62],
    rotationY: 0.12,
    shape: { seed: 31, radius: 6.2, stretch: 1.3, depth: 8.5, hilliness: 0.45 },
    bob: [0.25, 0.24, 1.2],
  },
  /** Organic counterweight low on the left, below the Gift Garden's rim, rising out of the cloud sea. */
  gardens: {
    position: [-21.3, -13, -17.3],
    // Turned so the great tree stands on the right, clear of the landing buttons.
    rotationY: 3.84,
    shape: { seed: 141, radius: 4.0, stretch: 1.15, depth: 6.5, hilliness: 0.7 },
    bob: [0.22, 0.29, 2.2],
  },
  /** Small, tall silhouette far off above the left of the Gift Garden. */
  watchtower: {
    position: [-36, -2.7, -80],
    rotationY: -0.6,
    shape: { seed: 171, radius: 2.0, stretch: 1.1, depth: 4.2, hilliness: 0.4 },
    bob: [0.2, 0.37, 3.1],
  },
} satisfies Record<string, IslandPlacement>;

export type IsletKind = "tree" | "shrine" | "cottage" | "lamp" | "ruin";

export interface IsletPlacement {
  kind: IsletKind;
  position: [number, number, number];
  scale: number;
  seed: number;
}

export const ISLETS: IsletPlacement[] = [
  { kind: "tree", position: [16, 9, -14], scale: 0.9, seed: 201 },
  { kind: "shrine", position: [22, 4, -38], scale: 1.0, seed: 211 },
  { kind: "cottage", position: [-32, -1, -26], scale: 1.1, seed: 221 },
  { kind: "lamp", position: [14, -5, -6], scale: 0.9, seed: 231 },
  { kind: "ruin", position: [-14, 17, -26], scale: 1.0, seed: 241 },
];
