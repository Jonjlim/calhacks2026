import * as THREE from "three";
import { wobble } from "./geometry";
import { mulberry32 } from "./painterly/noise";
import { flat, paint } from "./painterly/materials";
import { foliageTexture, plasterTexture, stoneTexture, tileTexture, woodTexture } from "./painterly/textures";

/**
 * A small kit of hand-made architectural parts for the background islands.
 * Every part is baked into one of a few shared materials with a per-part
 * vertex colour, so an entire castle or village costs a handful of draw
 * calls. Shapes are wobbled and slightly asymmetric on purpose.
 */

export type KitMaterial = "plaster" | "stone" | "roof" | "wood" | "leaf" | "plain" | "glow";

export function kitMaterial(kind: KitMaterial): THREE.Material {
  switch (kind) {
    case "plaster":
      return paint("kit-plaster", { map: plasterTexture(), vertexColors: true });
    case "stone":
      return paint("kit-stone", { map: stoneTexture(), vertexColors: true });
    case "roof":
      return paint("kit-roof", { map: tileTexture(), vertexColors: true });
    case "wood":
      return paint("kit-wood", { map: woodTexture(), vertexColors: true });
    case "leaf":
      return paint("kit-leaf", { map: foliageTexture(), vertexColors: true, wind: 0.005 });
    case "plain":
      return paint("kit-plain", { vertexColors: true });
    case "glow":
      return flat("kit-glow", "#ffffff", { vertexColors: true });
  }
}

interface Bucket {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpC = new THREE.Color();
const normalMatrix = new THREE.Matrix3();

export class KitBuilder {
  private buckets = new Map<KitMaterial, Bucket>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  get matrix() {
    return this.stack[this.stack.length - 1]!;
  }

  /** Runs `fn` with an extra local transform pushed. */
  at(position: THREE.Vector3Tuple, rotationY = 0, scale = 1, fn: () => void, rotationX = 0, rotationZ = 0) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotationX, rotationY, rotationZ)),
      new THREE.Vector3(scale, scale, scale),
    );
    this.stack.push(this.matrix.clone().multiply(m));
    fn();
    this.stack.pop();
  }

  add(kind: KitMaterial, geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, local?: THREE.Matrix4, shade = 0) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    const m = local ? this.matrix.clone().multiply(local) : this.matrix;
    normalMatrix.getNormalMatrix(m);
    let b = this.buckets.get(kind);
    if (!b) {
      b = { pos: [], nor: [], uv: [], col: [] };
      this.buckets.set(kind, b);
    }
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    const uv = geo.getAttribute("uv");
    tmpC.set(color);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const span = Math.max(1e-5, box.max.y - box.min.y);
    for (let i = 0; i < pos.count; i++) {
      tmpV.fromBufferAttribute(pos, i);
      // Optional painted gradient: darker toward the base of the part.
      const k = shade ? 1 - shade * (1 - (tmpV.y - box.min.y) / span) : 1;
      tmpV.applyMatrix4(m);
      tmpN.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      b.pos.push(tmpV.x, tmpV.y, tmpV.z);
      b.nor.push(tmpN.x, tmpN.y, tmpN.z);
      b.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      b.col.push(tmpC.r * k, tmpC.g * k, tmpC.b * k);
    }
    if (geo !== geometry) geo.dispose();
    geometry.dispose();
  }

  build(): { kind: KitMaterial; geometry: THREE.BufferGeometry }[] {
    return [...this.buckets.entries()].map(([kind, b]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      return { kind, geometry: g };
    });
  }
}

const T = (x: number, y: number, z: number, ry = 0, s: THREE.Vector3Tuple = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(...s));

// --- Shapes -----------------------------------------------------------------

/** Fairytale spire: a lathe with a concave flank and a slight lean at the tip. */
export function spireGeometry(radius: number, height: number, lean = 0.08, seed = 1): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Flared eave, concave body, needle tip.
    const r = radius * (1.08 - 0.08 * Math.min(1, t * 6)) * Math.pow(1 - t, 1.55);
    pts.push(new THREE.Vector2(Math.max(0.001, r), t * height));
  }
  const g = new THREE.LatheGeometry(pts, 14);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / height;
    pos.setX(i, pos.getX(i) + h * h * h * lean * height);
  }
  g.computeVertexNormals();
  return wobble(g, radius * 0.025, seed);
}

