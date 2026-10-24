"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mulberry32 } from "./painterly/noise";
import { cloudTexture } from "./painterly/textures";

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Painted gradient: saturated zenith, airy mid-sky, warm haze at the horizon,
// a soft sun bloom and faint brush mottling so it never reads as a CSS gradient.
const skyFragment = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uBelow;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.2, 1.0);
    vec3 col = mix(uBelow, uHorizon, smoothstep(-0.22, -0.02, h));
    col = mix(col, uMid, smoothstep(-0.01, 0.1, h));
    col = mix(col, uZenith, smoothstep(0.06, 0.42, h));
    float sun = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(sun, 6.0) * 0.28 + pow(sun, 60.0) * 0.35);
    vec2 uv = vec2(atan(d.z, d.x) * 3.0, d.y * 6.0);
    float brush = vnoise(uv * vec2(4.0, 1.5)) * 0.6 + vnoise(uv * 11.0) * 0.4;
    col *= 0.975 + brush * 0.05;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const SUN_DIRECTION = new THREE.Vector3(0.55, 0.42, -0.72).normalize();

function SkyDome() {
  const uniforms = useMemo(
    () => ({
      uZenith: { value: new THREE.Color("#3f85d3") },
      uMid: { value: new THREE.Color("#a3cdef") },
      uHorizon: { value: new THREE.Color("#f3f1f2") },
      uBelow: { value: new THREE.Color("#a6bce6") },
      uSunColor: { value: new THREE.Color("#ffe3b0") },
      uSunDir: { value: SUN_DIRECTION },
    }),
    [],
  );
  return (
    <mesh renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[400, 48, 24]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={skyVertex}
        fragmentShader={skyFragment}
      />
    </mesh>
  );
}

interface CloudSpec {
  x: number;
  y: number;
  z: number;
  w: number;
  seed: number;
  warm: boolean;
  speed: number;
  opacity: number;
}

function buildClouds(): CloudSpec[] {
  const rng = mulberry32(99);
  const out: CloudSpec[] = [];
  const add = (count: number, f: (i: number) => Omit<CloudSpec, "seed" | "speed">, speed: number) => {
    for (let i = 0; i < count; i++) out.push({ ...f(i), seed: out.length % 9, speed: speed * (0.6 + rng() * 0.8) });
  };
  // Sea of clouds beneath the island.
  add(16, (i) => ({ x: -56 + i * 7.5 + rng() * 4, y: -13 - rng() * 3, z: -26 + rng() * 24, w: 22 + rng() * 14, warm: rng() > 0.6, opacity: 1 }), 0.12);
  // Mid layer wrapping the underside of the island, partly in front of it.
  add(5, () => ({ x: -6 + rng() * 24, y: -9 - rng() * 3, z: 1 + rng() * 6, w: 10 + rng() * 6, warm: rng() > 0.5, opacity: 0.95 }), 0.18);
  // Mid-distance wisps drifting between the landmark islands.
  add(8, () => ({ x: -34 + rng() * 52, y: -4 + rng() * 9, z: -30 - rng() * 26, w: 9 + rng() * 9, warm: rng() > 0.5, opacity: 0.5 + rng() * 0.3 }), 0.14);
  // Horizon banks behind everything, in two depths.
  add(10, (i) => ({ x: -90 + i * 19 + rng() * 6, y: -9 + rng() * 5, z: -78 - rng() * 30, w: 26 + rng() * 16, warm: rng() > 0.5, opacity: 0.9 }), 0.06);
  add(9, (i) => ({ x: -150 + i * 36 + rng() * 10, y: -30 + rng() * 6, z: -125 - rng() * 20, w: 60 + rng() * 30, warm: rng() > 0.4, opacity: 0.95 }), 0.04);
  // High fair-weather clouds.
  add(6, () => ({ x: -50 + rng() * 90, y: 14 + rng() * 12, z: -60 - rng() * 40, w: 16 + rng() * 14, warm: rng() > 0.6, opacity: 0.75 + rng() * 0.2 }), 0.1);
  return out;
}

