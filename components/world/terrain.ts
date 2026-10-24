import * as THREE from "three";
import { clamp01, fbm, noise2, smoothstep } from "./painterly/noise";

/**
 * Procedural floating-island geometry. The top is a polar heightfield with an
 * irregular rim; the underside is an eroded, lobed rock mass with layered
 * strata colours. A single sampler drives both mesh and prop placement so
 * every tree, lantern and stone sits on the painted ground.
 */

export interface IslandShape {
  seed: number;
  radius: number;
  /** Elongation along X. */
  stretch: number;
  /** Underside depth below the rim. */
  depth: number;
  hilliness: number;
}

export interface IslandPalette {
  grassLow: string;
  grassHigh: string;
  grassSun: string;
  rim: string;
  path: string;
  strata: [stop: number, color: string][];
}

export const MAIN_ISLAND: IslandShape = { seed: 7, radius: 6.3, stretch: 1.28, depth: 6.2, hilliness: 1 };

export const MAIN_PALETTE: IslandPalette = {
  grassLow: "#4f8a3c",
  grassHigh: "#8fc153",
  grassSun: "#c3d86a",
  rim: "#4a7a36",
  path: "#cdb88e",
  strata: [
    [0, "#5f8a3d"],
    [0.05, "#7f8a46"],
    [0.1, "#a9774f"],
    [0.24, "#d5a676"],
    [0.4, "#c9a08f"],
    [0.58, "#a497b8"],
    [0.8, "#7c76a3"],
    [1, "#5a5582"],
  ],
};

/** Winding stone path from the gift platform's steps to the bridge at the rim. */
export const PATH_POINTS: [number, number][] = [
  [0.45, 1.3],
  [0.75, 2.25],
  [1.7, 3.0],
  [3.0, 3.45],
  [4.3, 3.75],
  [5.45, 4.05],
];

/** Stepping-stone side paths: platform → tower door, platform → cottage door. */
export const GARDEN_PATHS: [number, number][][] = [
  [
    [-1.25, 0.55],
    [-2.0, 0.05],
    [-2.6, -0.75],
    [-3.3, -1.7],
  ],
  [
    [2.25, -0.35],
    [3.0, -0.85],
    [3.8, -1.25],
    [4.55, -1.8],
  ],
];

function segmentDistance(points: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]!;
    const [bx, bz] = points[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

export function distToGardenPaths(x: number, z: number): number {
  return Math.min(...GARDEN_PATHS.map((p) => segmentDistance(p, x, z)));
}

export function rimRadius(shape: IslandShape, theta: number): number {
  const s = shape.seed;
  return (
    shape.radius *
    (1 + 0.11 * fbm(Math.cos(theta) * 1.4 + s, Math.sin(theta) * 1.4 + s, s, 3) + 0.05 * Math.sin(3 * theta + s))
  );
}

/** Normalised polar coordinates: f = 0 at centre, 1 at the rim. */
export function polar(shape: IslandShape, x: number, z: number) {
  const lx = x / shape.stretch;
  const theta = Math.atan2(z, lx);
  const f = Math.hypot(lx, z) / rimRadius(shape, theta);
  return { theta, f };
}

export function distToPath(x: number, z: number): number {
  return segmentDistance(PATH_POINTS, x, z);
}

export function terrainHeight(shape: IslandShape, x: number, z: number): number {
  const { f } = polar(shape, x, z);
  const s = shape.seed;
  const hills = 0.55 * fbm(x * 0.16 + 3, z * 0.16 - 2, s, 4) * shape.hilliness;
  // The land rises gently toward the back so the gift sits in a cradle.
  const backRise = smoothstep(0, -6, z) * 0.9 * shape.hilliness;
  const mound = 0.35 * Math.exp(-(x * x + z * z) / 22);
  const edge = -0.45 * smoothstep(0.78, 1.02, f);
  let h = hills + backRise + mound + edge;
  if (shape === MAIN_ISLAND) {
    // Ease the ground flat around the platform and along the path.
    const flatten = Math.max(
      1 - smoothstep(1.6, 3.0, Math.hypot(x - 0.4, z + 0.6)),
      1 - smoothstep(0.5, 1.4, distToPath(x, z)),
    );
    h = h * (1 - flatten * 0.7) + 0.2 * flatten * 0.7;
  }
  return h;
}

export function groundAt(x: number, z: number): number {
  return terrainHeight(MAIN_ISLAND, x, z);
}

function lerpColor(stops: [number, string][], t: number, out: THREE.Color) {
  const c0 = new THREE.Color();
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]!;
    const [b, cb] = stops[i + 1]!;
    if (t <= b || i === stops.length - 2) {
      const k = clamp01((t - a) / (b - a));
      out.set(ca).lerp(c0.set(cb), k);
      return out;
    }
  }
  return out.set(stops[0]![1]);
}

export interface IslandGeometryOptions {
  rings?: number;
  segments?: number;
  layers?: number;
  showPath?: boolean;
}

