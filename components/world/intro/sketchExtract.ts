import * as THREE from "three";
import { INTRO_TIMES, type PaintRegion, type SketchData, type SketchStroke } from "@/components/intro/introTimeline";
import { mulberry32 } from "../painterly/noise";

/**
 * Traces the live scene into pencil strokes, so the storybook drawing is the
 * real island seen through the real camera rather than a separate artwork.
 *
 * Objects opt in with `userData.sketch = <group>` (on themselves or an
 * ancestor). For every tagged mesh we find feature edges — silhouettes where a
 * front face meets a back face, plus sharp creases — keep the ones a depth
 * pass says are visible, chain them into polylines and give each stroke a
 * start time and duration in the drawing order below. Instanced foliage and
 * stones become small marks. `userData.sketchLines` adds hand-authored world
 * polylines (contours, strata) that edges alone would miss.
 */

export const SKETCH_GROUP = {
  outline: 1,
  underside: 2,
  contours: 3,
  gift: 4,
  paths: 5,
  buildings: 6,
  trees: 7,
  islands: 8,
  details: 9,
} as const;

export interface SketchLine {
  group: number;
  points: THREE.Vector3[];
}

/** [start, end] of each group as fractions of the sketching window. Overlapping, like a real hand. */
const WINDOWS: Record<number, [number, number]> = {
  1: [0.0, 0.2],
  2: [0.12, 0.38],
  3: [0.28, 0.44],
  4: [0.38, 0.58],
  5: [0.5, 0.66],
  6: [0.58, 0.76],
  7: [0.68, 0.86],
  8: [0.78, 0.94],
  9: [0.86, 1.0],
};

/** Crease angle per group (degrees); organic shapes keep only silhouettes. */
const CREASE: Record<number, number> = { 1: 75, 2: 999, 3: 999, 4: 32, 5: 40, 6: 35, 7: 999, 8: 40, 9: 50 };

/** Watercolour bloom order, as fractions of the watercolour window. */
const PAINT_WINDOWS: Record<string, [number, number]> = {
  grass: [0.0, 0.4],
  rock: [0.12, 0.5],
  gift: [0.2, 0.48],
  buildings: [0.3, 0.6],
  trees: [0.36, 0.68],
  islands: [0.5, 0.82],
  sky: [0.58, 1.0],
};

interface Segment {
  a: number;
  b: number;
}

interface Traced {
  group: number;
  points: number[];
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const nrm = new THREE.Vector3();

function sketchGroupOf(o: THREE.Object3D): number | null {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    const g = cur.userData.sketch;
    if (typeof g === "number") return g;
    if (cur.userData.sketch === false) return null;
    cur = cur.parent;
  }
  return null;
}

function isTraceable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.visible) return false;
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  // Ink outlines, sky, glows and other shader/transparent layers are not drawable surfaces.
  if (!mat || (mat as THREE.ShaderMaterial).isShaderMaterial || mat.transparent) return false;
  return true;
}

class DepthProbe {
  private data: Float32Array | null = null;
  private w: number;
  private h: number;
  constructor(
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ) {
    const scale = Math.min(1, 960 / width);
    this.w = Math.max(2, Math.round(width * scale));
    this.h = Math.max(2, Math.round(height * scale));
    const rt = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.FloatType, format: THREE.RGBAFormat });
    const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) return;
      const mesh = o as THREE.Mesh;
      const keep = mesh.isMesh && isTraceable(mesh);
      if (!keep && (mesh.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints)) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const prev = { override: scene.overrideMaterial, target: gl.getRenderTarget(), bg: scene.background, clear: gl.getClearColor(new THREE.Color()), alpha: gl.getClearAlpha() };
    try {
      scene.overrideMaterial = mat;
      scene.background = null;
      gl.setRenderTarget(rt);
      gl.setClearColor(0x000000, 0);
      gl.clear();
      gl.render(scene, camera);
      const data = new Float32Array(this.w * this.h * 4);
      gl.readRenderTargetPixels(rt, 0, 0, this.w, this.h, data);
      this.data = data;
    } catch (err) {
      // Without float readback the sketch simply skips occlusion.
      console.warn("Sketch depth pass unavailable", err);
    } finally {
      gl.setRenderTarget(prev.target);
      gl.setClearColor(prev.clear, prev.alpha);
      scene.overrideMaterial = prev.override;
      scene.background = prev.bg;
      hidden.forEach((o) => (o.visible = true));
      rt.dispose();
      mat.dispose();
    }
  }

  private linear(fragZ: number) {
    const { near, far } = this.camera;
    return (near * far) / ((far - near) * fragZ - far);
  }

  /** True if an NDC point is not hidden behind nearer geometry. */
  visible(ndc: THREE.Vector3): boolean {
    if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1 || ndc.z > 1) return false;
    if (!this.data) return true;
    const px = Math.min(this.w - 1, Math.max(0, Math.floor(((ndc.x + 1) / 2) * this.w)));
    const py = Math.min(this.h - 1, Math.max(0, Math.floor(((ndc.y + 1) / 2) * this.h)));
    const i = (py * this.w + px) * 4;
    const alpha = this.data[i + 3]!;
    if (alpha === 0) return true; // sky
    const bufZ = 1 - this.data[i]!;
    const pZ = ndc.z * 0.5 + 0.5;
    const dBuf = -this.linear(bufZ);
    const dPt = -this.linear(pZ);
    return dPt <= dBuf * 1.012 + 0.08;
  }
}