function CloudLayer({ animate }: { animate: boolean }) {
  const specs = useMemo(buildClouds, []);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  useFrame((_, dt) => {
    if (!animate) return;
    const step = Math.min(dt, 0.1);
    specs.forEach((s, i) => {
      const sprite = refs.current[i];
      if (!sprite) return;
      sprite.position.x += s.speed * step;
      if (sprite.position.x > 90) sprite.position.x = -90;
    });
  });
  return (
    <group>
      {specs.map((s, i) => (
        <sprite
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[s.x, s.y, s.z]}
          scale={[s.w, s.w * 0.5, 1]}
        >
          <spriteMaterial map={cloudTexture(s.seed, s.warm)} transparent depthWrite={false} opacity={s.opacity} />
        </sprite>
      ))}
    </group>
  );
}

let deckTexture: THREE.CanvasTexture | null = null;

/** Lumpy painted cloud tops, tiled across the deck beneath the whole world. */
function cloudDeckTexture() {
  if (deckTexture) return deckTexture;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const rng = mulberry32(404);
  ctx.fillStyle = "#e9e6f1";
  ctx.fillRect(0, 0, S, S);
  ctx.filter = "blur(6px)";
  for (let i = 0; i < 260; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 14 + rng() * 44;
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S]) {
        const g = ctx.createRadialGradient(x + ox - r * 0.3, y + oy - r * 0.4, r * 0.1, x + ox, y + oy, r);
        g.addColorStop(0, rng() > 0.5 ? "rgba(255,250,242,0.95)" : "rgba(255,255,255,0.95)");
        g.addColorStop(0.7, "rgba(236,232,246,0.6)");
        g.addColorStop(1, "rgba(214,212,236,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  ctx.filter = "none";
  deckTexture = new THREE.CanvasTexture(c);
  deckTexture.colorSpace = THREE.SRGBColorSpace;
  deckTexture.wrapS = deckTexture.wrapT = THREE.RepeatWrapping;
  deckTexture.repeat.set(10, 7);
  return deckTexture;
}

/**
 * A wide, soft floor of cloud far beneath the islands. Without it, high tour
 * angles look straight down past the mountains into empty sky.
 */
function CloudDeck({ animate }: { animate: boolean }) {
  const map = useMemo(cloudDeckTexture, []);
  useFrame((_, dt) => {
    if (animate) map.offset.x += Math.min(dt, 0.1) * 0.004;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -19, -110]} renderOrder={-3}>
      <planeGeometry args={[900, 520]} />
      <meshBasicMaterial map={map} color="#f4f1f6" depthWrite={false} transparent opacity={0.97} />
    </mesh>
  );
}

/** A few large, faint wisps right in front of the camera on the right-hand side, for depth on camera moves. */
function ForegroundWisps({ animate }: { animate: boolean }) {
  const specs = useMemo(
    () => [
      { p: [13, -5.5, 12] as const, w: 16, seed: 3, phase: 0 },
      { p: [16, 9.5, 2] as const, w: 13, seed: 6, phase: 2 },
    ],
    [],
  );
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  useFrame(({ clock }) => {
    if (!animate) return;
    specs.forEach((s, i) => {
      const sp = refs.current[i];
      if (sp) sp.position.x = s.p[0] + Math.sin(clock.elapsedTime * 0.05 + s.phase) * 2.5;
    });
  });
  return (
    <>
      {specs.map((s, i) => (
        <sprite
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[...s.p]}
          scale={[s.w, s.w * 0.5, 1]}
          renderOrder={4}
        >
          <spriteMaterial map={cloudTexture(s.seed, true)} transparent depthWrite={false} opacity={0.42} fog={false} />
        </sprite>
      ))}
    </>
  );
}

export function AtmosphericSky({ animate }: { animate: boolean }) {
  return (
    <>
      <SkyDome />
      <CloudDeck animate={animate} />
      <CloudLayer animate={animate} />
      <ForegroundWisps animate={animate} />
    </>
  );
}