export function createIslandGeometry(
  shape: IslandShape,
  palette: IslandPalette,
  { rings = 28, segments = 128, layers = 24, showPath = false }: IslandGeometryOptions = {},
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const col = new THREE.Color();
  const tmp = new THREE.Color();
  const s = shape.seed;
  const cols = segments + 1;

  // --- Top surface -------------------------------------------------------
  for (let i = 0; i <= rings; i++) {
    const f = Math.pow(i / rings, 0.8);
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      const r = rimRadius(shape, theta) * f;
      const x = Math.cos(theta) * r * shape.stretch;
      const z = Math.sin(theta) * r;
      const y = terrainHeight(shape, x, z);
      positions.push(x, y, z);
      uvs.push(x * 0.22, z * 0.22);

      const n = noise2(x * 0.35 + 9, z * 0.35, s) * 0.6 + noise2(x * 1.3, z * 1.3, s + 3) * 0.4;
      col.set(palette.grassLow).lerp(tmp.set(palette.grassHigh), clamp01(n * 1.1 + y * 0.35));
      col.lerp(tmp.set(palette.grassSun), clamp01((n - 0.55) * 1.8) * 0.6);
      col.lerp(tmp.set(palette.rim), smoothstep(0.88, 1, f) * 0.75);
      if (showPath) {
        const d = distToPath(x, z) + (noise2(x * 2, z * 2, 5) - 0.5) * 0.35;
        col.lerp(tmp.set(palette.path), (1 - smoothstep(0.45, 0.85, d)) * 0.85);
      }
      colors.push(col.r, col.g, col.b);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * cols + j;
      const b = a + cols;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const topCount = indices.length;

  // --- Underside ---------------------------------------------------------
  const base = positions.length / 3;
  for (let k = 0; k <= layers; k++) {
    const d = k / layers;
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      const rim = rimRadius(shape, theta);
      const rimX = Math.cos(theta) * rim * shape.stretch;
      const rimZ = Math.sin(theta) * rim;
      const rimY = terrainHeight(shape, rimX, rimZ);

      // Rounded lip, then a lobed, tapering rock mass.
      const lip = d < 0.06 ? 1 + 0.035 * Math.sin((d / 0.06) * Math.PI) : 1;
      const profile = Math.pow(Math.max(0, 1 - d), 0.62);
      const ta = ((j % segments) / segments) * Math.PI * 2;
      const fingers = fingerField(ta, s);
      const lobeNoise = noise2(Math.cos(ta) * 2.4 + 4, Math.sin(ta) * 2.4, s + 11);
      const lobes = 0.4 + 0.85 * fingers + 0.25 * lobeNoise;
      const lobeMix = smoothstep(0.1, 0.65, d);
      const crag = fbm(Math.cos(theta) * 2.6 + d * 3, Math.sin(theta) * 2.6 - d * 2, s + 5, 4) * 0.22 * smoothstep(0.03, 0.2, d);
      const radial = Math.max(0.06, profile * lip * (1 - lobeMix + lobeMix * lobes) + crag);
      const tipX = 0.6 * Math.sin(s);
      const tipZ = 0.4 * Math.cos(s);
      const x = rimX * radial + tipX * d;
      const z = rimZ * radial + tipZ * d;
      const strata = 0.12 * Math.sin(theta * 5 + d * 9 + s) * smoothstep(0.08, 0.3, d);
      // Lobes hang lower than the gaps between them, giving several rock fingers.
      const y = rimY - d * shape.depth * (0.55 + 0.75 * lobes * lobeMix) + strata;
      positions.push(x, y, z);
      uvs.push((j / segments) * 10 * shape.radius * 0.2, y * 0.18);

      const t = clamp01(d + 0.07 * (noise2(theta * 6, y * 1.2, s + 9) - 0.5));
      lerpColor(palette.strata, t, col);
      // Sunlit side (+x, +z toward the camera) is warmer.
      const facing = 0.5 + 0.5 * Math.cos(theta - 0.6);
      col.lerp(tmp.set("#f2c48f"), facing * 0.12 * (1 - d));
      colors.push(col.r, col.g, col.b);
    }
  }
  for (let k = 0; k < layers; k++) {
    for (let j = 0; j < segments; j++) {
      const a = base + k * cols + j;
      const b = a + cols;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.addGroup(0, topCount, 0);
  geo.addGroup(topCount, indices.length - topCount, 1);
  geo.computeVertexNormals();
  weldSeamNormals(geo, rings + 1, base, layers + 1, cols);
  return geo;
}

/** Average normals across the duplicated θ = 0 / 2π column so no seam shows. */
function weldSeamNormals(geo: THREE.BufferGeometry, topRows: number, base: number, cliffRows: number, cols: number) {
  const normal = geo.getAttribute("normal") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  const weld = (a: number, b: number) => {
    v.fromBufferAttribute(normal, a);
    w.fromBufferAttribute(normal, b);
    v.add(w).normalize();
    normal.setXYZ(a, v.x, v.y, v.z);
    normal.setXYZ(b, v.x, v.y, v.z);
  };
  for (let i = 0; i < topRows; i++) weld(i * cols, i * cols + cols - 1);
  for (let k = 0; k < cliffRows; k++) weld(base + k * cols, base + k * cols + cols - 1);
  normal.needsUpdate = true;
}

/**
 * Angular "finger" field: a few hanging rock masses at fixed bearings (two
 * toward the camera, others around the back), each a soft Gaussian bump.
 */
function fingerField(theta: number, seed: number): number {
  const bearings = [0.25, 1.15, 2.05, 3.3, 4.5, 5.5];
  const widths = [0.32, 0.38, 0.3, 0.42, 0.36, 0.3];
  let f = 0;
  bearings.forEach((b, i) => {
    let dTheta = Math.abs(theta - (b + Math.sin(seed + i) * 0.15));
    dTheta = Math.min(dTheta, Math.PI * 2 - dTheta);
    f = Math.max(f, Math.exp(-((dTheta / widths[i]!) ** 2)) * (0.75 + 0.25 * Math.cos(seed * 3 + i)));
  });
  return f;
}

/** Points sampled evenly along the rim (for vines, rim grass, edge rocks). */
export function rimPoints(shape: IslandShape, count: number, inset = 0.97): { x: number; y: number; z: number; theta: number }[] {
  const out = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    const r = rimRadius(shape, theta) * inset;
    const x = Math.cos(theta) * r * shape.stretch;
    const z = Math.sin(theta) * r;
    out.push({ x, y: terrainHeight(shape, x, z), z, theta });
  }
  return out;
}
