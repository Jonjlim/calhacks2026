"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { toToon } from "@/components/characters/StorybookAvatar";
import { COUNCIL_MODELS, COUNCIL_TINT, poseFor, type CouncilClip } from "@/lib/council/animation";
import type { CouncilMemberState } from "@/lib/council/contracts";

/**
 * Rounds the capsule's boxy corners. The body is a squarish rounded block; every
 * vertex (shell, face, trim) is pulled in by how far its corner sticks out past
 * a circle, in height against distance from the axis, so the silhouette becomes
 * a soft egg while the face and the shell still line up. Geometry is cloned first
 * (the loaded model is shared), and only the bind pose is changed.
 */
function roundCorners(root: THREE.Object3D) {
  const body = (root.getObjectByName("Shell") ?? root.getObjectByName("Body")) as THREE.Mesh | undefined;
  if (!body?.geometry) return;
  body.geometry.computeBoundingBox();
  const bb = body.geometry.boundingBox!;
  const a = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z));
  const b = (bb.max.y - bb.min.y) / 2;
  const yc = (bb.max.y + bb.min.y) / 2;
  const P = 4.2;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry || /Flipper|Antenna|RoleAccessory|SecondaryAccessory|Backpack/.test(m.name)) return;
    m.geometry = m.geometry.clone();
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = pos.getY(i) - yc;
      const hu = Math.hypot(x, z) / a;
      const vu = Math.abs(y) / b;
      // Only the body proper: leave anything far outside it (arms, props) alone.
      if (hu > 1.12 || vu > 1.12) continue;
      const rp = Math.pow(Math.pow(hu, P) + Math.pow(vu, P), 1 / P);
      const r2 = Math.hypot(hu, vu);
      if (rp < 0.01) continue;
      const k = THREE.MathUtils.lerp(1, Math.min(1, rp / r2), 0.9);
      // Keep the face on the front: pull in sideways and in height, never push the front back.
      pos.setXYZ(i, x * k, yc + y * (0.5 + 0.5 * k), z * (0.55 + 0.45 * k));
    }
    pos.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  });
}

