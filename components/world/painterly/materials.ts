import * as THREE from "three";
import { toonRamp } from "./textures";

/**
 * Shared painterly material factory. Every lit surface uses MeshToonMaterial
 * with a soft-stepped ramp, so shadows fall in gouache-like plateaus while
 * the hemisphere light keeps shadow sides cool and lavender.
 */

export const windUniforms = { uTime: { value: 0 } };

interface PaintOptions {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** Sway vertices by height (instanced foliage, flowers, vines). */
  wind?: number;
  /** Sway by depth below y = 0 instead of height above it (hanging vines). */
  windHang?: boolean;
  fog?: boolean;
}

const materialCache = new Map<string, THREE.MeshToonMaterial>();

export function paint(key: string, opts: PaintOptions): THREE.MeshToonMaterial {
  const hit = materialCache.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? "#ffffff",
    map: opts.map ?? null,
    gradientMap: toonRamp(),
    vertexColors: opts.vertexColors ?? false,
    emissive: opts.emissive ?? "#000000",
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    fog: opts.fog ?? true,
  });
  if (opts.wind) addWind(mat, opts.wind, opts.windHang ?? false);
  materialCache.set(key, mat);
  return mat;
}

function addWind(mat: THREE.Material, strength: number, hang: boolean) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec2 windSeed = vec2(0.0);
        #ifdef USE_INSTANCING
          windSeed = instanceMatrix[3].xz;
        #endif
        float windH = max(${hang ? "-position.y" : "position.y"}, 0.0);
        float gust = sin(uTime * 1.3 + windSeed.x * 0.6 + windSeed.y * 0.4) * 0.6
                   + sin(uTime * 2.7 + windSeed.x * 1.7) * 0.25;
        transformed.x += gust * windH * windH * ${strength.toFixed(3)};
        transformed.z += cos(uTime * 1.1 + windSeed.y * 0.8) * windH * windH * ${(strength * 0.5).toFixed(3)};`,
      );
  };
  mat.customProgramCacheKey = () => `wind-${strength}-${hang}`;
}

let flagMaterial: THREE.MeshToonMaterial | null = null;

/**
 * Cloth that flutters along its local +x (away from the pole). Flags are
 * modelled with the hoist at x = 0; the wave grows toward the fly end.
 */
export function flagCloth(): THREE.MeshToonMaterial {
  if (flagMaterial) return flagMaterial;
  const mat = new THREE.MeshToonMaterial({ color: "#ffffff", vertexColors: true, gradientMap: toonRamp(), side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float flagSeed = dot(modelMatrix[3].xyz, vec3(0.37, 0.11, 0.53));
        float fly = max(position.x, 0.0);
        transformed.z += sin(uTime * 3.2 - fly * 9.0 + flagSeed) * fly * 0.22;
        transformed.y += sin(uTime * 2.1 - fly * 6.0 + flagSeed) * fly * 0.05;`,
      );
  };
  mat.customProgramCacheKey = () => "flag-cloth";
  flagMaterial = mat;
  return mat;
}

const flatCache = new Map<string, THREE.MeshBasicMaterial>();

/** Unlit material for distant painted layers that should not shade. */
export function flat(key: string, color: THREE.ColorRepresentation, opts: { map?: THREE.Texture; transparent?: boolean; opacity?: number; fog?: boolean; vertexColors?: boolean } = {}) {
  const hit = flatCache.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshBasicMaterial({
    color,
    map: opts.map ?? null,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    fog: opts.fog ?? true,
    vertexColors: opts.vertexColors ?? false,
  });
  flatCache.set(key, mat);
  return mat;
}
