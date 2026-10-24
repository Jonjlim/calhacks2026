import * as THREE from "three";

export interface RibbonOptions {
  width: number;
  thickness: number;
  segments?: number;
  closed?: boolean;
  /** Direction the flat face spans at parameter t (orthogonalised against the tangent). */
  across: (t: number, point: THREE.Vector3, tangent: THREE.Vector3) => THREE.Vector3;
  /** Width multiplier along the ribbon, e.g. pinching a bow loop at the knot. */
  taper?: (t: number) => number;
}

/**
 * Sweeps a thin rectangle along a Catmull-Rom curve. Unlike a tube or torus,
 * this keeps the flat, folded look of real satin ribbon while still having
 * thickness and edges that catch light.
 */
export function createRibbonGeometry(points: THREE.Vector3[], opts: RibbonOptions): THREE.BufferGeometry {
  const { width, thickness, segments = 64, closed = false, across, taper = () => 1 } = opts;
  const curve = new THREE.CatmullRomCurve3(points, closed, "centripetal");
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const length = curve.getLength();
  const rows = segments + 1;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    side.copy(across(t, p, tan));
    side.addScaledVector(tan, -side.dot(tan)).normalize();
    up.crossVectors(tan, side).normalize();
    const hw = (width * taper(t)) / 2;
    const ht = thickness / 2;
    // Four corners: front-left, front-right, back-right, back-left.
    const corners: [number, number][] = [
      [-hw, ht],
      [hw, ht],
      [hw, -ht],
      [-hw, -ht],
    ];
    for (const [sx, sy] of corners) {
      positions.push(p.x + side.x * sx + up.x * sy, p.y + side.y * sx + up.y * sy, p.z + side.z * sx + up.z * sy);
      uvs.push((t * length) / (width * 3), sx > 0 ? 1 : 0);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k;
      const b = i * 4 + ((k + 1) % 4);
      const c = a + 4;
      const d = b + 4;
      indices.push(a, c, b, b, c, d);
    }
  }
  if (!closed) {
    const last = (rows - 1) * 4;
    indices.push(0, 1, 2, 0, 2, 3, last, last + 2, last + 1, last, last + 3, last + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
