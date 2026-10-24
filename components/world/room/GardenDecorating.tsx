"use client";

import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { type AvatarClip, type AvatarId, AVATAR_WORLD_SCALE, StorybookAvatar } from "@/components/characters/StorybookAvatar";
import { Decoration } from "@/components/council/Decoration";
import type { DecorationSpec } from "@/lib/council/contracts";
import { platformTop } from "../props/Stonework";
import { GIFT_SPOT } from "../sceneConfig";
import { groundAt } from "../terrain";
import type { RoomWorld } from "../IslandWorldProvider";
import { BASE_TOP, GIFT_BOX } from "../unwrap/invitationLayout";
import { gardenSpots, towerDoor } from "./stageLayout";
import { avatarForIndex, inJoinOrder } from "@/lib/room/avatars";
import { Jar, jarFor } from "./TowerInterior";

/**
 * Outside again: the friends leave the tower and decorate the island's own
 * present with the charms the Muse made from their memories. Each friend
 * carries the charms from *their* shared memories. Deliveries already made
 * in this browser are remembered per room, so a refresh shows the charms
 * attached instead of replaying the walk.
 */

/** Charm attachment points on the hero present, in its local (unscaled) frame. */
const W = GIFT_BOX.width / 2 + 0.04;
const SLOTS: Record<string, [number, number, number]> = {
  front_ribbon: [0, BASE_TOP * 0.62, W],
  front_corner: [0.55, BASE_TOP * 0.3, W],
  top_knot: [0.38, GIFT_BOX.height + 0.07, 0.3],
  lid_left: [-0.5, GIFT_BOX.height + 0.05, 0.32],
  lid_right: [0.5, GIFT_BOX.height + 0.05, -0.25],
  side_left: [-W, BASE_TOP * 0.6, 0.3],
  side_right: [W, BASE_TOP * 0.6, -0.3],
  back_ribbon: [0, BASE_TOP * 0.62, -W],
};

const giftMatrix = () =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(GIFT_SPOT.x, platformTop(), GIFT_SPOT.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), GIFT_BOX.rotationY),
    new THREE.Vector3(GIFT_BOX.scale, GIFT_BOX.scale, GIFT_BOX.scale),
  );

/** World position of a slot on the present. */
export function slotWorld(placement: string): THREE.Vector3 {
  return new THREE.Vector3(...(SLOTS[placement] ?? SLOTS.front_ribbon!)).applyMatrix4(giftMatrix());
}

const storeKey = (roomId: string) => `unwrap:charms-delivered:${roomId}`;
function readDelivered(roomId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(storeKey(roomId)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeDelivered(roomId: string, ids: Set<string>) {
  try {
    localStorage.setItem(storeKey(roomId), JSON.stringify([...ids]));
  } catch {
    /* storage blocked: deliveries just replay next time */
  }
}

const onGround = (x: number, z: number) => new THREE.Vector3(x, groundAt(x, z) - 0.02, z);

interface Walk {
  points: THREE.Vector3[];
  /** Index of the point where this friend hands over their charms (-1: no charms to deliver). */
  handover: number;
}

function Friend({ avatar, walk, delay, charms, onDelivered, animate }: { avatar: AvatarId; walk: Walk; delay: number; charms: DecorationSpec[]; onDelivered: (ids: string[]) => void; animate: boolean }) {
  const root = useRef<THREE.Group>(null);
  const carried = useRef<THREE.Group>(null);
  const [clip, setClip] = useState<AvatarClip>("Idle");
  const t = useRef(animate ? -delay : 999);
  const handed = useRef(false);
  const SPEED = 1.1;
  // Precompute cumulative lengths for constant-speed walking.
  const legs = useMemo(() => {
    const out = [0];
    for (let i = 1; i < walk.points.length; i++) out.push(out[i - 1]! + walk.points[i]!.distanceTo(walk.points[i - 1]!));
    return out;
  }, [walk]);
  const PAUSE = 1.2;

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    t.current += Math.min(dt, 0.05);
    const total = legs.at(-1)!;
    const handDist = walk.handover >= 0 ? legs[walk.handover]! : Infinity;
    // Time along the path, with a pause at the present to attach the charms.
    let d = Math.max(0, t.current) * SPEED;
    const pauseAt = handDist;
    let pausing = false;
    if (d > pauseAt) {
      const over = d - pauseAt;
      if (over < PAUSE * SPEED) {
        d = pauseAt;
        pausing = true;
      } else d -= PAUSE * SPEED;
    }
    d = Math.min(d, total);
    let i = 1;
    while (i < legs.length - 1 && legs[i]! < d) i++;
    const a = walk.points[i - 1]!;
    const b = walk.points[i] ?? a;
    const seg = Math.max(1e-6, legs[i]! - legs[i - 1]!);
    const k = Math.min(1, (d - legs[i - 1]!) / seg);
    g.position.copy(a).lerp(b, k);
    const moving = t.current > 0 && d < total && !pausing;
    if (moving) g.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    else if (pausing || d >= total) {
      const gift = new THREE.Vector3(GIFT_SPOT.x, 0, GIFT_SPOT.z);
      const want = Math.atan2(gift.x - g.position.x, gift.z - g.position.z);
      g.rotation.y += Math.atan2(Math.sin(want - g.rotation.y), Math.cos(want - g.rotation.y)) * 0.1;
    }
    const want: AvatarClip = moving ? "Walk" : pausing ? "Celebrate" : "Idle";
    if (want !== clip) setClip(want);
    // The charm rides overhead until the pause, then flies to its slot.
    if (carried.current) {
      const c = charms[0];
      if (!c || handed.current) carried.current.visible = false;
      else {
        carried.current.visible = t.current > 0;
        const over = d >= pauseAt ? Math.min(1, (t.current * SPEED - pauseAt) / (PAUSE * SPEED)) : 0;
        carried.current.position.copy(g.position).setY(g.position.y + 1.35).lerp(slotWorld(c.placement), THREE.MathUtils.smoothstep(over, 0.1, 0.8));
      }
    }
    if (pausing && !handed.current && charms.length && t.current * SPEED - pauseAt > PAUSE * SPEED * 0.8) {
      handed.current = true;
      onDelivered(charms.map((c) => c.memoryId));
    }
  });

  const start = walk.points[0]!;
  return (
    <>
      <group ref={root} position={start}>
        <StorybookAvatar avatar={avatar} clip={clip} scale={AVATAR_WORLD_SCALE} />
      </group>
      {charms[0] && (
        <group ref={carried} visible={false}>
          <Decoration spec={charms[0]} scale={1.9} />
        </group>
      )}
    </>
  );
}