export function towerGeometry(radius: number, height: number, seed = 1, sides = 14): THREE.BufferGeometry {
  return wobble(new THREE.CylinderGeometry(radius * 0.94, radius, height, sides, 4), radius * 0.03, seed).translate(0, height / 2, 0);
}

export function boxGeometry(w: number, h: number, d: number, seed = 1): THREE.BufferGeometry {
  return wobble(new THREE.BoxGeometry(w, h, d, 2, 2, 2), Math.min(w, h, d) * 0.04, seed).translate(0, h / 2, 0);
}

/** Gable roof with eaves overhang, ridge sag and a little asymmetry. */
export function gableGeometry(width: number, height: number, depth: number, seed = 1): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const shape = new THREE.Shape();
  const peak = (rng() - 0.5) * width * 0.08;
  shape.moveTo(-width / 2 - 0.04, -0.02);
  shape.lineTo(peak, height);
  shape.lineTo(width / 2 + 0.04, -0.02);
  shape.lineTo(width / 2 - 0.02, 0.04);
  shape.lineTo(peak, height - 0.06);
  shape.lineTo(-width / 2 + 0.02, 0.04);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 3 });
  g.translate(0, 0, -depth / 2);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / depth;
    // Ridge sags a touch in the middle, like old timber.
    pos.setY(i, pos.getY(i) - (1 - 4 * z * z) * 0.03 * (pos.getY(i) / height));
  }
  g.computeVertexNormals();
  return g;
}

export function windowGeometry(w: number, h: number): THREE.BufferGeometry {
  // A pane with an arched head, as one flat shape.
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h - w / 2);
  s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false);
  s.closePath();
  return new THREE.ShapeGeometry(s, 4);
}

// --- Composite parts ----------------------------------------------------------

export interface TowerSpec {
  x: number;
  z: number;
  radius: number;
  height: number;
  roof: THREE.ColorRepresentation;
  wall?: THREE.ColorRepresentation;
  roofHeight?: number;
  windows?: number;
  seed?: number;
  /** Ring of crenellations instead of a spire. */
  flatTop?: boolean;
}

export function addTower(kit: KitBuilder, t: TowerSpec) {
  const seed = t.seed ?? 1;
  const rng = mulberry32(seed * 13 + 5);
  const wall = t.wall ?? "#f1dccd";
  kit.add("plaster", towerGeometry(t.radius, t.height, seed), wall, T(t.x, 0, t.z), 0.18);
  // Corbelled band under the roof.
  kit.add("stone", new THREE.CylinderGeometry(t.radius * 1.12, t.radius * 0.98, t.radius * 0.28, 14).translate(0, t.height, 0), "#e4d2c2", T(t.x, 0, t.z));
  if (t.flatTop) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      kit.add("stone", boxGeometry(t.radius * 0.32, t.radius * 0.3, t.radius * 0.22, seed + i), "#eadacb", T(t.x + Math.cos(a) * t.radius * 1.02, t.height + t.radius * 0.12, t.z + Math.sin(a) * t.radius * 1.02, -a));
    }
  } else {
    const rh = t.roofHeight ?? t.radius * 3.1;
    kit.add("roof", spireGeometry(t.radius * 1.32, rh, 0.05 + rng() * 0.06, seed), t.roof, T(t.x, t.height + t.radius * 0.12, t.z, rng() * 6), 0.25);
  }
  const windows = t.windows ?? 2;
  for (let i = 0; i < windows; i++) {
    const a = 0.35 + (rng() - 0.5) * 0.9;
    const y = t.height * (0.35 + (i / Math.max(1, windows)) * 0.5);
    const wpos = T(t.x + Math.sin(a) * t.radius * 1.0, y, t.z + Math.cos(a) * t.radius * 1.0, a);
    kit.add("glow", windowGeometry(t.radius * 0.32, t.radius * 0.55), "#ffcf7a", wpos);
  }
}

export interface HouseSpec {
  x: number;
  z: number;
  y?: number;
  width: number;
  depth: number;
  height: number;
  rotationY?: number;
  wall?: THREE.ColorRepresentation;
  roof: THREE.ColorRepresentation;
  chimney?: boolean;
  seed?: number;
}

