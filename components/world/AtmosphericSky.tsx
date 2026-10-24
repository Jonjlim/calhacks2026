"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mulberry32 } from "./painterly/noise";
import { cloudTexture } from "./painterly/textures";
import { useScenePalette } from "./scenePalette";
import type { ScenePalette } from "./timeOfDay";
import { WORLD_LAYOUT } from "./worldLayout";

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Painted gradient: saturated zenith, airy mid-sky, hazy horizon, a soft
// sun/moon bloom and faint brush mottling so it never reads as a CSS gradient.
// At night a crisp moon disc and twinkling stars are layered on top.
const skyFragment = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uBelow;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uGlow;
  uniform float uDisc;
  uniform float uStars;
  uniform float uTime;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
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
    vec3 orb = normalize(uSunDir);
    float sun = max(dot(d, orb), 0.0);
    col += uSunColor * uGlow * (pow(sun, 6.0) * 0.28 + pow(sun, 60.0) * 0.35);

    if (uStars > 0.0) {
      vec3 cell = floor(d * 170.0);
      float pick = hash3(cell);
      vec3 centre = (cell + 0.5 + (vec3(hash3(cell + 1.7), hash3(cell + 3.1), hash3(cell + 5.3)) - 0.5) * 0.6) / 170.0;
      float dist = length(d - normalize(centre)) * 170.0;
      float star = step(0.985, pick) * smoothstep(0.55, 0.0, dist);
      float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + pick * 3.0) + pick * 60.0);
      // Fewer, dimmer stars towards the hazy horizon and none inside the moon's halo.
      float fade = smoothstep(0.02, 0.25, d.y) * (1.0 - smoothstep(0.96, 0.995, sun));
      col += vec3(1.0, 0.97, 0.9) * star * twinkle * fade * uStars * (0.55 + pick * 0.45);
    }

    if (uDisc > 0.0) {
      float disc = smoothstep(0.99935, 0.99955, sun);
      // A hint of maria so the moon reads as painted, not a white dot.
      float maria = vnoise((d.xy - orb.xy) * 900.0) * 0.18;
      col = mix(col, vec3(1.0, 0.98, 0.92) * (1.0 - maria), disc * uDisc);
    }

    vec2 uv = vec2(atan(d.z, d.x) * 3.0, d.y * 6.0);
    float brush = vnoise(uv * vec2(4.0, 1.5)) * 0.6 + vnoise(uv * 11.0) * 0.4;
    col *= 0.975 + brush * 0.05;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function SkyDome({ palette, animate }: { palette: ScenePalette; animate: boolean }) {
  const uniforms = useMemo(() => {
    const { sky } = palette;
    return {
      uZenith: { value: new THREE.Color(sky.zenith) },
      uMid: { value: new THREE.Color(sky.mid) },
      uHorizon: { value: new THREE.Color(sky.horizon) },
      uBelow: { value: new THREE.Color(sky.below) },
      uSunColor: { value: new THREE.Color(sky.glow) },
      uSunDir: { value: sky.orbDirection },
      uGlow: { value: sky.glowStrength },
      uDisc: { value: sky.disc },
      uStars: { value: sky.stars },
      uTime: { value: 0 },
    };
  }, [palette]);
  useFrame((_, dt) => {
    if (animate) uniforms.uTime.value += Math.min(dt, 0.1);
  });
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

/** Clouds drift this many times faster than the original, still-life pace. */
const CLOUD_SPEED = 3.2;

function buildClouds(): CloudSpec[] {
  const rng = mulberry32(99);
  const out: CloudSpec[] = [];
  const add = (count: number, f: (i: number) => Omit<CloudSpec, "seed" | "speed">, speed: number) => {
    for (let i = 0; i < count; i++) out.push({ ...f(i), seed: out.length % 9, speed: speed * CLOUD_SPEED * (0.6 + rng() * 0.8) });
  };
  // Opacities are deliberately low: the layers read as sheer veils that let the islands show through.
  // Sea of clouds beneath the island.
  add(16, (i) => ({ x: -56 + i * 7.5 + rng() * 4, y: -13 - rng() * 3, z: -26 + rng() * 24, w: 22 + rng() * 14, warm: rng() > 0.6, opacity: 0.5 + rng() * 0.15 }), 0.12);
  // Mid layer wrapping the underside of the island, partly in front of it.
  add(5, () => ({ x: -6 + rng() * 24, y: -9 - rng() * 3, z: 1 + rng() * 6, w: 10 + rng() * 6, warm: rng() > 0.5, opacity: 0.4 }), 0.18);
  // Mid-distance wisps drifting between the landmark islands.
  add(8, () => ({ x: -34 + rng() * 52, y: -4 + rng() * 9, z: -30 - rng() * 26, w: 9 + rng() * 9, warm: rng() > 0.5, opacity: 0.25 + rng() * 0.2 }), 0.14);
  // Horizon banks behind everything, in two depths.
  add(10, (i) => ({ x: -90 + i * 19 + rng() * 6, y: -9 + rng() * 5, z: -78 - rng() * 30, w: 26 + rng() * 16, warm: rng() > 0.5, opacity: 0.55 }), 0.06);
  add(9, (i) => ({ x: -150 + i * 36 + rng() * 10, y: -30 + rng() * 6, z: -125 - rng() * 20, w: 60 + rng() * 30, warm: rng() > 0.4, opacity: 0.65 }), 0.04);
  // High fair-weather clouds.
  add(6, () => ({ x: -50 + rng() * 90, y: 14 + rng() * 12, z: -60 - rng() * 40, w: 16 + rng() * 14, warm: rng() > 0.6, opacity: 0.35 + rng() * 0.15 }), 0.1);
  return out;
}

/**
 * The waterfall island (Hanging Gardens) must stay readable, so any cloud that
 * passes in front of it on screen fades out. Done in screen space so it holds
 * for the landing view and every camera move in the intro tour.
 */
const KEEP_CLEAR = {
  centre: new THREE.Vector3(WORLD_LAYOUT.gardens.position[0], WORLD_LAYOUT.gardens.position[1] - 2.5, WORLD_LAYOUT.gardens.position[2]),
  /** World-space radius covering the island and the foot of its waterfall. */
  radius: 7.5,
};

function useKeepClear() {
  const ndc = useMemo(() => new THREE.Vector3(), []);
  const zone = useMemo(() => new THREE.Vector3(), []);
  return (sprite: THREE.Sprite, width: number, camera: THREE.Camera, aspect: number): number => {
    const cam = camera as THREE.PerspectiveCamera;
    const zoneDepth = KEEP_CLEAR.centre.distanceTo(cam.position);
    const spriteDepth = sprite.position.distanceTo(cam.position);
    // Clouds behind the island are hidden by it anyway; only veils in front need clearing.
    if (spriteDepth > zoneDepth + KEEP_CLEAR.radius) return 1;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    zone.copy(KEEP_CLEAR.centre).project(cam);
    ndc.copy(sprite.position).project(cam);
    const dx = (ndc.x - zone.x) * aspect;
    const dy = ndc.y - zone.y;
    const distance = Math.hypot(dx, dy);
    const zoneR = KEEP_CLEAR.radius / (zoneDepth * tanHalf);
    // Puffs fill roughly the middle 60% of their sprite.
    const spriteR = (width * 0.3) / (Math.max(spriteDepth, 1) * tanHalf);
    const clear = zoneR + spriteR;
    return THREE.MathUtils.smoothstep(distance, clear * 0.75, clear * 1.2);
  };
}

function CloudLayer({ animate, tint }: { animate: boolean; tint: string }) {
  const specs = useMemo(buildClouds, []);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const keepClear = useKeepClear();
  useFrame(({ camera, size }, dt) => {
    const step = Math.min(dt, 0.1);
    const aspect = size.width / Math.max(1, size.height);
    specs.forEach((s, i) => {
      const sprite = refs.current[i];
      if (!sprite) return;
      if (animate) {
        sprite.position.x += s.speed * step;
        if (sprite.position.x > 90) sprite.position.x = -90;
      }
      (sprite.material as THREE.SpriteMaterial).opacity = s.opacity * keepClear(sprite, s.w, camera, aspect);
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
          <spriteMaterial map={cloudTexture(s.seed, s.warm)} color={tint} transparent depthWrite={false} opacity={s.opacity} />
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
function CloudDeck({ animate, tint }: { animate: boolean; tint: string }) {
  const map = useMemo(cloudDeckTexture, []);
  useFrame((_, dt) => {
    if (animate) map.offset.x += Math.min(dt, 0.1) * 0.004 * CLOUD_SPEED;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -19, -110]} renderOrder={-3}>
      <planeGeometry args={[900, 520]} />
      <meshBasicMaterial map={map} color={tint} depthWrite={false} transparent opacity={0.97} />
    </mesh>
  );
}

/** A few large, faint wisps right in front of the camera on the right-hand side, for depth on camera moves. */
function ForegroundWisps({ animate, tint }: { animate: boolean; tint: string }) {
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
      if (sp) sp.position.x = s.p[0] + Math.sin(clock.elapsedTime * 0.05 * CLOUD_SPEED + s.phase) * 2.5;
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
          <spriteMaterial map={cloudTexture(s.seed, true)} color={tint} transparent depthWrite={false} opacity={0.3} fog={false} />
        </sprite>
      ))}
    </>
  );
}

export function AtmosphericSky({ animate }: { animate: boolean }) {
  const palette = useScenePalette();
  return (
    <>
      <SkyDome palette={palette} animate={animate} />
      <CloudDeck animate={animate} tint={palette.deckTint} />
      <CloudLayer animate={animate} tint={palette.cloudTint} />
      <ForegroundWisps animate={animate} tint={palette.cloudTint} />
    </>
  );
}
