"use client";

import { Outlines } from "@react-three/drei";

const WEIGHTS = { fine: 1.1, medium: 1.6, bold: 2.1 } as const;

/**
 * Selective hand-inked silhouette, slightly transparent so it reads as
 * pencil/ink over paint rather than a hard cartoon border.
 *
 * Line weight is in pixels: in drei 10.7.9 the shader's pixel-offset branch
 * runs when `screenspace` is false (and the world-offset branch when true),
 * so we deliberately leave it false.
 */
export function InkOutline({ weight = "medium", color = "#3d2c35", opacity = 0.75 }: { weight?: keyof typeof WEIGHTS; color?: string; opacity?: number }) {
  return <Outlines screenspace={false} thickness={WEIGHTS[weight]} color={color} opacity={opacity} transparent={opacity < 1} />;
}