/** Feature edges of one mesh, as welded vertex pairs plus their world positions. */
function featureEdges(mesh: THREE.Mesh, camPos: THREE.Vector3, creaseDeg: number): { world: Float32Array; segs: Segment[] } {
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const index = geo.index;
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  // Weld duplicated seam vertices by position so edges chain across UV seams.
  const ids = new Int32Array(pos.count);
  const lookup = new Map<string, number>();
  const world: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let id = lookup.get(key);
    if (id === undefined) {
      id = world.length / 3;
      lookup.set(key, id);
      tmpA.fromBufferAttribute(pos, i).applyMatrix4(m);
      world.push(tmpA.x, tmpA.y, tmpA.z);
    }
    ids[i] = id;
  }
  const triCount = index ? index.count / 3 : pos.count / 3;
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const edges = new Map<number, { nx: number; ny: number; nz: number; front: boolean; count: number; keep: boolean }>();
  const segs: Segment[] = [];
  const W = world;
  for (let t = 0; t < triCount; t++) {
    const i0 = ids[index ? index.getX(t * 3) : t * 3]!;
    const i1 = ids[index ? index.getX(t * 3 + 1) : t * 3 + 1]!;
    const i2 = ids[index ? index.getX(t * 3 + 2) : t * 3 + 2]!;
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;
    tmpA.set(W[i0 * 3]!, W[i0 * 3 + 1]!, W[i0 * 3 + 2]!);
    tmpB.set(W[i1 * 3]!, W[i1 * 3 + 1]!, W[i1 * 3 + 2]!);
    tmpC.set(W[i2 * 3]!, W[i2 * 3 + 1]!, W[i2 * 3 + 2]!);
    nrm.crossVectors(e1.subVectors(tmpB, tmpA), e2.subVectors(tmpC, tmpA));
    const len = nrm.length();
    if (len < 1e-10) continue;
    nrm.divideScalar(len);
    const front = nrm.dot(e1.subVectors(camPos, tmpA)) > 0;
    for (const [a, b] of [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ] as const) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * 4194304 + hi;
      const e = edges.get(key);
      if (!e) {
        edges.set(key, { nx: nrm.x, ny: nrm.y, nz: nrm.z, front, count: 1, keep: false });
        continue;
      }
      e.count++;
      if (e.count > 2 || e.keep) continue;
      const silhouette = e.front !== front;
      const crease = e.front && front && e.nx * nrm.x + e.ny * nrm.y + e.nz * nrm.z < cosCrease;
      if (silhouette || crease) {
        e.keep = true;
        segs.push({ a: lo, b: hi });
      }
    }
  }
  // Open boundaries (planes, roof edges) seen from the front.
  edges.forEach((e, key) => {
    if (e.count === 1 && e.front) segs.push({ a: Math.floor(key / 4194304), b: key % 4194304 });
  });
  return { world: new Float32Array(world), segs };
}

