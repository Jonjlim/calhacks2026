"use client";

import { useFrame } from "@react-three/fiber";
import { Component, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { INTRO_TIMES, introClock } from "@/components/intro/introTimeline";
import { platformTop } from "@/components/world/props/Stonework";
import { GIFT_SPOT } from "@/components/world/sceneConfig";
import { groundAt } from "@/components/world/terrain";
import { onGiftPop } from "@/components/world/worldEvents";
import { MiniSpirit } from "./MiniSpirit";
import { AVATAR_WORLD_SCALE, type AvatarClip, type AvatarId, preloadAvatars, StorybookAvatar } from "./StorybookAvatar";

preloadAvatars();

/**
 * The Gift Garden's inhabitants, each with a small routine of its own.
 * Routines are driven by the frame clock (not timers), react to the present
 * being tapped, and take cues from the intro tour so the spirits greet the
 * camera as it passes.
 */

type Routine =
  | { kind: "greeter"; every: number }
  | { kind: "gardener"; every: number }
  | { kind: "keeper"; every: number }
  | { kind: "sitter" }
  | { kind: "stroller"; from: [number, number]; to: [number, number]; speed: number; pause: number };

interface CastMember {
  avatar: AvatarId;
  at: [number, number];
  /** What the spirit looks toward when idle. */
  facing: [number, number];
  routine: Routine;
  /** Intro-clock time at which this spirit greets the passing camera. */
  cue?: { t: number; clip: AvatarClip };
}

const GIFT: [number, number] = [GIFT_SPOT.x, GIFT_SPOT.z];

export const CAST: CastMember[] = [
  { avatar: "curious", at: [2.3, 2.55], facing: [1.2, 9], routine: { kind: "greeter", every: 11 }, cue: { t: INTRO_TIMES.giftReveal + 0.5, clip: "Wave" } },
  { avatar: "dreamer", at: [-1.05, 1.25], facing: GIFT, routine: { kind: "sitter" } },
  { avatar: "kind", at: [-3.35, 2.05], facing: [-2.4, 3.2], routine: { kind: "gardener", every: 13 }, cue: { t: INTRO_TIMES.worldFlythrough - 0.3, clip: "Celebrate" } },
  { avatar: "calm", at: [-2.05, -1.2], facing: [-0.4, 3], routine: { kind: "keeper", every: 16 }, cue: { t: INTRO_TIMES.worldFlythrough + 0.3, clip: "Wave" } },
  { avatar: "explorer", at: [3.0, 3.45], facing: [4.6, 3.85], routine: { kind: "stroller", from: [3.0, 3.42], to: [4.55, 3.8], speed: 0.42, pause: 2.5 } },
];

const yawToward = (from: [number, number], to: [number, number]) => Math.atan2(to[0] - from[0], to[1] - from[1]);

function Actor({ member, animate }: { member: CastMember; animate: boolean }) {
  const root = useRef<THREE.Group>(null);
  const [clip, setClip] = useState<AvatarClip>(member.routine.kind === "sitter" ? "Sit" : "Idle");
  const state = useRef({ next: 4 + Math.random() * 4, cueRun: -1, busy: false, walk: { t: 0, dir: 1, pausing: 0 } });
  const r = member.routine;

  const play = useCallback((c: AvatarClip) => {
    state.current.busy = c === "Wave" || c === "Celebrate";
    setClip(c);
  }, []);

  useEffect(
    () =>
      onGiftPop(() => {
        if (r.kind !== "sitter") play("Celebrate");
      }),
    [play, r.kind],
  );

  useFrame(({ clock }, dt) => {
    const s = state.current;
    const g = root.current;
    if (!g) return;
    const t = clock.elapsedTime;

    // Intro cue: greet the camera once per intro run.
    if (member.cue && introClock.active && s.cueRun !== introClock.run && introClock.t >= member.cue.t && introClock.t < member.cue.t + 1) {
      s.cueRun = introClock.run;
      play(member.cue.clip);
    }

    if (r.kind === "stroller") {
      const w = s.walk;
      if (!animate) return;
      if (s.busy) return;
      const len = Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]);
      if (w.pausing > 0) {
        w.pausing -= dt;
        if (w.pausing <= 0 && clip !== "Walk") setClip("Walk");
      } else {
        w.t += (Math.min(dt, 0.1) * r.speed * w.dir) / len;
        if (w.t >= 1 || w.t <= 0) {
          w.t = THREE.MathUtils.clamp(w.t, 0, 1);
          w.dir *= -1;
          w.pausing = r.pause;
          setClip("Idle");
        } else if (clip !== "Walk") setClip("Walk");
      }
      const x = THREE.MathUtils.lerp(r.from[0], r.to[0], w.t);
      const z = THREE.MathUtils.lerp(r.from[1], r.to[1], w.t);
      g.position.set(x, groundAt(x, z) - 0.02, z);
      const heading = w.dir > 0 ? yawToward(r.from, r.to) : yawToward(r.to, r.from);
      // During a pause the spirit turns to look back toward the gift.
      const want = w.pausing > 0 ? yawToward([x, z], GIFT) : heading;
      g.rotation.y += Math.atan2(Math.sin(want - g.rotation.y), Math.cos(want - g.rotation.y)) * (1 - Math.exp(-dt * 5));
      return;
    }

    if (!animate || s.busy || r.kind === "sitter") return;
    if (t > s.next) {
      s.next = t + r.every * (0.8 + Math.random() * 0.4);
      play(r.kind === "greeter" ? "Wave" : "Celebrate");
    }
  });

  const onFinished = useCallback(() => {
    state.current.busy = false;
    setClip(r.kind === "stroller" ? (state.current.walk.pausing > 0 ? "Idle" : "Walk") : "Idle");
  }, [r.kind]);

  const [x, z] = member.at;
  return (
    <group ref={root} position={[x, groundAt(x, z) - 0.02, z]} rotation={[0, yawToward(member.at, member.facing), 0]}>
      <StorybookAvatar avatar={member.avatar} clip={clip} onClipFinished={onFinished} scale={AVATAR_WORLD_SCALE} />
    </group>
  );
}

