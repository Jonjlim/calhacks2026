"use client";

import { InkOutline } from "@/components/world/painterly/InkOutline";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { wobble } from "../geometry";
import { mulberry32 } from "../painterly/noise";
import { paint } from "../painterly/materials";
import { stoneTexture, woodTexture } from "../painterly/textures";
import { GIFT_SPOT } from "../sceneConfig";
import { groundAt, PATH_POINTS } from "../terrain";

const INK = "#3d2c35";

function ringStoneMaterial() {
  const map = stoneTexture().clone();
  map.repeat.set(4, 0.6);
  map.needsUpdate = true;
  return paint("stone-ring", { map, color: "#f4efe8" });
}

const PLATFORM_SCALE = 1.15;

/** World-space height of the gift platform's top face. */
export function platformTop(): number {
  return groundAt(GIFT_SPOT.x, GIFT_SPOT.z) + 0.62 * PLATFORM_SCALE;
}

export function GiftPlatform() {
  const base = groundAt(GIFT_SPOT.x, GIFT_SPOT.z);
  const lower = useMemo(() => wobble(new THREE.CylinderGeometry(1.78, 1.92, 0.42, 22, 2), 0.025, 2), []);
  const upper = useMemo(() => wobble(new THREE.CylinderGeometry(1.38, 1.48, 0.3, 20, 2), 0.02, 4), []);
  const steps = useMemo(() => [0, 1, 2].map((i) => wobble(new THREE.BoxGeometry(1.05 - i * 0.04, 0.18, 0.38, 3, 1, 2), 0.018, 10 + i)), []);
  const mat = ringStoneMaterial();
  const capMat = paint("stone-cap", { map: stoneTexture(), color: "#f6f1ea" });
  return (
    <group position={[GIFT_SPOT.x, base, GIFT_SPOT.z]} scale={PLATFORM_SCALE} userData={{ sketch: 5 }}>
      <mesh geometry={lower} position={[0, 0.12, 0]} material={[mat, capMat, capMat]} castShadow receiveShadow>
        <InkOutline weight="medium" color={INK} />
      </mesh>
      <mesh geometry={upper} position={[0, 0.47, 0]} material={[mat, capMat, capMat]} castShadow receiveShadow>
        <InkOutline weight="medium" color={INK} />
      </mesh>
      {steps.map((g, i) => (
        <mesh key={i} geometry={g} position={[0.02 * i, 0.24 - i * 0.16, 1.95 + i * 0.34]} material={capMat} castShadow receiveShadow>
          <InkOutline weight="fine" color={INK} />
        </mesh>
      ))}
    </group>
  );
}

/** Flagstones along the path, one instanced draw. */
export function PathStones() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const curve = useMemo(
    () => new THREE.CatmullRomCurve3(PATH_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal"),
    [],
  );
  const count = 64;
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rng = mulberry32(13);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const color = new THREE.Color();
    const len = curve.getLength();
    let placed = 0;
    for (let d = 0.15; d < len && placed < count; d += 0.36) {
      const t = d / len;
      curve.getPointAt(t, p);
      curve.getTangentAt(t, tan);
      const side = new THREE.Vector3(-tan.z, 0, tan.x);
      for (const off of [-0.22, 0.22]) {
        if (placed >= count || rng() < 0.12) continue;
        const x = p.x + side.x * (off + (rng() - 0.5) * 0.12);
        const z = p.z + side.z * (off + (rng() - 0.5) * 0.12) + (rng() - 0.5) * 0.08;
        const s = 0.85 + rng() * 0.35;
        m.compose(new THREE.Vector3(x, groundAt(x, z) + 0.01, z), q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.08, rng() * 6, (rng() - 0.5) * 0.08)), new THREE.Vector3(s, 1, s * (0.8 + rng() * 0.3)));
        mesh.setMatrixAt(placed, m);
        mesh.setColorAt(placed, color.set(["#f3ece2", "#e6ddd4", "#efe6d5"][placed % 3]!));
        placed++;
      }
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [curve]);
  const geo = useMemo(() => wobble(new THREE.CylinderGeometry(0.2, 0.22, 0.08, 7, 1), 0.02, 3), []);
  return <instancedMesh ref={ref} args={[geo, paint("stone-cap", { map: stoneTexture(), color: "#f6f1ea" }), count]} castShadow receiveShadow userData={{ sketch: 5 }} />;
}

