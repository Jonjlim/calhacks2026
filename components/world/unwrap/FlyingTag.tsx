"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { handoffRect } from "@/components/unwrap/parchmentLayout";
import { progress, UNWRAP_TIMES, unwrapClock } from "@/components/unwrap/unwrapTimeline";
import { hangingTag, HOLE_Y, LOOP_R, STRING, TAG_H, TAG_W, useTagGeometry, useTagMaterials } from "../giftTag/GiftTag";

/** How far in front of the camera the tag ends its flight (world units). */
const HANDOFF_DEPTH = 3.2;

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * The Begin tag after it lets go of the ribbon: the same mesh and materials,
 * now in world space. It leaves from the hanging tag's exact transform,
 * floats up and to the right on a soft arc with one slow turn and a little
 * flutter, flips to show its blank back, and grows until it covers the
 * hand-off rectangle — where the DOM parchment (InvitationTag) takes over
 * pixel for pixel. The end pose is recomputed from the live camera every
 * frame, so the camera's own reframing can run at the same time.
 */
export function FlyingTag() {
  const root = useRef<THREE.Group>(null);
  const string = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const geometry = useTagGeometry();
  const { twine, materials } = useTagMaterials();
  const stringGeo = useMemo(() => new THREE.CylinderGeometry(0.0055, 0.0055, 1, 6).translate(0, -0.5, 0), []);
  const tmp = useMemo(
    () => ({
      p0: new THREE.Vector3(),
      q0: new THREE.Quaternion(),
      s0: new THREE.Vector3(),
      p1: new THREE.Vector3(),
      q1: new THREE.Quaternion(),
      mid: new THREE.Vector3(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      spin: new THREE.Quaternion(),
      flutter: new THREE.Quaternion(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      basis: new THREE.Matrix4(),
      ray: new THREE.Vector3(),
      run: -1,
    }),
    [],
  );

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const u = unwrapClock;
    const flying = u.active && !u.staticPreview && u.t >= UNWRAP_TIMES.tagDetach && u.t < UNWRAP_TIMES.tagHandoff;
    g.visible = flying;
    if (!flying) {
      // Remember where the tag hangs, so the flight starts exactly there.
      if (!u.active && hangingTag.valid) hangingTag.matrix.decompose(tmp.p0, tmp.q0, tmp.s0);
      return;
    }
    if (tmp.run !== u.run) {
      tmp.run = u.run;
      if (hangingTag.valid) hangingTag.matrix.decompose(tmp.p0, tmp.q0, tmp.s0);
    }
    const k = progress(u.t, UNWRAP_TIMES.tagDetach, UNWRAP_TIMES.tagHandoff);
    const e = easeInOut(k);

    // End pose: back toward the viewer, upright, centred on the hand-off rectangle.
    camera.updateMatrixWorld();
    tmp.right.setFromMatrixColumn(camera.matrixWorld, 0);
    tmp.up.setFromMatrixColumn(camera.matrixWorld, 1);
    tmp.fwd.setFromMatrixColumn(camera.matrixWorld, 2).negate();
    const r = handoffRect(size.width, size.height);
    const ndcX = ((r.x + r.w / 2) / size.width) * 2 - 1;
    const ndcY = -(((r.y + r.h / 2) / size.height) * 2 - 1);
    // Point at the right depth along the ray through the rectangle's centre (view offset included).
    tmp.ray.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    const along = HANDOFF_DEPTH / Math.max(0.2, tmp.ray.dot(tmp.fwd));
    tmp.p1.copy(camera.position).addScaledVector(tmp.ray, along);
    const pxPerUnit = size.height / (2 * HANDOFF_DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const s1 = r.w / pxPerUnit / TAG_W;
    // The body's origin is the tag's top edge: lift it by half the tag's height.
    tmp.p1.addScaledVector(tmp.up, (TAG_H * s1) / 2);
    tmp.basis.makeBasis(tmp.right.clone().negate(), tmp.up, tmp.fwd);
    tmp.q1.setFromRotationMatrix(tmp.basis);

    // A soft arc: up and out first, then across to the right.
    tmp.mid.copy(tmp.p0).lerp(tmp.p1, 0.35).addScaledVector(tmp.up, 0.9).addScaledVector(tmp.fwd, -0.4);
    const a = 1 - e;
    tmp.p.copy(tmp.p0).multiplyScalar(a * a).addScaledVector(tmp.mid, 2 * a * e).addScaledVector(tmp.p1, e * e);
    // One slow turn about the vertical that unwinds into the flip, with a fading flutter.
    tmp.q.copy(tmp.q0).slerp(tmp.q1, e);
    tmp.spin.setFromAxisAngle(tmp.up, Math.PI * 2 * (1 - e) * Math.min(1, k * 3));
    tmp.flutter.setFromAxisAngle(tmp.right, Math.sin(k * Math.PI * 5) * 0.28 * (1 - e));
    tmp.q.premultiply(tmp.spin).premultiply(tmp.flutter);
    // Grows mostly in the second half, as it nears the parchment.
    const sc = THREE.MathUtils.lerp(tmp.s0.x || 1, s1, Math.pow(e, 1.4));
    g.position.copy(tmp.p);
    g.quaternion.copy(tmp.q);
    g.scale.setScalar(sc);
    // The bit of string comes away with it, then falls slack and fades.
    if (string.current) string.current.scale.set(Math.max(0.0001, 1 - k * 1.6), Math.max(0.0001, (STRING + TAG_H * HOLE_Y) * (1 - k * 1.4)), 1);
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={string} geometry={stringGeo} material={twine} position={[0, 0.06, 0]} />
      <mesh material={twine} position={[0, -TAG_H * HOLE_Y, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[LOOP_R, 0.0045, 6, 16]} />
      </mesh>
      <mesh geometry={geometry} material={materials} />
    </group>
  );
}