export function addHouse(kit: KitBuilder, h: HouseSpec) {
  const seed = h.seed ?? 1;
  kit.at([h.x, h.y ?? 0, h.z], h.rotationY ?? 0, 1, () => {
    kit.add("plaster", boxGeometry(h.width, h.height, h.depth, seed), h.wall ?? "#f4e4cf", undefined, 0.15);
    // Timber band and door.
    kit.add("wood", new THREE.BoxGeometry(h.width + 0.02, 0.05, h.depth + 0.02).translate(0, h.height * 0.98, 0), "#8a5d44");
    kit.add("wood", boxGeometry(h.width * 0.2, h.height * 0.55, 0.04, seed).translate(h.width * 0.18, 0, h.depth / 2 + 0.01), "#b46e4e");
    const roofH = h.width * 0.55;
    kit.add("roof", gableGeometry(h.width * 1.18, roofH, h.depth * 1.14, seed), h.roof, T(0, h.height, 0), 0.22);
    // Gable ends: plaster triangles under the roof.
    const tri = new THREE.Shape();
    tri.moveTo(-h.width / 2, 0);
    tri.lineTo(0, roofH * 0.92);
    tri.lineTo(h.width / 2, 0);
    tri.closePath();
    const gable = new THREE.ExtrudeGeometry(tri, { depth: h.depth * 0.96, bevelEnabled: false }).translate(0, 0, -h.depth * 0.48);
    kit.add("plaster", gable, h.wall ?? "#f4e4cf", T(0, h.height, 0));
    kit.add("glow", windowGeometry(h.width * 0.16, h.height * 0.32), "#ffd27f", T(-h.width * 0.22, h.height * 0.34, h.depth / 2 + 0.012));
    kit.add("glow", windowGeometry(h.width * 0.14, h.height * 0.3), "#ffcc72", T(h.width / 2 + 0.012, h.height * 0.36, 0, Math.PI / 2));
    if (h.chimney) kit.add("stone", boxGeometry(0.16, roofH * 0.9, 0.16, seed + 3), "#d9c3b5", T(h.width * 0.26, h.height + roofH * 0.35, -h.depth * 0.2));
  });
}

export function addFence(kit: KitBuilder, points: [number, number, number][], color: THREE.ColorRepresentation = "#c79c74") {
  const rng = mulberry32(points.length * 31);
  points.forEach(([x, y, z], i) => {
    kit.add("wood", new THREE.CylinderGeometry(0.03, 0.035, 0.38, 5).translate(0, 0.19, 0), color, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.15, 0, (rng() - 0.5) * 0.15)), new THREE.Vector3(1, 1, 1)));
    const next = points[i + 1];
    if (!next) return;
    const [nx, ny, nz] = next;
    const len = Math.hypot(nx - x, nz - z);
    const ang = -Math.atan2(nz - z, nx - x);
    for (const h of [0.14, 0.28]) {
      kit.add("wood", new THREE.BoxGeometry(len + 0.04, 0.03, 0.025), color, T((x + nx) / 2, (y + ny) / 2 + h, (z + nz) / 2, ang));
    }
  });
}

/** Lumpy foliage mass used for small background trees and hedges. */
export function bushGeometry(radius: number, seed: number, lumps = 5): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < lumps; i++) {
    const r = radius * (0.5 + rng() * 0.45);
    const a = rng() * Math.PI * 2;
    const d = i === 0 ? 0 : radius * (0.35 + rng() * 0.4);
    parts.push(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.85, 1).translate(Math.cos(a) * d, r * 0.7 + rng() * radius * 0.4, Math.sin(a) * d));
  }
  const merged = new THREE.BufferGeometry();
  const all = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const count = all.reduce((n, p) => n + p.getAttribute("position").count, 0);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const p of all) {
    pos.set(p.getAttribute("position").array as Float32Array, o * 3);
    uv.set(p.getAttribute("uv").array as Float32Array, o * 2);
    o += p.getAttribute("position").count;
  }
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return wobble(merged, radius * 0.06, seed);
}

/** A simple background tree: crooked trunk plus a lumpy canopy, added straight to a kit. */
export function addKitTree(kit: KitBuilder, x: number, y: number, z: number, scale: number, seed: number, leaf: THREE.ColorRepresentation = "#6c9e4a") {
  const rng = mulberry32(seed * 7 + 1);
  const h = (0.9 + rng() * 0.5) * scale;
  kit.add("wood", new THREE.CylinderGeometry(0.06 * scale, 0.11 * scale, h, 6).translate(0, h / 2, 0), "#7d5a48", new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (rng() - 0.5) * 0.2)), new THREE.Vector3(1, 1, 1)));
  kit.add("leaf", bushGeometry(0.62 * scale, seed, 4 + Math.floor(rng() * 3)), leaf, T(x + (rng() - 0.5) * 0.1 * scale, y + h * 0.72, z), 0.45);
}