/** A crooked wooden fence: posts with two rails, following a list of ground points. */
export function WoodenFence({ points }: { points: [number, number][] }) {
  const parts = useMemo(() => {
    const rng = mulberry32(points.length * 7 + 1);
    const posts = points.map(([x, z]) => ({ x, z, y: groundAt(x, z), tilt: (rng() - 0.5) * 0.12, h: 0.55 + rng() * 0.08 }));
    const rails = posts.slice(1).map((b, i) => {
      const a = posts[i]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: (a.y + b.y) / 2, len, angle: -Math.atan2(b.z - a.z, b.x - a.x), sag: (rng() - 0.5) * 0.05 };
    });
    return { posts, rails };
  }, [points]);
  const wood = paint("fence-wood", { map: woodTexture(), color: "#d2a983" });
  return (
    <group userData={{ sketch: 9 }}>
      {parts.posts.map((p, i) => (
        <mesh key={`p${i}`} position={[p.x, p.y + p.h / 2 - 0.05, p.z]} rotation={[p.tilt, i, p.tilt * 0.6]} material={wood} castShadow>
          <cylinderGeometry args={[0.045, 0.055, p.h, 6]} />
          <InkOutline weight="fine" color={INK} />
        </mesh>
      ))}
      {parts.rails.map((r, i) =>
        [0.2, 0.4].map((h) => (
          <mesh key={`r${i}-${h}`} position={[r.x, r.y + h + r.sag, r.z]} rotation={[0, r.angle, r.sag]} material={wood} castShadow>
            <boxGeometry args={[r.len + 0.06, 0.05, 0.035]} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Plank bridge from the path's end out over the clouds to a tiny islet. */
export function PlankBridge({ length = 4.4 }: { length?: number }) {
  const [sx, sz] = PATH_POINTS[PATH_POINTS.length - 1]!;
  const dir = new THREE.Vector3(1, 0, 0.32).normalize();
  const angle = -Math.atan2(dir.z, dir.x);
  const startY = groundAt(sx, sz) + 0.02;
  const planks = useMemo(() => {
    const rng = mulberry32(77);
    const n = Math.floor(length / 0.22);
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return { d: 0.2 + t * length, y: -Math.sin(t * Math.PI) * 0.35 - t * 0.15, r: (rng() - 0.5) * 0.08, w: 0.92 + rng() * 0.12, c: rng() };
    });
  }, [length]);
  const wood = paint("bridge-wood", { map: woodTexture(), color: "#e0b892" });
  // A few plank tones so the deck reads as salvaged, hand-laid timber.
  const planksMats = [wood, paint("bridge-wood-dark", { map: woodTexture(), color: "#c99a74" }), paint("bridge-wood-pale", { map: woodTexture(), color: "#ecc9a4" })];
  const hangers = useMemo(() => {
    const out: { d: number; side: number; top: number; bottom: number }[] = [];
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      for (const side of [-0.5, 0.5]) out.push({ d: 0.2 + t * length, side, top: 0.55 - Math.sin(t * Math.PI) * 0.42 - t * 0.15, bottom: -Math.sin(t * Math.PI) * 0.35 - t * 0.15 });
    }
    return out;
  }, [length]);
  const rope = useMemo(() => {
    const geos = [-0.5, 0.5].map((side) => {
      const pts = Array.from({ length: 12 }, (_, i) => {
        const t = i / 11;
        return new THREE.Vector3(0.2 + t * length, 0.55 - Math.sin(t * Math.PI) * 0.42 - t * 0.15, side);
      });
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.018, 5);
    });
    return geos;
  }, [length]);
  return (
    <group position={[sx, startY, sz]} rotation={[0, angle, 0]} userData={{ sketch: 5 }}>
      {planks.map((p, i) => (
        <mesh key={i} position={[p.d, p.y, 0]} rotation={[p.r, (p.c - 0.5) * 0.08, 0]} material={planksMats[Math.floor(p.c * 3)]!} castShadow receiveShadow>
          <boxGeometry args={[0.17, 0.05, p.w]} />
        </mesh>
      ))}
      {rope.map((g, i) => (
        <mesh key={i} geometry={g} material={paint("rope", { color: "#b99a74" })} />
      ))}
      {hangers.map((h, i) => (
        <mesh key={`h${i}`} position={[h.d, (h.top + h.bottom) / 2, h.side * 0.97]} material={paint("rope", { color: "#b99a74" })}>
          <cylinderGeometry args={[0.008, 0.008, h.top - h.bottom, 3]} />
        </mesh>
      ))}
      {[0.1, length + 0.25].flatMap((d, k) =>
        [-0.5, 0.5].map((side) => (
          <group key={`${k}${side}`} position={[d, (k ? -0.15 : 0) + 0.25, side]}>
            <mesh material={wood} castShadow>
              <cylinderGeometry args={[0.05, 0.06, 0.7, 6]} />
              <InkOutline weight="fine" color={INK} />
            </mesh>
            <mesh position={[0, 0.36, 0]} material={paint("moss", {})} scale={[0.75, 0.5, 0.75]}>
              <sphereGeometry args={[0.09, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

/** World position of the far end of the bridge, for the islet it lands on. */
export function bridgeEnd(length = 4.4): THREE.Vector3 {
  const [sx, sz] = PATH_POINTS[PATH_POINTS.length - 1]!;
  const dir = new THREE.Vector3(1, 0, 0.32).normalize();
  return new THREE.Vector3(sx, groundAt(sx, sz) - 0.15, sz).addScaledVector(dir, length + 0.9);
}