export function GardenDecorating({ world, animate, arrival }: { world: RoomWorld; animate: boolean; arrival: number }) {
  const [delivered, setDelivered] = useState<Set<string>>(() => readDelivered(world.roomId));
  useEffect(() => setDelivered(readDelivered(world.roomId)), [world.roomId]);

  const owner = useMemo(() => {
    const byClue = new Map(world.clues.map((c) => [`mem_${c.id}`, c.publisherId]));
    return (memoryId: string) => byClue.get(memoryId);
  }, [world.clues]);

  // The cast is fixed for one arrival, so later data doesn't restart anyone's walk.
  const plan = useMemo(() => {
    const spots = gardenSpots(world.participants.length);
    const door = towerDoor();
    return inJoinOrder(world.participants).map((p, i) => {
      const mine = world.decorations.filter((d) => (owner(d.memoryId) ?? world.participants[0]?.id) === p.id && !delivered.has(d.memoryId));
      const [sx, sz] = spots[i]!;
      const spot = onGround(sx, sz);
      const points: THREE.Vector3[] = [];
      if (animate) points.push(onGround(door.x, door.z), onGround(door.x + 0.6, door.z + 1.2));
      let handover = -1;
      if (mine.length) {
        const slot = slotWorld(mine[0]!.placement);
        const toward = slot.clone().setY(0).sub(new THREE.Vector3(GIFT_SPOT.x, 0, GIFT_SPOT.z)).normalize();
        const stand = new THREE.Vector3(GIFT_SPOT.x, 0, GIFT_SPOT.z).addScaledVector(toward, 2.0);
        points.push(onGround(stand.x, stand.z));
        handover = points.length - 1;
      }
      points.push(spot);
      if (!animate) return { p, avatar: avatarForIndex(i), walk: { points: [spot], handover: -1 }, charms: [] as DecorationSpec[], delay: 0, i };
      return { p, avatar: avatarForIndex(i), walk: { points, handover }, charms: mine, delay: i * 0.7, i };
    });
    // Re-planned on each arrival and when the cast changes, deliberately not on every delivery or new charm.
  }, [arrival, world.participants, world.roomId, animate]);

  const markDelivered = (ids: string[]) =>
    setDelivered((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      writeDelivered(world.roomId, next);
      return next;
    });

  const attached = world.decorations.filter((d) => delivered.has(d.memoryId) || !animate);
  // The Garden of Memories: the same three jars, filled from the same room data as the tower's.
  const jarCounts = { wish: 0, interest: 0, moment: 0 };
  for (const c of world.clues) jarCounts[jarFor(c.kind)]++;
  const jarSpots: Record<"wish" | "interest" | "moment", [number, number]> = { wish: [-1.85, 1.55], interest: [-2.45, 0.2], moment: [2.6, 1.2] };
  return (
    <group>
      {(Object.keys(jarSpots) as ("wish" | "interest" | "moment")[]).map((k) => {
        const [jx, jz] = jarSpots[k];
        const x = GIFT_SPOT.x + jx;
        const z = GIFT_SPOT.z + jz;
        return <Jar key={k} kind={k} count={jarCounts[k]} scale={2.3} position={[x, groundAt(x, z) - 0.02, z]} onPick={() => world.onPick?.({ kind: "jar", jar: k })} />;
      })}
      {attached.map((d) => (
        <group key={d.memoryId} position={slotWorld(d.placement)}>
          <Decoration spec={d} scale={1.9} />
        </group>
      ))}
      <Suspense fallback={null}>
        {plan.map(({ p, avatar, walk, charms, delay }) => (
          <Friend key={`${p.id}:${arrival}`} avatar={avatar} walk={walk} delay={delay} charms={charms} onDelivered={markDelivered} animate={animate} />
        ))}
      </Suspense>
    </group>
  );
}
