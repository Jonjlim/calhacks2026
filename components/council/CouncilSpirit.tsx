"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { type AvatarClip, type AvatarId, avatarUrl, toToon } from "@/components/characters/StorybookAvatar";
import { COUNCIL_TINT } from "@/lib/council/animation";
import type { CouncilActor, CouncilMemberState } from "@/lib/council/contracts";

/**
 * A council agent drawn as one of the island's storybook spirits, so the tower
 * shares the outside world's cast. Agents differ from friends by a cloak and
 * hood in their role colour, a floating role gem, and the role mat at their
 * feet. Motion still comes only from persisted task events.
 */

/** Which spirit body each role wears; headwear and accessory suit the job. */
export const COUNCIL_AVATAR: Record<CouncilActor, AvatarId> = {
  archivist: "curious", // goggles for reading
  muse: "dreamer", // stargazer cap
  scout: "explorer", // travelling scarf
  keeper: "calm", // steady, holds the budget
  courier: "kind", // flower for delivery
};

const ROLE_MATERIAL = /cloak|hood/i;
const tintCache = new Map<string, THREE.MeshToonMaterial>();

function roleMaterial(source: THREE.Material, actor: CouncilActor): THREE.Material {
  const toon = toToon(source);
  if (!(toon instanceof THREE.MeshToonMaterial) || !ROLE_MATERIAL.test(source.name)) return toon;
  const key = `${actor}:${source.name}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const copy = toon.clone();
  copy.vertexColors = false;
  copy.color.set(COUNCIL_TINT[actor]);
  // Hoods a shade lighter than cloaks so the silhouette still reads.
  if (/hood/i.test(source.name)) copy.color.offsetHSL(0, -0.05, 0.08);
  copy.needsUpdate = true;
  tintCache.set(key, copy);
  return copy;
}

/** Task status to the spirit's clips: working is a lively idle with a busy gem, finishing celebrates once. */
function clipFor(status: CouncilMemberState["status"]): { clip: AvatarClip; once: boolean } {
  if (status === "completed") return { clip: "Celebrate", once: true };
  if (status === "failed") return { clip: "Sit", once: true };
  return { clip: "Idle", once: false };
}

export function CouncilSpirit({ state, position, rotationY = 0, scale = 1, animate = true, onReady }: {
  state: CouncilMemberState; position: [number, number, number]; rotationY?: number; scale?: number; animate?: boolean; onReady?: () => void;
}) {
  const { scene, animations } = useGLTF(avatarUrl(COUNCIL_AVATAR[state.actor]));
  const invalidate = useThree((s) => s.invalidate);
  const instance = useMemo(() => {
    const c = clone(scene);
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => roleMaterial(m, state.actor)) : roleMaterial(mesh.material, state.actor);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    return c;
  }, [scene, state.actor]);
  const { actions, mixer } = useAnimations(animations, instance);

  // A completion that already happened before this visit rests quietly instead of replaying a celebration.
  const initialSequence = useRef(state.sequence);
  const restored = state.status === "completed" && state.sequence === initialSequence.current;
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(false), [state.sequence, state.status]);
  const target = !animate || restored || settled ? { clip: "Idle" as AvatarClip, once: false } : clipFor(state.status);

  useEffect(() => {
    const action = actions[target.clip];
    if (!action) return;
    action.reset();
    action.setLoop(target.once ? THREE.LoopOnce : THREE.LoopRepeat, target.once ? 1 : Infinity);
    action.clampWhenFinished = target.once;
    action.fadeIn(0.22).play();
    invalidate();
    return () => void action.fadeOut(0.22);
  }, [actions, target.clip, target.once, invalidate]);

  useEffect(() => {
    mixer.timeScale = animate ? 1 : 0;
    if (!animate) mixer.update(0);
  }, [animate, mixer]);

  useEffect(() => {
    const finished = (e: { action: THREE.AnimationAction }) => {
      // Celebrate returns to idle; a failure stays seated until the next event.
      if (e.action.getClip().name === "Celebrate") setSettled(true);
    };
    mixer.addEventListener("finished", finished);
    return () => mixer.removeEventListener("finished", finished);
  }, [mixer]);

  useEffect(() => { onReady?.(); }, [onReady]);

  // The role gem: spins and glows while the agent is working, rests otherwise.
  const gem = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.Group>(null);
  const gemMaterial = useMemo(
    () => new THREE.MeshToonMaterial({ color: COUNCIL_TINT[state.actor], emissive: COUNCIL_TINT[state.actor], emissiveIntensity: 0.35 }),
    [state.actor],
  );
  const working = animate && state.status === "started";
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (gem.current) {
      gem.current.rotation.y += dt * (working ? 3.2 : 0.6);
      gem.current.position.y = 2.75 + Math.sin(t * (working ? 4 : 1.6)) * (working ? 0.09 : 0.05);
    }
    gemMaterial.emissiveIntensity = working ? 0.9 + Math.sin(t * 6) * 0.25 : 0.35;
    // A small busy sway layered over Idle while working.
    if (body.current) body.current.rotation.z = working ? Math.sin(t * 5) * 0.035 : 0;
    if (working) invalidate();
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <group ref={body}>
        <primitive object={instance} dispose={null} />
      </group>
      <mesh ref={gem} position={[0, 2.75, 0]} material={gemMaterial} castShadow>
        <octahedronGeometry args={[0.16, 0]} />
      </mesh>
      {/* Role-coloured mat, brighter while this member is working. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <circleGeometry args={[0.95, 28]} />
        <meshToonMaterial color={COUNCIL_TINT[state.actor]} transparent opacity={state.status === "started" ? 0.85 : 0.5} />
      </mesh>
    </group>
  );
}