/** Joins segments sharing endpoints into polylines. */
function chain(segs: Segment[]): number[][] {
  const adj = new Map<number, number[]>();
  segs.forEach((s, i) => {
    for (const v of [s.a, s.b]) {
      const list = adj.get(v);
      if (list) list.push(i);
      else adj.set(v, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: number[][] = [];
  const walk = (start: number, first: number) => {
    const line = [start];
    let cur = start;
    let si = first;
    while (si >= 0 && !used[si]) {
      used[si] = 1;
      const s = segs[si]!;
      cur = s.a === cur ? s.b : s.a;
      line.push(cur);
      si = (adj.get(cur) ?? []).find((k) => !used[k]) ?? -1;
      if (line.length > 400) break;
    }
    return line;
  };
  // Start at endpoints first so open chains are drawn end to end.
  adj.forEach((list, v) => {
    if (list.length !== 2) for (const si of list) if (!used[si]) out.push(walk(v, si));
  });
  segs.forEach((s, i) => {
    if (!used[i]) out.push(walk(s.a, i));
  });
  return out;
}

export function extractSketch(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number): SketchData {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  const probe = new DepthProbe(gl, scene, camera, width, height);
  const camPos = camera.getWorldPosition(new THREE.Vector3());
  const ndc = new THREE.Vector3();
  const toScreen = (v: THREE.Vector3): [number, number, boolean] => {
    ndc.copy(v).project(camera);
    return [((ndc.x + 1) / 2) * width, ((1 - ndc.y) / 2) * height, probe.visible(ndc)];
  };

  const traced: Traced[] = [];
  const regions: { kind: keyof typeof PAINT_WINDOWS; x: number; y: number; r: number }[] = [];
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  const seenRegionRoots = new Set<THREE.Object3D>();

  const pushPolyline = (group: number, world: THREE.Vector3[]) => {
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 4) traced.push({ group, points: run });
      run = [];
    };
    for (const p of world) {
      const [x, y, vis] = toScreen(p);
      if (!vis) {
        flush();
        continue;
      }
      const n = run.length;
      if (n >= 2 && Math.hypot(x - run[n - 2]!, y - run[n - 1]!) < 0.8) continue;
      run.push(x, y);
    }
    flush();
  };

  const regionFor = (group: number): keyof typeof PAINT_WINDOWS | null =>
    group === SKETCH_GROUP.gift ? "gift" : group === SKETCH_GROUP.buildings ? "buildings" : group === SKETCH_GROUP.trees ? "trees" : group === SKETCH_GROUP.islands ? "islands" : null;

  scene.traverse((o) => {
    const lines = o.userData.sketchLines as SketchLine[] | undefined;
    if (lines) {
      o.updateWorldMatrix(true, false);
      for (const l of lines) pushPolyline(l.group, l.points.map((p) => p.clone().applyMatrix4(o.matrixWorld)));
    }
    const root = o.userData.sketchRegion ? o : null;
    if (root && !seenRegionRoots.has(root)) {
      seenRegionRoots.add(root);
      const kind = regionFor(sketchGroupOf(root) ?? 0);
      if (kind) {
        box.setFromObject(root);
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
          const sx = ((corner.x + 1) / 2) * width;
          const sy = ((1 - corner.y) / 2) * height;
          minX = Math.min(minX, sx);
          maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy);
          maxY = Math.max(maxY, sy);
        }
        if (maxX > 0 && minX < width && maxY > 0 && minY < height) {
          regions.push({ kind, x: (minX + maxX) / 2, y: (minY + maxY) / 2, r: Math.max(maxX - minX, maxY - minY) * 0.6 });
        }
      }
    }

    if (!isTraceable(o)) return;
    const group = sketchGroupOf(o);
    if (group === null) return;
    const mesh = o as THREE.Mesh;

    if ((mesh as THREE.InstancedMesh).isInstancedMesh || o.userData.sketchMarks) {
      // Small marks: a tiny looped tick per instance (flowers, stones, buds).
      const inst = mesh as THREE.InstancedMesh;
      const n = inst.isInstancedMesh ? inst.count : 1;
      const mat = new THREE.Matrix4();
      const rng = mulberry32(n * 7 + group);
      const stride = Math.max(1, Math.floor(n / 160));
      for (let i = 0; i < n; i += stride) {
        if (inst.isInstancedMesh) inst.getMatrixAt(i, mat);
        else mat.identity();
        corner.setFromMatrixPosition(mat).applyMatrix4(mesh.matrixWorld);
        const [x, y, vis] = toScreen(corner);
        if (!vis) continue;
        const r = 1.6 + rng() * 1.6;
        const pts: number[] = [];
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * Math.PI * 2 + rng() * 0.4;
          pts.push(x + Math.cos(a) * r * (1 + rng() * 0.3), y + Math.sin(a) * r * 0.7);
        }
        traced.push({ group, points: pts });
      }
      return;
    }
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return;

    const { world, segs } = featureEdges(mesh, camPos, CREASE[group] ?? 45);
    // Keep only visible segments, then chain them.
    const visible: Segment[] = [];
    const mid = new THREE.Vector3();
    for (const s of segs) {
      tmpA.set(world[s.a * 3]!, world[s.a * 3 + 1]!, world[s.a * 3 + 2]!);
      tmpB.set(world[s.b * 3]!, world[s.b * 3 + 1]!, world[s.b * 3 + 2]!);
      mid.addVectors(tmpA, tmpB).multiplyScalar(0.5);
      let ok = 0;
      for (const p of [tmpA, mid, tmpB]) {
        ndc.copy(p).project(camera);
        if (probe.visible(ndc)) ok++;
      }
      if (ok >= 2) visible.push(s);
    }
    for (const line of chain(visible)) {
      const pts: number[] = [];
      for (const id of line) {
        tmpA.set(world[id * 3]!, world[id * 3 + 1]!, world[id * 3 + 2]!);
        ndc.copy(tmpA).project(camera);
        const x = ((ndc.x + 1) / 2) * width;
        const y = ((1 - ndc.y) / 2) * height;
        const n = pts.length;
        if (n >= 2 && Math.hypot(x - pts[n - 2]!, y - pts[n - 1]!) < 0.8) continue;
        pts.push(x, y);
      }
      if (pts.length >= 4) traced.push({ group, points: pts });
    }
  });

  return {
    width,
    height,
    strokes: scheduleStrokes(traced),
    regions: scheduleRegions(regions, scene, camera, width, height, toScreen),
    gift: giftScreen(scene, camera, width, height),
  };
}

