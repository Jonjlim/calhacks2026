"use client";

import { QuadraticBezierLine } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { sparkleTexture } from "../painterly/textures";

/**
 * A relationship on the map, drawn as a magical trail rather than a graph
 * line: a fine curved thread that grows out from where it starts, with small
 * lights drifting along it toward where it ends. It is only mounted for the
 * branch in focus, so it grows each time something is chosen. Thin, curved,
 * and never lit all at once.
 */
const N = 18;
const GROW = 0.9;

export function MagicTrail({ start, mid, end, color, strong = false, dim = false }: { start: THREE.Vector3; mid: THREE.Vector3; end: THREE.Vector3; color: string; strong?: boolean; dim?: boolean }) {
  const born = useRef(-1);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(start.clone(), mid.clone(), end.clone()), [start, mid, end]);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    if (born.current < 0) born.current = clock.elapsedTime;
    const age = clock.elapsedTime - born.current;
    const grow = THREE.MathUtils.smoothstep(age / GROW, 0, 1);
    sprites.current.forEach((sp, i) => {
      if (!sp) return;
      // Lights ride along the thread, each at its own pace, never past the growing tip.
      const u = ((i / N + clock.elapsedTime * (0.07 + (i % 3) * 0.02)) % 1) * grow;
      curve.getPoint(u, p);
      sp.position.copy(p);
      const twinkle = 0.6 + 0.4 * Math.sin(clock.elapsedTime * 6 + i * 2.1);
      sp.scale.setScalar((strong ? 0.8 : 0.55) * (0.6 + 0.6 * twinkle));
      sp.visible = grow > 0.02;
      (sp.material as THREE.SpriteMaterial).opacity = (dim ? 0.25 : 0.85) * twinkle * Math.min(1, u * 8);
    });
  });
  return (
    <group>
      <QuadraticBezierLine start={start} mid={mid} end={end} color={color} lineWidth={strong ? 2.2 : 1.3} transparent opacity={dim ? 0.12 : 0.5} dashed dashSize={0.5} gapSize={0.28} />
      {Array.from({ length: N }, (_, i) => (
        <sprite key={i} ref={(el) => void (sprites.current[i] = el)} material={mat.clone()} visible={false} />
      ))}
    </group>
  );
}
