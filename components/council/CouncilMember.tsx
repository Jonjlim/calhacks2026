"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { toToon } from "@/components/characters/StorybookAvatar";
import { COUNCIL_MODELS, COUNCIL_TINT, poseFor } from "@/lib/council/animation";
import type { CouncilMemberState } from "@/lib/council/contracts";

/** A private skeleton/mixer per instance; shared immutable geometry and painterly materials. */
export function CouncilMember({ state, position, rotationY = 0, scale = 1, animate = true, onReady }: {
  state: CouncilMemberState; position: [number, number, number]; rotationY?: number; scale?: number; animate?: boolean; onReady?: () => void;
}) {
  const { scene, animations } = useGLTF(COUNCIL_MODELS[state.actor]);
  const invalidate = useThree(s => s.invalidate);
  const instance = useMemo(() => {
    const c = clone(scene);
    const tint = new THREE.Color(COUNCIL_TINT[state.actor]);
    // Role colour on the enamel casing and fabric panels only; brass, porcelain, eyes and the star core keep their authored colours.
    const role = (m: THREE.Material) => {
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
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    return c;
  }, [scene, state.actor]);
  const { actions, mixer } = useAnimations(animations, instance);
  const pose = poseFor(state);
  const current = useRef<THREE.AnimationAction | null>(null);
  // Existing completion events restore a quiet pose after refresh, not a new celebration.
  const initialSequence = useRef(state.sequence);
  const restoredCompletion = state.status === "completed" && state.sequence === initialSequence.current;
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
    play(!animate || restoredCompletion ? "idle" : pose.clip, animate && !restoredCompletion && pose.once);
    if (!animate) { mixer.update(0); invalidate(); }
  }, [animate, mixer, play, pose.clip, pose.once, restoredCompletion, invalidate]);
  useEffect(() => {
    const finished = (e: { action: THREE.AnimationAction }) => {
      if (e.action === current.current && pose.then) play(pose.then, false);
    };
    mixer.addEventListener("finished", finished);
    return () => mixer.removeEventListener("finished", finished);
  }, [mixer, pose.then, play]);
  useEffect(() => { onReady?.(); }, [onReady]);
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <primitive object={instance} dispose={null} />
      {/* Role-coloured mat, brighter while this member is working. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <circleGeometry args={[0.62, 28]} />
        <meshToonMaterial color={COUNCIL_TINT[state.actor]} transparent opacity={state.status === "started" ? 0.85 : 0.5} />
      </mesh>
    </group>
  );
}
