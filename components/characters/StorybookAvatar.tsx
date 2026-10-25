"use client";

import { useAnimations, useGLTF } from "@react-three/drei";
import { type ThreeElements, useFrame } from "@react-three/fiber";
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

/** A council robot built on the same body and rig: role-coloured toon shell, screen visor, bolted-on parts. */
export interface RobotLook {
  tint: string;
  /** Pulses the antenna light. */
  working?: boolean;
}

// Clothing and painted face details that read as "spirit", not "robot".
const ROBOT_HIDDEN = /^(Eye|Smile|Scarf • (knot|left tie|right tie)|Satchel|Map|Tunic • trail stitch)|hood leaf/;
const robotCache = new Map<string, THREE.MeshToonMaterial>();

function robotMaterial(kind: "shell" | "panel" | "visor" | "metal", tint: string): THREE.MeshToonMaterial {
  const key = `${kind}:${tint}`;
  const hit = robotCache.get(key);
  if (hit) return hit;
  const base = new THREE.Color(tint);
  const color = kind === "shell" ? base
    : kind === "panel" ? base.clone().lerp(new THREE.Color("#fff6ea"), 0.68)
    : kind === "visor" ? new THREE.Color("#22293a")
    : new THREE.Color("#d9d4cc");
  const m = new THREE.MeshToonMaterial({ name: `Robot • ${kind}`, color, gradientMap: toonRamp() });
  if (kind === "visor") { m.emissive.set(tint).multiplyScalar(0.12); }
  robotCache.set(key, m);
  return m;
}

function robotSkin(source: THREE.Material, tint: string): THREE.Material {
  const name = source.name.toLowerCase();
  if (/amber/.test(name)) return toToon(source);
  if (/ivory/.test(name)) return robotMaterial("visor", tint);
  if (/hood|cloak|leaf|boot/.test(name)) return robotMaterial("shell", tint);
  if (/brass|gold/.test(name)) return robotMaterial("metal", tint);
  return robotMaterial("panel", tint);
}

/** Head-bone-local parts, measured against the exported face shield and hood top. */
function buildRobotParts(tint: string) {
  const parts = new THREE.Group();
  parts.name = "RobotParts";
  const glow = new THREE.MeshBasicMaterial({ color: "#d8fbff", toneMapped: false });
  const tip = new THREE.MeshBasicMaterial({ color: tint, toneMapped: false });
  const metal = robotMaterial("metal", tint);
  const panel = robotMaterial("panel", tint);
  const eye = new THREE.SphereGeometry(0.075, 14, 10);
  for (const x of [-0.17, 0.17]) {
    const e = new THREE.Mesh(eye, glow);
    e.position.set(x, 0.56, 0.5);
    e.scale.set(1, 1.35, 0.5);
    parts.add(e);
  }
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.32, 8), metal);
  stalk.position.set(0, 1.26, -0.05);
  parts.add(stalk);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), tip);
  ball.position.set(0, 1.45, -0.05);
  parts.add(ball);
  const bolt = new THREE.CylinderGeometry(0.11, 0.11, 0.12, 14);
  const light = new THREE.CircleGeometry(0.055, 12);
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(bolt, panel);
    b.rotation.z = Math.PI / 2;
    b.position.set(s * 0.64, 0.5, 0);
    parts.add(b);
    const l = new THREE.Mesh(light, tip);
    l.rotation.y = s * Math.PI / 2;
    l.position.set(s * 0.705, 0.5, 0);
    parts.add(l);
  }
  parts.traverse((o) => void (o.frustumCulled = false));
  const dispose = () => {
    glow.dispose();
    tip.dispose();
    eye.dispose();
    bolt.dispose();
    light.dispose();
    (stalk.geometry as THREE.BufferGeometry).dispose();
    (ball.geometry as THREE.BufferGeometry).dispose();
  };
  return { parts, tip, dispose };
}
// Shared toon conversions, so cloned instances keep sharing GPU programs.
const WHITE = new THREE.Color("#ffffff");
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
  /** Render as a council robot instead of the player spirit. */
  robot?: RobotLook;
}

export function StorybookAvatar({ avatar, clip = "Idle", onClipFinished, timeScale = 1, castShadow = true, robot, ...group }: StorybookAvatarProps) {
  const { scene, animations } = useGLTF(avatarUrl(avatar));
  const tint = robot?.tint;
  const instance = useMemo(() => {
    const c = clone(scene);
    const skin = (m: THREE.Material) => (tint ? robotSkin(m, tint) : toToon(m));
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (tint && ROBOT_HIDDEN.test(mesh.name)) mesh.visible = false;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(skin) : skin(mesh.material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      // Skinned bounds are computed in bind pose; animated limbs can leave them.
      mesh.frustumCulled = false;
    });
    return c;
  }, [scene, castShadow, tint]);
  const robotParts = useMemo(() => {
    if (!tint) return null;
    const head = instance.getObjectByName("head");
    if (!head) return null;
    const built = buildRobotParts(tint);
    head.add(built.parts);
    return built;
  }, [instance, tint]);
  useEffect(() => () => robotParts?.dispose(), [robotParts]);
  const working = !!robot?.working;
  const tipColor = useMemo(() => new THREE.Color(tint ?? "#ffffff"), [tint]);
  useFrame(({ clock }) => {
    if (!robotParts) return;
    const pulse = working ? 0.55 + 0.45 * Math.sin(clock.elapsedTime * 6) : 0;
    robotParts.tip.color.copy(tipColor).lerp(WHITE, 0.15 + pulse * 0.6);
  });
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
