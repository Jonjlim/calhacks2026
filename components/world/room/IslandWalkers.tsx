"use client";

import { useFrame } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { type AvatarClip, AVATAR_WORLD_SCALE, StorybookAvatar } from "@/components/characters/StorybookAvatar";
import { avatarFor } from "@/lib/room/avatars";
import { useConvergenceActive } from "@/components/convergence/convergenceClock";
import type { RoomWorld } from "../IslandWorldProvider";
import { GIFT_SPOT } from "../sceneConfig";
import { groundAt } from "../terrain";

/**
 * The friends who have joined the room, walking about the main island on the
 * gift map: one storybook spirit per real participant (never invented), each
 * strolling between spots of its own, pausing to look at the present or wave,
 * steering round the pedestal, tower, cottage and the book's lectern. A new
 * arrival pops in beside the present and waves. They stand clear of the
 * council dock, the rings and every label: they are scenery that tells you
 * who is here.
 */

/** Things on the lawn a walker must not cross: x, z, radius. */
const OBSTACLES: [number, number, number][] = [
  [GIFT_SPOT.x, GIFT_SPOT.z, 2.5],
  [-3.7, -2.7, 1.9],
  [4.7, -2.6, 1.7],
  [GIFT_SPOT.x - 1.7, GIFT_SPOT.z + 3.9, 1.1],
  [3.2, 0.25, 0.5],
];
const SCALE = AVATAR_WORLD_SCALE * 1.9;
const SPEED = 0.7;

const inside = (x: number, z: number) => (x / 5.1) ** 2 + ((z - 0.5) / 4.0) ** 2 < 1 && OBSTACLES.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) > r);
/** A clear straight walk: no obstacle within reach of the line between two spots. */
const clear = (a: [number, number], b: [number, number]) => {
  for (let i = 0; i <= 14; i++) {
    const k = i / 14;
    if (!inside(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)) return false;
  }
  return true;
};

function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Walker({ id, avatar, slot, arrived, animate }: { id: string; avatar: ReturnType<typeof avatarFor>; slot: number; arrived: boolean; animate: boolean }) {
  const root = useRef<THREE.Group>(null);
  const rand = useMemo(() => seededRandom([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7 + slot)), [id, slot]);
  const spot = useCallback((): [number, number] => {
    for (let i = 0; i < 40; i++) {
      const p: [number, number] = [(rand() * 2 - 1) * 5.1, 0.5 + (rand() * 2 - 1) * 4.0];
      if (inside(p[0], p[1])) return p;
    }
    return [1.2, 3.4];
  }, [rand]);
  const start = useMemo<[number, number]>(() => {
    // Arrivals step out beside the pedestal steps; everyone else is already somewhere.
    const p = arrived ? ([GIFT_SPOT.x + 0.9, GIFT_SPOT.z + 3.0] as [number, number]) : spot();
    return inside(p[0], p[1]) ? p : spot();
  }, [arrived, spot]);
  const [clip, setClip] = useState<AvatarClip>(arrived ? "Wave" : "Idle");
  const s = useRef({ pos: start, to: null as [number, number] | null, wait: 1 + rand() * 4, yaw: 0, born: -1, clip: (arrived ? "Wave" : "Idle") as AvatarClip, busy: arrived });

  const set = (c: AvatarClip) => {
    if (s.current.clip === c) return;
    s.current.clip = c;
    setClip(c);
  };

  useFrame(({ clock }, dtRaw) => {
    const g = root.current;
    if (!g) return;
    const st = s.current;
    const dt = Math.min(dtRaw, 0.1);
    if (st.born < 0) st.born = clock.elapsedTime;
    const age = clock.elapsedTime - st.born;
    const pop = THREE.MathUtils.clamp(age / 0.6, 0, 1);
    const grow = pop >= 1 ? 1 : 1 + 2.4 * Math.pow(pop - 1, 3) + 1.4 * Math.pow(pop - 1, 2);
    g.scale.setScalar(Math.max(0.0001, grow));
    if (animate && !st.busy) {
      if (st.to) {
        const dx = st.to[0] - st.pos[0];
        const dz = st.to[1] - st.pos[1];
        const d = Math.hypot(dx, dz);
        if (d < 0.08) {
          st.to = null;
          st.wait = 2 + rand() * 5;
          set("Idle");
          // Pauses to look at the present now and then.
          st.yaw = Math.atan2(GIFT_SPOT.x - st.pos[0], GIFT_SPOT.z - st.pos[1]);
        } else {
          const step = Math.min(d, SPEED * dt);
          st.pos = [st.pos[0] + (dx / d) * step, st.pos[1] + (dz / d) * step];
          st.yaw = Math.atan2(dx, dz);
          set("Walk");
        }
      } else {
        st.wait -= dt;
        if (st.wait <= 0) {
          let next: [number, number] | null = null;
          for (let i = 0; i < 12 && !next; i++) {
            const p = spot();
            if (clear(st.pos, p) && Math.hypot(p[0] - st.pos[0], p[1] - st.pos[1]) > 1.2) next = p;
          }
          if (next && rand() > 0.12) st.to = next;
          else {
            st.busy = true;
            setClip("Wave");
            st.clip = "Wave";
          }
          st.wait = 1;
        }
      }
    }
    g.position.set(st.pos[0], groundAt(st.pos[0], st.pos[1]) - 0.02, st.pos[1]);
    g.rotation.y += Math.atan2(Math.sin(st.yaw - g.rotation.y), Math.cos(st.yaw - g.rotation.y)) * (1 - Math.exp(-dt * 6));
  });

  const finished = useCallback(() => {
    s.current.busy = false;
    s.current.clip = "Idle";
    s.current.wait = 1.5 + rand() * 3;
    setClip("Idle");
  }, [rand]);

  return (
    <group ref={root} position={[start[0], groundAt(start[0], start[1]) - 0.02, start[1]]} scale={0.0001}>
      <StorybookAvatar avatar={avatar} clip={clip} timeScale={clip === "Walk" ? 1.05 : 1} onClipFinished={finished} scale={SCALE} />
    </group>
  );
}

export function IslandWalkers({ world, animate }: { world: RoomWorld; animate: boolean }) {
  const revealing = useConvergenceActive();
  const loaded = useRef<number>(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    loaded.current = Date.now();
    setNow(Date.now());
  }, []);
  const members = [...world.participants].sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
  // Someone who joined after this page opened arrives with a wave; everyone else was simply already here.
  const people = members.map((p, i) => ({ id: p.id, avatar: avatarFor(world.participants, p.id), slot: i, arrived: now > 0 && (p.joinedAt ?? 0) > loaded.current }));
  if (revealing) return null;
  return (
    <group>
      {people.map((p) => (
        <Suspense key={p.id} fallback={null}>
          <Walker id={p.id} avatar={p.avatar} slot={p.slot} arrived={p.arrived} animate={animate} />
        </Suspense>
      ))}
    </group>
  );
}
