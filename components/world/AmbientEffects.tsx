"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mulberry32 } from "./painterly/noise";
import { foregroundLeavesTexture, sparkleTexture } from "./painterly/textures";

const particleVertex = /* glsl */ `
  attribute vec3 aVel;
  attribute float aBirth;
  attribute float aLife;
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uTime;
  uniform float uGravity;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float age = uTime - aBirth;
    float k = clamp(age / aLife, 0.0, 1.0);
    vec3 p = position + aVel * age + vec3(0.0, -uGravity * age * age, 0.0);
    // Gentle side-to-side drift so motes wander rather than slide.
    p.x += sin(age * 1.3 + aBirth) * 0.08;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float alive = step(0.0, age) * step(age, aLife);
    vFade = alive * smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.55, 1.0, k));
    vColor = aColor;
    gl_PointSize = aSize * uPixelRatio * (1300.0 / -mv.z) * (0.6 + 0.4 * sin(age * 9.0 + aBirth * 3.0));
  }
`;

const particleFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float a = tex.a * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * tex.rgb, a);
  }
`;

function useParticleMaterial(gravity: number) {
  const dpr = useThree((s) => s.viewport.dpr);
  return useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uGravity: { value: gravity },
          uPixelRatio: { value: dpr },
          uMap: { value: sparkleTexture() },
        },
        vertexShader: particleVertex,
        fragmentShader: particleFragment,
        transparent: true,
        depthWrite: false,
      }),
    [gravity, dpr],
  );
}

function particleGeometry(count: number) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("aVel", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("aBirth", new THREE.BufferAttribute(new Float32Array(count).fill(-999), 1));
  geo.setAttribute("aLife", new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(count), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
  return geo;
}

export interface SparkleHandle {
  burst: (origin: THREE.Vector3, variant: number) => void;
}

const BURST_PALETTES = [
  ["#ffe6a3", "#fff8e6", "#f2b8a6"],
  ["#fff1c2", "#d9c8ff", "#ffffff"],
  ["#ffd98a", "#ffc2b3", "#fffbe9"],
];

/** Pool of sparkles fired from the gift when it is clicked. */
export const SparkleBurst = forwardRef<SparkleHandle>(function SparkleBurst(_, ref) {
  const count = 72;
  const geo = useMemo(() => particleGeometry(count), []);
  const mat = useParticleMaterial(0.9);
  const cursor = useRef(0);
  const rng = useMemo(() => mulberry32(5), []);
  const color = useMemo(() => new THREE.Color(), []);

  useImperativeHandle(ref, () => ({
    burst(origin, variant) {
      const now = mat.uniforms.uTime!.value as number;
      const pos = geo.getAttribute("position") as THREE.BufferAttribute;
      const vel = geo.getAttribute("aVel") as THREE.BufferAttribute;
      const birth = geo.getAttribute("aBirth") as THREE.BufferAttribute;
      const life = geo.getAttribute("aLife") as THREE.BufferAttribute;
      const col = geo.getAttribute("aColor") as THREE.BufferAttribute;
      const size = geo.getAttribute("aSize") as THREE.BufferAttribute;
      const palette = BURST_PALETTES[variant % BURST_PALETTES.length]!;
      const n = 18 + Math.floor(rng() * 8);
      for (let k = 0; k < n; k++) {
        const i = cursor.current++ % count;
        const a = rng() * Math.PI * 2;
        const up = 1.3 + rng() * 1.4;
        const out = 0.6 + rng() * 1.1;
        pos.setXYZ(i, origin.x + Math.cos(a) * 0.3, origin.y + rng() * 0.2, origin.z + Math.sin(a) * 0.3);
        vel.setXYZ(i, Math.cos(a) * out, up, Math.sin(a) * out);
        birth.setX(i, now + rng() * 0.08);
        life.setX(i, 0.9 + rng() * 0.6);
        color.set(palette[k % palette.length]!);
        col.setXYZ(i, color.r, color.g, color.b);
        size.setX(i, 0.18 + rng() * 0.2);
      }
      for (const attr of [pos, vel, birth, life, col, size]) attr.needsUpdate = true;
    },
  }));

  useFrame((_, dt) => {
    mat.uniforms.uTime!.value += Math.min(dt, 0.1);
  });

  return <points geometry={geo} material={mat} frustumCulled={false} />;
});

/** A restrained number of drifting golden motes around the island. */
export function MagicMotes({ animate, count = 34 }: { animate: boolean; count?: number }) {
  const geo = useMemo(() => particleGeometry(count), [count]);
  const mat = useParticleMaterial(-0.004);
  const rng = useMemo(() => mulberry32(21), []);

  const respawn = (i: number, now: number) => {
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const vel = geo.getAttribute("aVel") as THREE.BufferAttribute;
    const birth = geo.getAttribute("aBirth") as THREE.BufferAttribute;
    const life = geo.getAttribute("aLife") as THREE.BufferAttribute;
    const col = geo.getAttribute("aColor") as THREE.BufferAttribute;
    const size = geo.getAttribute("aSize") as THREE.BufferAttribute;
    pos.setXYZ(i, (rng() - 0.5) * 14, 0.3 + rng() * 3.5, (rng() - 0.5) * 10);
    vel.setXYZ(i, (rng() - 0.5) * 0.15, 0.06 + rng() * 0.1, (rng() - 0.5) * 0.15);
    birth.setX(i, now - (animate ? 0 : rng() * 3));
    life.setX(i, animate ? 5 + rng() * 6 : 1e6);
    const c = new THREE.Color(rng() > 0.3 ? "#ffe9a8" : "#fff8ee");
    col.setXYZ(i, c.r, c.g, c.b);
    size.setX(i, 0.07 + rng() * 0.08);
    for (const attr of [pos, vel, birth, life, col, size]) attr.needsUpdate = true;
  };

  useLayoutEffect(() => {
    for (let i = 0; i < count; i++) respawn(i, -rng() * 8);
    // respawn is stable for a given geometry; re-seed only when the pool changes.
  }, [geo]);

  useFrame((_, dt) => {
    if (!animate) return;
    const now = (mat.uniforms.uTime!.value += Math.min(dt, 0.1));
    const birth = geo.getAttribute("aBirth") as THREE.BufferAttribute;
    const life = geo.getAttribute("aLife") as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      if (now - birth.getX(i) > life.getX(i)) respawn(i, now);
    }
  });

  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

/**
 * Out-of-focus leafy branches in the corners nearest the camera. They frame
 * the island like an illustrator's foreground plane and sway very slightly.
 */
export function ForegroundFoliage({ animate }: { animate: boolean }) {
  const camera = useThree((s) => s.camera);
  const leaves = useRef<(THREE.Mesh | null)[]>([]);
  const specs = useMemo(
    () => [
      { seed: 1, pos: [9.4, -1.6, 9.5] as const, rot: 0.1, scale: 5.2, flip: false },
      { seed: 2, pos: [12.2, 5.6, 4.0] as const, rot: Math.PI * 0.95, scale: 4.4, flip: true },
    ],
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    leaves.current.forEach((m, i) => {
      if (!m) return;
      m.quaternion.copy(camera.quaternion);
      m.rotateZ(specs[i]!.rot + (animate ? Math.sin(t * 0.8 + i * 2) * 0.025 : 0));
    });
  });
  return (
    <>
      {specs.map((s, i) => (
        <mesh
          key={s.seed}
          ref={(el) => {
            leaves.current[i] = el;
          }}
          position={s.pos}
          scale={[s.flip ? -s.scale : s.scale, s.scale, 1]}
          renderOrder={5}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={foregroundLeavesTexture(s.seed)} transparent depthWrite={false} opacity={0.92} fog={false} color="#8fa07a" />
        </mesh>
      ))}
    </>
  );
}

const BIRD_COUNT = 7;

/**
 * A loose flock that crosses the sky every minute or so: small dark V shapes
 * with flapping wings, gliding between beats. Visible only part of the loop,
 * so they read as occasional rather than constant.
 */
export function Birds({ animate }: { animate: boolean }) {
  const birds = useRef<(THREE.Group | null)[]>([]);
  const wings = useRef<(THREE.Mesh | null)[]>([]);
  const wingGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // One wing: a thin swept triangle from the body outward.
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.05, 0, 0, -0.06, 0.34, 0.02, -0.12], 3));
    g.computeVertexNormals();
    return g;
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#5a4a5c", side: THREE.DoubleSide, transparent: true, opacity: 0.8 }), []);
  const offsets = useMemo(() => {
    const rng = mulberry32(77);
    return Array.from({ length: BIRD_COUNT }, (_, i) => ({ lag: i * 0.9 + rng() * 0.6, dx: (rng() - 0.5) * 3, dy: (rng() - 0.5) * 1.6, dz: (rng() - 0.5) * 3, flap: 7 + rng() * 2, phase: rng() * 6 }));
  }, []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    if (!animate) return;
    const t = clock.elapsedTime;
    offsets.forEach((o, i) => {
      const bird = birds.current[i];
      if (!bird) return;
      // 70 s loop: a wide arc across the sky behind the island, then far out of view.
      const u = ((t - o.lag + 20) % 70) / 70;
      const path = (k: number, out: THREE.Vector3) => out.set(-60 + k * 120, 11 + Math.sin(k * Math.PI) * 4, -26 - Math.sin(k * Math.PI * 2) * 8);
      path(u, p).add(new THREE.Vector3(o.dx, o.dy, o.dz));
      path(u + 0.002, q).add(new THREE.Vector3(o.dx, o.dy, o.dz));
      bird.position.copy(p);
      // +z faces along the flight path; wings span ±x.
      bird.lookAt(q);
      const beat = Math.sin(t * o.flap + o.phase);
      // Bursts of flapping, then a glide.
      const gliding = Math.sin(t * 0.6 + o.phase) > 0.4;
      const a = gliding ? 0.1 : beat * 0.65;
      const l = wings.current[i * 2];
      const r = wings.current[i * 2 + 1];
      if (l) l.rotation.z = a;
      if (r) r.rotation.z = a;
    });
  });

  return (
    <>
      {offsets.map((_, i) => (
        <group
          key={i}
          ref={(el) => {
            birds.current[i] = el;
          }}
          scale={1.4}
        >
          <mesh
            ref={(el) => {
              wings.current[i * 2] = el;
            }}
            geometry={wingGeo}
            material={mat}
            scale={[-1, 1, 1]}
          />
          <mesh
            ref={(el) => {
              wings.current[i * 2 + 1] = el;
            }}
            geometry={wingGeo}
            material={mat}
          />
        </group>
      ))}
    </>
  );
}
