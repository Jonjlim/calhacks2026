"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { paint } from "../painterly/materials";
import { woodTexture } from "../painterly/textures";

/**
 * A small rope-and-plank bridge between two floating things: a deck of
 * planks along a gently sagging curve, with a rope rail on each side. Built
 * once per pair (one instanced mesh for the planks, two thin tubes for the ropes),
 * so a handful of them cost almost nothing. `quiet` thins and dims it for the
 * overview; the branch in focus gets the full bridge.
 */
const _o = new THREE.Object3D();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function MapBridge({ start, end, sag = 0.5, quiet = false }: { start: THREE.Vector3; end: THREE.Vector3; sag?: number; quiet?: boolean }) {
  const planks = useRef<THREE.InstancedMesh>(null);
  const curve = useMemo(() => {
    const mid = start.clone().lerp(end, 0.5);
    mid.y -= sag;
    return new THREE.QuadraticBezierCurve3(start.clone(), mid, end.clone());
  }, [start, end, sag]);
  const length = useMemo(() => curve.getLength(), [curve]);
  const count = Math.max(6, Math.floor(length / 0.62));
  const wood = useMemo(() => paint(quiet ? "bridge-wood-quiet" : "bridge-wood", { map: woodTexture(), color: quiet ? "#d9bfa4" : "#e0b892", transparent: quiet, opacity: quiet ? 0.7 : 1 }), [quiet]);
  const rope = useMemo(() => paint("rope", { color: "#b99a74" }), []);
  const ropes = useMemo(() => {
    const side = new THREE.Vector3();
    return [-1, 1].map((s) => {
      const pts = Array.from({ length: 16 }, (_, i) => {
        const u = i / 15;
        curve.getPoint(u, _p);
        curve.getTangent(u, _t);
        side.crossVectors(_t, UP).normalize().multiplyScalar(0.34 * s);
        return _p.clone().add(side).add(new THREE.Vector3(0, 0.34 - Math.sin(u * Math.PI) * 0.1, 0));
      });
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.016, 5);
    });
  }, [curve]);

  useEffect(() => {
    const m = planks.current;
    if (!m) return;
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count;
      curve.getPoint(u, _p);
      curve.getTangent(u, _t);
      _o.position.copy(_p);
      // Planks lie across the path and follow its slope, each a touch off true, as if laid by hand.
      _o.rotation.set(0, Math.atan2(-_t.z, _t.x) + ((i * 7919) % 13 - 6) * 0.006, Math.asin(THREE.MathUtils.clamp(_t.y, -1, 1)));
      _o.scale.set(1, 1, 0.92 + ((i * 31) % 7) * 0.025);
      _o.updateMatrix();
      m.setMatrixAt(i, _o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [curve, count]);

  useEffect(() => () => ropes.forEach((g) => g.dispose()), [ropes]);
  return (
    <group>
      <instancedMesh ref={planks} args={[undefined, undefined, count]} material={wood} castShadow frustumCulled={false}>
        <boxGeometry args={[0.26, 0.06, 0.78]} />
      </instancedMesh>
      {ropes.map((g, i) => (
        <mesh key={i} geometry={g} material={rope} />
      ))}
    </group>
  );
}
