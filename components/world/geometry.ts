import * as THREE from "three";

/** Merges primitives into one non-indexed geometry (position, normal, uv) for a single draw call. */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const g of geos) {
    const geo = g.index ? g.toNonIndexed() : g;
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    geo.dispose();
    if (geo !== g) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return out;
}

/**
 * Adds a vertical colour gradient (dark, cool base → warm, light crown), the
 * main trick that makes foliage and rocks read as painted volume.
 */
export function paintByHeight(
  geo: THREE.BufferGeometry,
  stops: [number, THREE.ColorRepresentation][],
  jitter = 0,
  seed = 1,
): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const d = new THREE.Color();
  const sorted = stops.map(([t, col]) => [t, new THREE.Color(col)] as const);
  for (let i = 0; i < pos.count; i++) {
    const h = (pos.getY(i) - box.min.y) / Math.max(1e-6, box.max.y - box.min.y);
    const n = jitter ? (Math.sin(pos.getX(i) * 12.9 + pos.getZ(i) * 7.3 + seed) * 0.5) * jitter : 0;
    const t = Math.min(1, Math.max(0, h + n));
    let k = 0;
    while (k < sorted.length - 2 && t > sorted[k + 1]![0]) k++;
    const [a, ca] = sorted[k]!;
    const [b, cb] = sorted[k + 1]!;
    c.copy(ca).lerp(d.copy(cb), Math.min(1, Math.max(0, (t - a) / (b - a))));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Nudges every vertex by a small deterministic offset so primitives lose their machined look. */
export function wobble(geo: THREE.BufferGeometry, amount: number, seed = 1): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = Math.sin(x * 3.1 + y * 5.7 + z * 4.3 + seed) * Math.cos(x * 6.7 - z * 2.9 + seed * 1.7);
    pos.setXYZ(i, x + k * amount, y + Math.sin(k * 3 + seed) * amount * 0.6, z - k * amount);
  }
  pos.needsUpdate = true;
  return smoothNormals(geo);
}

/**
 * Smooth normals for non-indexed geometry by averaging face normals of
 * vertices that share a position. Keeps merged blobs soft and lets inverted-
 * hull outlines stay closed.
 */
export function smoothNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) {
    geo.computeVertexNormals();
    return geo;
  }
  const pos = geo.getAttribute("position");
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const acc = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
    for (let k = 0; k < 3; k++) {
      const id = key(i + k);
      const v = acc.get(id);
      if (v) v.add(n);
      else acc.set(id, n.clone());
    }
  }
  const normals = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n = acc.get(key(i))!.clone().normalize();
    normals.set([n.x, n.y, n.z], i * 3);
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geo;
}
