"use client";

import { Html, QuadraticBezierLine } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { sparkleTexture } from "../painterly/textures";

/**
 * One thread of the council's weave (D23 trial), drawn in the same hand as
 * Ally's MagicTrail. Every thread is a real link: "reach" joins memories the
 * council is weighing while it thinks; "kept" grows from a memory into the
 * direction that combines it; "frayed" starts between the memories a refused
 * idea cited, then snaps and fades with the checks' reason beside it.
 */
export type WeaveMode = "reach" | "kept" | "frayed";

const N = 14;
const GROW = 1.1;
/** A frayed thread grows this far toward its end before it snaps. */
const SNAP_AT = 0.55;
const SNAP_TIME = 1.0;
const FADE = 1.4;

const COLOR: Record<WeaveMode, string> = { reach: "#cdbff2", kept: "#b9aee6", frayed: "#e08f8a" };

export function WeaveThread({ start, mid, end, mode, delay = 0, label, animate }: {
  start: THREE.Vector3; mid: THREE.Vector3; end: THREE.Vector3; mode: WeaveMode; delay?: number; label?: string; animate: boolean;
}) {
  const born = useRef(-1);
  const line = useRef<{ material: THREE.Material & { opacity: number; dashOffset?: number } } | null>(null);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const tag = useRef<HTMLDivElement>(null);
  const color = COLOR[mode];
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(start.clone(), mid.clone(), end.clone()), [start, mid, end]);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  const p = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    if (born.current < 0) born.current = clock.elapsedTime;
    const age = Math.max(0, clock.elapsedTime - born.current - delay);
    // Without motion the weave shows its end state: kept threads drawn, nothing reaching or fraying.
    const grow = !animate ? 1 : THREE.MathUtils.smoothstep(age / GROW, 0, 1);
    const reach = mode === "frayed" ? Math.min(grow, SNAP_AT) : grow;
    const snapped = mode === "frayed" && animate && age > SNAP_TIME;
    const fade = snapped ? Math.max(0, 1 - (age - SNAP_TIME) / FADE) : 1;
    const flicker = mode === "reach" ? 0.45 + 0.35 * Math.sin(clock.elapsedTime * 7 + start.x) : 1;
    const strength = (mode === "kept" ? 0.75 : mode === "frayed" ? 0.7 : 0.28) * fade * flicker;
    if (line.current) {
      line.current.material.opacity = (animate || mode === "kept" ? strength : 0) * Math.min(1, reach * 3);
      // A snapped thread jitters apart as it fades.
      if (snapped && "dashOffset" in line.current.material) line.current.material.dashOffset = (age - SNAP_TIME) * 2.5;
    }
    sprites.current.forEach((sp, i) => {
      if (!sp) return;
      const u = ((i / N + clock.elapsedTime * (0.09 + (i % 3) * 0.03)) % 1) * reach;
      curve.getPoint(u, p);
      sp.position.copy(p);
      const twinkle = 0.6 + 0.4 * Math.sin(clock.elapsedTime * 6 + i * 2.1);
      sp.scale.setScalar((mode === "kept" ? 0.75 : 0.5) * (0.6 + 0.6 * twinkle));
      sp.visible = animate && reach > 0.02 && fade > 0.02 && mode !== "reach";
      (sp.material as THREE.SpriteMaterial).opacity = 0.85 * twinkle * fade * Math.min(1, u * 8);
    });
    if (tag.current) tag.current.style.opacity = String(mode === "frayed" && animate ? Math.min(1, age * 2) * fade : 0);
  });

  return (
    <group>
      <QuadraticBezierLine ref={line as never} start={start} mid={mid} end={end} color={color} lineWidth={mode === "kept" ? 2.4 : 1.4}
        transparent opacity={0} dashed={mode !== "kept"} dashSize={mode === "frayed" ? 0.35 : 0.6} gapSize={mode === "frayed" ? 0.3 : 0.4} />
      {Array.from({ length: N }, (_, i) => (
        <sprite key={i} ref={(el) => void (sprites.current[i] = el)} material={mat.clone()} visible={false} />
      ))}
      {mode === "frayed" && label && (
        <Html position={curve.getPoint(SNAP_AT * 0.5)} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
          <div ref={tag} style={{ opacity: 0, maxWidth: 200, padding: "4px 9px", borderRadius: 10, background: "rgb(251 247 240 / .92)", color: "#7a3a34", font: "600 11px var(--font-sans)", textAlign: "center", boxShadow: "0 6px 14px -8px rgb(40 24 44 / .7)", transition: "opacity .2s" }}>
            Thrown out: {label}
          </div>
        </Html>
      )}
    </group>
  );
}