function polylineLength(p: number[]) {
  let len = 0;
  for (let i = 2; i < p.length; i += 2) len += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  return len;
}

function scheduleStrokes(traced: Traced[]): SketchStroke[] {
  const start = INTRO_TIMES.sketching;
  const span = INTRO_TIMES.watercolor - INTRO_TIMES.sketching;
  const byGroup = new Map<number, { points: number[]; length: number }[]>();
  for (const t of traced) {
    const length = polylineLength(t.points);
    if (length < 3) continue;
    const list = byGroup.get(t.group) ?? [];
    list.push({ points: t.points, length });
    byGroup.set(t.group, list);
  }
  const out: SketchStroke[] = [];
  const rng = mulberry32(5);
  byGroup.forEach((list, group) => {
    const [w0, w1] = WINDOWS[group] ?? [0.86, 1];
    const g0 = start + w0 * span;
    const g1 = start + w1 * span;
    // Major lines first, then progressively finer detail, like an artist.
    list.sort((a, b) => b.length - a.length);
    const n = list.length;
    list.forEach((s, i) => {
      const order = i / Math.max(1, n);
      const duration = Math.min((g1 - g0) * 0.7, 0.07 + Math.sqrt(s.length) / 42);
      const begin = g0 + order * (g1 - g0 - duration) + (rng() - 0.5) * 0.04;
      out.push({
        points: new Float32Array(s.points),
        length: s.length,
        start: Math.max(start, begin),
        duration,
        weight: group <= 2 ? 1.5 : group === SKETCH_GROUP.islands || group === SKETCH_GROUP.details ? 0.9 : 1.15,
        alpha: (group === SKETCH_GROUP.islands ? 0.42 : 0.7) * (0.8 + rng() * 0.25),
      });
    });
  });
  return out.sort((a, b) => a.start - b.start);
}

function scheduleRegions(
  found: { kind: keyof typeof PAINT_WINDOWS; x: number; y: number; r: number }[],
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  toScreen: (v: THREE.Vector3) => [number, number, boolean],
): PaintRegion[] {
  const start = INTRO_TIMES.watercolor;
  const span = INTRO_TIMES.enteringWorld - INTRO_TIMES.watercolor;
  const rng = mulberry32(11);
  const seeds = [...found];
  // Ground and rock blooms come from authored sample points on the island.
  scene.traverse((o) => {
    const samples = o.userData.paintSamples as { kind: "grass" | "rock"; points: THREE.Vector3[] }[] | undefined;
    if (!samples) return;
    o.updateWorldMatrix(true, false);
    for (const s of samples) {
      for (const p of s.points) {
        const [x, y] = toScreen(p.clone().applyMatrix4(o.matrixWorld));
        if (x > -50 && x < width + 50 && y > -50 && y < height + 50) seeds.push({ kind: s.kind, x, y, r: Math.min(width, height) * (s.kind === "grass" ? 0.11 : 0.13) });
      }
    }
  });
  // The sky washes in last, in broad strokes across the page.
  const cols = 6;
  const rows = 4;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) seeds.push({ kind: "sky", x: ((i + 0.5) / cols) * width + (rng() - 0.5) * 80, y: ((j + 0.5) / rows) * height + (rng() - 0.5) * 60, r: Math.max(width / cols, height / rows) * 1.05 });
  void camera;
  return seeds.map((s) => {
    const [w0, w1] = PAINT_WINDOWS[s.kind]!;
    const duration = (w1 - w0) * span * (0.55 + rng() * 0.25);
    const begin = start + w0 * span + rng() * ((w1 - w0) * span - duration);
    return { x: s.x, y: s.y, radius: s.r, start: begin, duration };
  });
}

function giftScreen(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
  let found: THREE.Object3D | null = null;
  scene.traverse((o) => {
    if (!found && o.userData.sketch === SKETCH_GROUP.gift) found = o;
  });
  const v = new THREE.Vector3();
  if (found) new THREE.Box3().setFromObject(found).getCenter(v);
  v.project(camera);
  return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
}
