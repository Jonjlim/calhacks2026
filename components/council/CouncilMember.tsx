"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { toToon } from "@/components/characters/StorybookAvatar";
import { COUNCIL_MODELS, COUNCIL_TINT, poseFor, type CouncilClip } from "@/lib/council/animation";
import type { CouncilMemberState } from "@/lib/council/contracts";

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
      if (capsule && /^Eye(Left|Right)$/.test(mesh.name)) { mesh.scale.x *= 1.12; mesh.scale.y *= 1.12; }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    return c;
  }, [scene, state.actor]);
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
