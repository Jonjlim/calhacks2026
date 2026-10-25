"use client";

import { Html, QuadraticBezierLine } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { sparkleTexture } from "../painterly/textures";

/**
 * One branch of the council's weave (D23 trial), drawn in the same hand as
 * Ally's MagicTrail. It is one continuous motion: the moment someone asks,
 * every memory sends out a branch whose tip "seeks", sweeping between the other
 * memories; when the council answers, branches from the memories a direction
 * combines keep growing and latch onto it ("kept"), the rest pull back home
 * ("retract"), and a refused idea's branch frays between the memories it cited
 * and snaps ("frayed"). Every target is a real node; nothing is invented.
 */
export type WeaveMode = "seek" | "kept" | "retract" | "frayed";

const N = 12;
/** How far out a seeking branch has grown when the answer arrives; kept branches carry on from here. */
export const SEEK_REACH = 0.42;
const SEEK_GROW = 0.5;
const SWEEP = 1.6;
const ATTACH = 0.75;
const RETRACT = 0.6;
const SNAP_AT = 0.55;
const SNAP_TIME = 1.0;
const FADE = 1.4;

const COLOR: Record<WeaveMode, string> = { seek: "#cdbff2", kept: "#b9aee6", retract: "#cdbff2", frayed: "#e08f8a" };

interface LineHandle { setPoints(start: THREE.Vector3, end: THREE.Vector3, mid: THREE.Vector3): void; material: THREE.Material & { opacity: number; dashOffset?: number } }

export function WeaveThread({ start, mid, end, mode, targets, delay = 0, label, animate }: {
  start: THREE.Vector3; mid: THREE.Vector3; end: THREE.Vector3; mode: WeaveMode;
  /** For "seek": the real nodes its tip sweeps between while the council thinks. */
  targets?: THREE.Vector3[]; delay?: number; label?: string; animate: boolean;
}) {
  const born = useRef(-1);
  const line = useRef<LineHandle | null>(null);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const tag = useRef<HTMLDivElement>(null);
  const color = COLOR[mode];
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()), []);
  const tip = useMemo(() => new THREE.Vector3(), []);
  const bend = useMemo(() => new THREE.Vector3(), []);
  const aim = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  // The same branch lives on from seeking to attaching or pulling back: it eases from where it was.
  const modeNow = useRef<WeaveMode | null>(null);
  const fromAim = useMemo(() => new THREE.Vector3(), []);
  const fromReach = useRef(0);
  const lastReach = useRef(0);

  useFrame(({ clock }) => {
    if (born.current < 0) born.current = clock.elapsedTime;
    if (modeNow.current !== mode) {
      if (modeNow.current !== null) {
        born.current = clock.elapsedTime;
        fromAim.copy(aim);
        fromReach.current = lastReach.current;
      } else {
        fromAim.copy(end);
        fromReach.current = SEEK_REACH;
      }
      modeNow.current = mode;
    }
    const age = Math.max(0, clock.elapsedTime - born.current - delay);
    const ease = (x: number) => THREE.MathUtils.smoothstep(x, 0, 1);

    // Where the branch aims, and how far along it the tip has grown (0 at the memory, 1 at the target).
    let reach: number;
    let glow: number;
    let fade = 1;
    aim.copy(end);
    if (mode === "seek") {
      const list = targets?.length ? targets : [end];
      // The tip drifts from one candidate to the next, never resting: the council weighing links.
      const phase = age / SWEEP;
      const a = list[Math.floor(phase) % list.length]!;
      const b = list[(Math.floor(phase) + 1) % list.length]!;
      aim.lerpVectors(a, b, ease(phase % 1));
      reach = (animate ? ease(age / SEEK_GROW) : 1) * (SEEK_REACH + 0.06 * Math.sin(age * 2.3 + start.x));
      glow = 0.5 + 0.2 * Math.sin(age * 5 + start.z);
    } else if (mode === "kept") {
      // Swing from wherever the seeking tip pointed onto the direction, growing the rest of the way.
      const k = animate ? ease(age / ATTACH) : 1;
      aim.lerpVectors(fromAim, end, k);
      reach = fromReach.current + (1 - fromReach.current) * k;
      glow = 0.55 + 0.4 * k;
    } else if (mode === "retract") {
      aim.copy(fromAim);
      reach = animate ? fromReach.current * (1 - ease(age / RETRACT)) : 0;
      glow = 0.4;
    } else {
      reach = animate ? Math.min(ease(age / ATTACH), SNAP_AT) : 0;
      const snapped = animate && age > SNAP_TIME;
      fade = snapped ? Math.max(0, 1 - (age - SNAP_TIME) / FADE) : 1;
      glow = 0.8;
    }

    lastReach.current = reach;
    // The visible branch: from the memory toward the aim, bowed upward like the map's other trails.
    tip.lerpVectors(start, aim, Math.max(0.001, reach));
    bend.lerpVectors(start, tip, 0.5);
    bend.y += (mid.y - (start.y + end.y) / 2) * Math.max(0.25, reach);
    curve.v0.copy(start);
    curve.v1.copy(bend);
    curve.v2.copy(tip);
    if (line.current) {
      line.current.setPoints(start, tip, bend);
      line.current.material.opacity = reach < 0.01 ? 0 : glow * fade * (mode === "kept" ? 0.8 : 0.55);
      if (mode === "frayed" && fade < 1 && "dashOffset" in line.current.material) line.current.material.dashOffset = (1 - fade) * 3;
    }
    sprites.current.forEach((sp, i) => {
      if (!sp) return;
      const u = (i / N + clock.elapsedTime * (0.12 + (i % 3) * 0.04)) % 1;
      curve.getPoint(u, p);
      sp.position.copy(p);
      const twinkle = 0.6 + 0.4 * Math.sin(clock.elapsedTime * 6 + i * 2.1);
      sp.scale.setScalar((mode === "kept" ? 0.75 : 0.5) * (0.6 + 0.6 * twinkle));
      sp.visible = animate && reach > 0.03 && fade > 0.02;
      (sp.material as THREE.SpriteMaterial).opacity = 0.85 * twinkle * fade * glow;
    });
    if (tag.current) tag.current.style.opacity = String(mode === "frayed" && animate ? Math.min(1, age * 2) * fade : 0);
  });

  return (
    <group>
      <QuadraticBezierLine ref={line as never} start={start} mid={mid} end={end} color={color} lineWidth={mode === "kept" ? 2.4 : 1.5}
        transparent opacity={0} dashed={mode === "frayed"} dashSize={0.35} gapSize={0.3} />
      {Array.from({ length: N }, (_, i) => (
        <sprite key={i} ref={(el) => void (sprites.current[i] = el)} material={mat.clone()} visible={false} />
      ))}
      {mode === "frayed" && label && (
        <Html position={new THREE.Vector3().lerpVectors(start, end, SNAP_AT * 0.5)} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
          <div ref={tag} style={{ opacity: 0, maxWidth: 200, padding: "4px 9px", borderRadius: 10, background: "rgb(251 247 240 / .92)", color: "#7a3a34", font: "600 11px var(--font-sans)", textAlign: "center", boxShadow: "0 6px 14px -8px rgb(40 24 44 / .7)", transition: "opacity .2s" }}>
            Thrown out: {label}
          </div>
        </Html>
      )}
    </group>
  );
}