/** Marks the world gate once avatars (or their fallbacks) are in the scene. */
function Ready() {
  useEffect(() => {
    introClock.gates.world = true;
  }, []);
  return null;
}

class AvatarBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("Storybook avatars failed to load; showing placeholder spirits.", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const GIFT_LOOK: [number, number, number] = [GIFT_SPOT.x, platformTop() + 1, GIFT_SPOT.z];

/** Placeholder spirits, kept only as a load-failure fallback. */
function PlaceholderCast({ animate }: { animate: boolean }) {
  const at = (x: number, z: number): [number, number, number] => [x, groundAt(x, z) - 0.02, z];
  return (
    <>
      <MiniSpirit variant="dreamer" position={at(-0.95, 1.05)} lookAt={GIFT_LOOK} scale={1.25} animate={animate} seed={1} />
      <MiniSpirit variant="curious" position={at(2.2, 2.65)} lookAt={GIFT_LOOK} behavior="wave" scale={1.2} animate={animate} seed={2} />
      <MiniSpirit variant="kind" position={at(-4.2, 1.6)} lookAt={GIFT_LOOK} behavior="sway" scale={1.15} animate={animate} seed={3} />
      <Ready />
    </>
  );
}

export function AvatarCast({ animate }: { animate: boolean }) {
  return (
    <AvatarBoundary fallback={<PlaceholderCast animate={animate} />}>
      <Suspense fallback={null}>
        {CAST.map((m) => (
          <Actor key={m.avatar} member={m} animate={animate} />
        ))}
        <Ready />
      </Suspense>
    </AvatarBoundary>
  );
}