/** A private skeleton/mixer per instance; shared immutable geometry and painterly materials. */
export function CouncilMember({ state, position, rotationY = 0, scale = 1, animate = true, onReady, clipOverride }: {
  state: CouncilMemberState; position: [number, number, number]; rotationY?: number; scale?: number; animate?: boolean; onReady?: () => void; clipOverride?: CouncilClip;
}) {
  const { scene, animations } = useGLTF(COUNCIL_MODELS[state.actor]);
  const root = useRef<THREE.Group>(null);
  const invalidate = useThree(s => s.invalidate);
  const instance = useMemo(() => {
    const c = clone(scene);
    const tint = new THREE.Color(COUNCIL_TINT[state.actor]);
    const capsule = !!c.getObjectByName("FaceScreen");
    // Role colour on the enamel casing and fabric panels only; brass, porcelain, eyes and the star core keep their authored colours.
    const capsuleMaterials = new Map<string, THREE.Material>();
    const role = (m: THREE.Material) => {
      if (capsule && m instanceof THREE.MeshStandardMaterial) {
        const cached = capsuleMaterials.get(m.uuid);
        if (cached) return cached;
        // Preserve soft ceramic shading. The world's toon ramp erases this rounded silhouette.
        const soft = m.clone();
        soft.flatShading = false;
        soft.envMapIntensity = 0.7;
        soft.userData = { ...soft.userData, capsulePrivate: true };
        if (m.name === "Screen") { soft.roughness = 0.32; soft.metalness = 0; }
        else if (m.name === "ScreenShadow") { soft.vertexColors = false; soft.color.set("#cabfae"); }
        else if (m.name === "Glow") {
          soft.color.set("#a6e4f4");
          soft.emissive.set("#70cfea");
          soft.emissiveIntensity = 0.65;
        }
        else if (m.name === "Ivory" || m.name === "Accent") soft.roughness = 0.64;
        capsuleMaterials.set(m.uuid, soft);
        return soft;
      }
      const toon = toToon(m);
      if (!(toon instanceof THREE.MeshToonMaterial)) return toon;
      // Lighter warm-grey shell: scales the painted vertex colour, so brush variation survives.
      const lighten = /porcelain$/i.test(m.name) ? 1.85 : /panel_shadow$/i.test(m.name) ? 2.2 : 0;
      if (lighten) {
        const light = toon.clone();
        light.color.setScalar(lighten);
        return light;
      }
      if (!/(enamel|accent|apron|blue|edge|seal)$/i.test(m.name)) return toon;
      // Painted directly (not multiplied into the dark vertex paint) so each role reads at a glance.
      const copy = toon.clone();
      copy.vertexColors = false;
      copy.color.copy(tint);
      copy.needsUpdate = true;
      return copy;
    };
    c.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(role) : role(mesh.material);
      if (capsule && /^Eye(Left|Right)$/.test(mesh.name)) { mesh.scale.x *= 1.3; mesh.scale.y *= 1.3; }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    // Slimmer and cuter: a narrower, rounder body (its flippers and face come with it), set on the clone only.
    if (capsule) {
      c.scale.set(c.scale.x * 0.84, c.scale.y * 0.95, c.scale.z * 0.84);
      roundCorners(c);
      // The arms follow the narrower body in.
      for (const n of ["LeftFlipper", "RightFlipper"]) c.getObjectsByProperty("name", n).forEach((o) => { if (!(o as THREE.Mesh).isMesh) o.position.x *= 0.9; });
    }
    return c;
  }, [scene, state.actor]);
  const antenna = useMemo(() => instance.getObjectByName("Antenna") ?? null, [instance]);
  const { actions, mixer } = useAnimations(animations, instance);
  const capsuleParts = useMemo(() => {
    const eyes: THREE.Mesh[] = [];
    instance.traverse(o => { if (o instanceof THREE.Mesh && o.morphTargetDictionary?.happy !== undefined) eyes.push(o); });
    return { eyes, props: [instance.getObjectByName("RoleAccessory"), instance.getObjectByName("SecondaryAccessory")] };
  }, [instance]);
  useEffect(() => () => {
    const owned = new Set<THREE.Material>();
    instance.traverse(o => {
      if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.userData.capsulePrivate) owned.add(m);
    });
    owned.forEach(m => m.dispose());
  }, [instance]);
  const pose = poseFor(state);
  const current = useRef<THREE.AnimationAction | null>(null);
  // Existing completion events restore a quiet pose after refresh, not a new celebration.
  const playedCompletion = useRef(state.status === "completed" ? state.sequence : -1);
  const play = useCallback((name: string, once: boolean) => {
    const next = actions[name];
    if (!next) return;
    if (current.current !== next) current.current?.fadeOut(0.25);
    next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.fadeIn(0.25).play();
    current.current = next;
    invalidate();
  }, [actions, invalidate]);
  useEffect(() => {
    mixer.timeScale = animate ? 1 : 0;
    if (state.status === "started") playedCompletion.current = -1;
    const restoredCompletion = state.status === "completed" && state.sequence <= playedCompletion.current;
    const clip = !animate ? "idle" : clipOverride ?? (restoredCompletion ? "idle" : pose.clip);
    play(clip, animate && !clipOverride && !restoredCompletion && pose.once);
    if (!clipOverride && state.status === "completed") playedCompletion.current = state.sequence;
    if (!animate) { mixer.update(0); invalidate(); }
  }, [animate, mixer, play, pose.clip, pose.once, clipOverride, state.status, state.sequence, invalidate]);
  useEffect(() => {
    const finished = (e: { action: THREE.AnimationAction }) => {
      if (e.action === current.current && pose.then) play(pose.then, false);
    };
    mixer.addEventListener("finished", finished);
    return () => mixer.removeEventListener("finished", finished);
  }, [mixer, pose.then, play]);
  useEffect(() => { onReady?.(); }, [onReady]);
  useFrame(({ clock }) => {
    // Big, bouncy antennas: set after the animation has posed the bone, so the clip cannot shrink them back.
    if (antenna) {
      const sway = animate ? Math.sin(clock.elapsedTime * 2.2 + state.actor.length) * 0.08 : 0;
      antenna.scale.setScalar(1.95);
      antenna.rotation.z = sway;
    }
    if (!root.current) return;
    const phase = Object.keys(COUNCIL_MODELS).indexOf(state.actor) * 1.2;
    root.current.position.y = position[1] + 0.42 + (animate ? Math.sin(clock.elapsedTime * 1.3 + phase) * 0.025 : 0);
    const resting = ["idle", "walk", "wave", "happy", "celebrate"].includes(current.current?.getClip().name ?? "idle");
    capsuleParts.props.forEach(p => p?.scale.setScalar(resting ? 0.001 : 1));
    if (current.current?.getClip().name === "idle" && (state.actor === "muse" || state.actor === "keeper")) {
      for (const eye of capsuleParts.eyes) if (eye.morphTargetInfluences && eye.morphTargetDictionary) eye.morphTargetInfluences[eye.morphTargetDictionary.happy!] = 0.85;
    }
  });
  return (
    <group ref={root} position={[position[0], position[1] + 0.42, position[2]]} rotation={[0, rotationY, 0]} scale={scale * 0.67}>
      <primitive object={instance} dispose={null} />

    </group>
  );
}
