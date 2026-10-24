"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { toonRamp } from "@/components/world/painterly/textures";
import type { SpiritVariant } from "./spiritVariants";

/**
 * One of the five production storybook spirits (Blender → glTF). Reusable in
 * any scene inside the app's Canvas + Suspense. Each instance gets its own
 * skeleton clone and mixer; clip names are the exported, case-sensitive ones.
 */

export type AvatarId = SpiritVariant;
export type AvatarClip = "Idle" | "Walk" | "Wave" | "Sit" | "Celebrate";

export const AVATAR_IDS: readonly AvatarId[] = ["explorer", "dreamer", "kind", "calm", "curious"];
export const avatarUrl = (id: AvatarId) => `/avatars/${id}.glb`;

/** Exports are ~2.2 units to the hood; this puts them at storybook-spirit size beside the present. */
export const AVATAR_WORLD_SCALE = 0.5;

const ONE_SHOT: ReadonlySet<AvatarClip> = new Set(["Wave", "Sit", "Celebrate"]);

// Shared toon conversions, so cloned instances keep sharing GPU programs.
const toonCache = new Map<string, THREE.MeshToonMaterial>();

/**
 * Re-shades the exported matte PBR materials with the world's painterly toon
 * ramp, keeping every authored colour, vertex colour and emissive (lantern,
 * stars) exactly as painted.
 */
export function toToon(source: THREE.Material): THREE.Material {
  if (!(source instanceof THREE.MeshStandardMaterial)) return source;
  const hit = toonCache.get(source.uuid);
  if (hit) return hit;
  const toon = new THREE.MeshToonMaterial({
    name: source.name,
    color: source.color,
    map: source.map,
    vertexColors: source.vertexColors,
    emissive: source.emissive,
    emissiveMap: source.emissiveMap,
    emissiveIntensity: source.emissiveIntensity,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    gradientMap: toonRamp(),
  });
  toonCache.set(source.uuid, toon);
  return toon;
}

export interface StorybookAvatarProps extends Omit<ThreeElements["group"], "ref"> {
  avatar: AvatarId;
  clip?: AvatarClip;
  /** Fired when a one-shot clip (Wave, Celebrate) completes; Sit holds and does not fire. */
  onClipFinished?: (clip: AvatarClip) => void;
  /** Playback speed, e.g. to match Walk to the instance's travel speed. */
  timeScale?: number;
  castShadow?: boolean;
}

export function StorybookAvatar({ avatar, clip = "Idle", onClipFinished, timeScale = 1, castShadow = true, ...group }: StorybookAvatarProps) {
  const { scene, animations } = useGLTF(avatarUrl(avatar));
  const instance = useMemo(() => {
    const c = clone(scene);
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toToon) : toToon(mesh.material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      // Skinned bounds are computed in bind pose; animated limbs can leave them.
      mesh.frustumCulled = false;
    });
    return c;
  }, [scene, castShadow]);
  const { actions, mixer } = useAnimations(animations, instance);
  const finished = useRef(onClipFinished);
  finished.current = onClipFinished;

  useEffect(() => {
    const action = actions[clip];
    if (!action) return;
    const once = ONE_SHOT.has(clip);
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once;
    action.fadeIn(0.22).play();
    return () => {
      action.fadeOut(0.22);
    };
  }, [actions, clip]);

  useEffect(() => {
    const action = actions[clip];
    if (action) action.timeScale = timeScale;
  }, [actions, clip, timeScale]);

  useEffect(() => {
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      const name = e.action.getClip().name as AvatarClip;
      if (name !== "Sit") finished.current?.(name);
    };
    mixer.addEventListener("finished", onFinished);
    return () => mixer.removeEventListener("finished", onFinished);
  }, [mixer]);

  return (
    <group {...group}>
      <primitive object={instance} dispose={null} />
    </group>
  );
}

export function preloadAvatars() {
  for (const id of AVATAR_IDS) useGLTF.preload(avatarUrl(id));
}
