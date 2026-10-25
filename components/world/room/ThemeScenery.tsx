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
export type ThemeLook = "adventure" | "trips" | "creative" | "style" | "cozy" | "wishes" | "meadow";

export function lookFor(label: string, jar?: string): ThemeLook {
  const t = label.toLowerCase();
  if (/(trip|travel|journey|vacation|holiday|beach|flight|getaway|experience|tour)/.test(t)) return "trips";
  if (/(fashion|style|cloth|wear|jewel|accessor|outfit|shoe|bag|scarf|dress)/.test(t)) return "style";
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
  trips: {
    palette: pal("#a9c47c", "#dcdc9c", "#f4ecc0", "#8fb482", [[0, "#cdb98a"], [0.1, "#e8d2a2"], [0.3, "#f0c9a6"], [0.6, "#a9c6d8"], [1, "#7fa6c4"]]),
    shape: { seed: 811, radius: 2.3, stretch: 1.25, depth: 2.7, hilliness: 0.18 },
  },
  style: {
    palette: pal("#b9a8d8", "#dcd0f0", "#f3ecfb", "#a794c8", [[0, "#c4b4dc"], [0.1, "#e2c4d6"], [0.3, "#e8b9c9"], [0.6, "#c2a6d6"], [1, "#9e8cc8"]]),
    shape: { seed: 907, radius: 2.0, stretch: 1.08, depth: 3.1, hilliness: 0.2 },
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
  trips: { kind: "windswept", spots: [[-0.9, -0.1, 0.9], [1.0, 0.4, 0.75]] },
  style: { kind: "blossom", spots: [[-1.0, -0.2, 0.8], [0.95, 0.5, 0.65]] },
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

/** A little wooden signpost with two arrows: somewhere to go. */
function Signpost({ at, y }: { at: [number, number]; y: number }) {
  const wood = useMemo(() => paint("theme-wood", { color: "#a77a52" }), []);
  const board = useMemo(() => paint("theme-board", { color: "#e8cf9e" }), []);
  return (
    <group position={[at[0], y, at[1]]}>
      <mesh position={[0, 0.55, 0]} material={wood} castShadow><cylinderGeometry args={[0.05, 0.06, 1.1, 6]} /></mesh>
      <mesh position={[0.18, 0.95, 0]} rotation={[0, 0, 0.1]} material={board} castShadow><boxGeometry args={[0.55, 0.16, 0.05]} /></mesh>
      <mesh position={[-0.16, 0.72, 0]} rotation={[0, 0, -0.12]} material={board} castShadow><boxGeometry args={[0.5, 0.16, 0.05]} /></mesh>
    </group>
  );
}

/** A small boutique rail with a few garments hanging from it. */
function ClothesRack({ at, y }: { at: [number, number]; y: number }) {
  const wood = useMemo(() => paint("theme-wood", { color: "#a77a52" }), []);
  const cloth = ["#e8909c", "#a98bd8", "#f2c46d"].map((c) => paint(`theme-cloth-${c}`, { color: c }));
  return (
    <group position={[at[0], y, at[1]]}>
      <mesh position={[-0.45, 0.45, 0]} material={wood}><cylinderGeometry args={[0.04, 0.05, 0.9, 6]} /></mesh>
      <mesh position={[0.45, 0.45, 0]} material={wood}><cylinderGeometry args={[0.04, 0.05, 0.9, 6]} /></mesh>
      <mesh position={[0, 0.88, 0]} rotation={[0, 0, Math.PI / 2]} material={wood}><cylinderGeometry args={[0.03, 0.03, 1.0, 6]} /></mesh>
      {cloth.map((m, i) => (
        <mesh key={i} position={[-0.3 + i * 0.3, 0.62, 0]} material={m} castShadow><boxGeometry args={[0.2, 0.46, 0.05]} /></mesh>
      ))}
    </group>
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
      {look === "trips" && <Signpost at={[0.1, 0.2]} y={h(0.1, 0.2)} />}
      {look === "style" && <ClothesRack at={[0.1, 0.4]} y={h(0.1, 0.4)} />}
      {look === "creative" && <Rock at={[0.2, 0.7]} s={0.45} y={h(0.2, 0.7)} color="#d9a079" />}
      {(look === "cozy" || look === "wishes") && <Lantern x={look === "cozy" ? 0.2 : -0.3} z={look === "cozy" ? -0.7 : 0.8} y={h(look === "cozy" ? 0.2 : -0.3, look === "cozy" ? -0.7 : 0.8)} animate={animate} />}
    </group>
  );
}

/** A small floating object for one memory, shaped by the kind of thing it is. */
export const NOTE_SHAPE: Record<"interest" | "wish" | "moment", "note" | "star" | "charm"> = { interest: "note", wish: "star", moment: "charm" };

/** A small drawn badge for each kind of branch, so branches differ by more than their words. */
export function ThemeIcon({ look }: { look: ThemeLook }) {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  switch (look) {
    case "adventure":
      return <svg {...p}><path d="M2.5 19L9 8l4 6 2.5-3.5L21.5 19z" /><path d="M7.2 11.2l1.8 1.2 1.6-1" /></svg>;
    case "trips":
      return <svg {...p}><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2M4 13h16" /></svg>;
    case "creative":
      return <svg {...p}><path d="M15 4l5 5-9 9-5 1 1-5z" /><path d="M13 6l5 5" /></svg>;
    case "style":
      return <svg {...p}><path d="M12 7.5a2 2 0 1 0-2-2M12 7.5v2L3.5 16a1.5 1.5 0 0 0 1 2.7h15a1.5 1.5 0 0 0 1-2.7L12 9.5" /></svg>;
    case "cozy":
      return <svg {...p}><path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" /><path d="M16 10.5h1.5a2.2 2.2 0 0 1 0 4.4H16M8 5.5c0 1 .8 1 .8 2M12 5.5c0 1 .8 1 .8 2" /></svg>;
    case "wishes":
      return <svg {...p}><path d="M12 3.5l2.4 5.2 5.6.7-4.1 3.9 1 5.6L12 16.2 7.1 18.9l1-5.6L4 9.4l5.6-.7z" /></svg>;
    default:
      return <svg {...p}><circle cx="12" cy="9" r="2.4" /><path d="M12 6.6c0-2.2-3.2-2.2-3.2.2M12 6.6c0-2.2 3.2-2.2 3.2.2M9.6 9c-2.2 0-2.2 3 .2 3M14.4 9c2.2 0 2.2 3-.2 3M12 11.4V20M12 16c-2.5 0-3.4-1.6-3.4-3M12 17.5c2.2 0 3.2-1.4 3.2-2.8" /></svg>;
  }
}
