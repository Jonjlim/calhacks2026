"use client";

import { useMemo } from "react";
import type { IslandPalette, IslandShape } from "../terrain";
import { terrainHeight } from "../terrain";
import { MID_PALETTE } from "../islands/shared";
import { paint } from "../painterly/materials";
import { Lantern } from "../props/Lantern";
import { StylizedTree, type TreeKind } from "../props/Flora";

/**
 * Each theme island gets its own personality, so they stop looking like the same
 * grassy rock: an adventurous crag of pines and stone, a warm autumn craft
 * corner, a snowy cozy nook with a lantern, a blossoming wish garden. The style
 * is chosen from the theme's label words; the label itself, its count and every
 * memory in it still come from the room. These are decorative templates, not
 * claims about the recipient.
 */
export type ThemeLook = "adventure" | "creative" | "cozy" | "wishes" | "meadow";

export function lookFor(label: string, jar?: string): ThemeLook {
  const t = label.toLowerCase();
  if (/(hik|outdoor|trail|camp|adventure|mountain|travel|nature|bowl|sport|walk|run)/.test(t)) return "adventure";
  if (/(art|craft|pott|paint|creative|draw|music|design|make|cook|bak)/.test(t)) return "creative";
  if (/(cozy|home|tea|read|book|warm|moment|comfort|family|friend|memor)/.test(t) || jar === "moment") return "cozy";
  if (/(wish|dream|hope|star|gift|want)/.test(t) || jar === "wish") return "wishes";
  return "meadow";
}

const pal = (grassLow: string, grassHigh: string, grassSun: string, rim: string, strata: IslandPalette["strata"]): IslandPalette => ({ ...MID_PALETTE, grassLow, grassHigh, grassSun, rim, strata });

export const LOOKS: Record<ThemeLook, { palette: IslandPalette; shape: IslandShape }> = {
  adventure: {
    palette: pal("#4e8a55", "#86b27c", "#c8d9a4", "#487a50", [[0, "#6b8a64"], [0.1, "#a9aba8"], [0.3, "#b9b5ba"], [0.6, "#9b9db9"], [1, "#7d81a9"]]),
    shape: { seed: 411, radius: 2.2, stretch: 1.05, depth: 3.9, hilliness: 0.6 },
  },
  creative: {
    palette: pal("#a98a3b", "#d6a84b", "#f2d27c", "#a1752d", [[0, "#b08a45"], [0.1, "#d9a46f"], [0.3, "#d08c66"], [0.6, "#b87d83"], [1, "#9a6f8f"]]),
    shape: { seed: 523, radius: 2.3, stretch: 1.18, depth: 3.0, hilliness: 0.22 },
  },
  cozy: {
    palette: pal("#c6dde0", "#eef6f6", "#ffffff", "#b6ced6", [[0, "#cfe0e2"], [0.1, "#b5c8d8"], [0.3, "#a6b4d0"], [0.6, "#9aa0c8"], [1, "#8a8cba"]]),
    shape: { seed: 617, radius: 2.0, stretch: 1.1, depth: 3.3, hilliness: 0.3 },
  },
  wishes: {
    palette: pal("#8cb97c", "#bfdc92", "#ecf1b8", "#7fae6e", [[0, "#8fae6e"], [0.1, "#d7b4b4"], [0.3, "#e0b6c4"], [0.6, "#b9a2cf"], [1, "#9a8cc0"]]),
    shape: { seed: 733, radius: 2.15, stretch: 1.12, depth: 3.2, hilliness: 0.26 },
  },
  meadow: { palette: MID_PALETTE, shape: { seed: 317, radius: 2.1, stretch: 1.1, depth: 3.1, hilliness: 0.25 } },
};

const TREES: Record<ThemeLook, { kind: TreeKind; palette?: "green" | "autumn"; spots: [number, number, number][] }> = {
  adventure: { kind: "tall", spots: [[-0.9, -0.2, 1.05], [0.7, -0.7, 0.9], [-0.2, 0.8, 0.8], [1.15, 0.5, 0.7]] },
  creative: { kind: "round", palette: "autumn", spots: [[-0.9, -0.3, 0.85], [0.9, 0.2, 0.75]] },
  cozy: { kind: "tall", spots: [[-1.0, 0.1, 0.8], [0.95, -0.5, 0.7], [0.4, 0.9, 0.6]] },
  wishes: { kind: "blossom", spots: [[-0.8, -0.2, 0.95], [0.9, 0.3, 0.8]] },
  meadow: { kind: "round", spots: [[-0.9, -0.3, 0.7]] },
};

function Rock({ at, s, y, color }: { at: [number, number]; s: number; y: number; color: string }) {
  const mat = useMemo(() => paint(`theme-rock-${color}`, { color }), [color]);
  return (
    <mesh position={[at[0], y + s * 0.3, at[1]]} scale={[s, s * 0.7, s * 0.85]} material={mat} castShadow>
      <icosahedronGeometry args={[0.5, 0]} />
    </mesh>
  );
}

/** The island's own scenery: trees in the theme's character, a few stones, a lantern where the mood is warm. */
export function ThemeScenery({ look, animate }: { look: ThemeLook; animate: boolean }) {
  const shape = LOOKS[look].shape;
  const trees = TREES[look];
  const h = (x: number, z: number) => terrainHeight(shape, x, z);
  return (
    <group>
      {trees.spots.map(([x, z, scale], i) => (
        <StylizedTree key={i} x={x} z={z} scale={scale} seed={shape.seed + i * 7} kind={trees.kind} palette={trees.palette} y={h(x, z)} outline={false} />
      ))}
      {look === "adventure" && (
        <>
          <Rock at={[0.1, -0.1]} s={0.6} y={h(0.1, -0.1)} color="#a9a9b4" />
          <Rock at={[-0.5, 0.55]} s={0.4} y={h(-0.5, 0.55)} color="#b7b4bd" />
          <Rock at={[0.55, 0.15]} s={0.32} y={h(0.55, 0.15)} color="#9fa2b4" />
        </>
      )}
      {look === "creative" && <Rock at={[0.2, 0.7]} s={0.45} y={h(0.2, 0.7)} color="#d9a079" />}
      {(look === "cozy" || look === "wishes") && <Lantern x={look === "cozy" ? 0.2 : -0.3} z={look === "cozy" ? -0.7 : 0.8} y={h(look === "cozy" ? 0.2 : -0.3, look === "cozy" ? -0.7 : 0.8)} animate={animate} />}
    </group>
  );
}

/** A small floating object for one memory, shaped by the kind of thing it is. */
export const NOTE_SHAPE: Record<"interest" | "wish" | "moment", "note" | "star" | "charm"> = { interest: "note", wish: "star", moment: "charm" };
