"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { StorybookAvatar, AVATAR_WORLD_SCALE, type AvatarClip } from "@/components/characters/StorybookAvatar";
import { InkOutline } from "@/components/world/painterly/InkOutline";
import { paint } from "@/components/world/painterly/materials";
import { giftPaperTexture, stoneTexture } from "@/components/world/painterly/textures";
import { COUNCIL_ACTORS, type CouncilActor, type CouncilMemberState, type DecorationSpec } from "@/lib/council/contracts";
import { CouncilSpirit } from "./CouncilSpirit";
import { Decoration } from "./Decoration";

/**
 * The AI Council stage: five members in an arc around the gift box, the
 * Garden of Memories' three jars, and the friend's spirit who carries each new
 * charm to the box. Everything here is derived from props (persisted
 * decorations + per-member state); it never fetches anything itself.
 */

const BOX = { w: 1.2, h: 0.95 } as const;
const BOX_POS = new THREE.Vector3(0, 0, 0);

/** Stable attachment points on the box, one per library placement slot. */
export const SLOTS: Record<string, [number, number, number]> = {
  front_ribbon: [0, BOX.h * 0.55, BOX.w / 2 + 0.06],
  top_knot: [0.22, BOX.h + 0.1, 0.1],
  lid_left: [-0.38, BOX.h + 0.07, 0.25],
  lid_right: [0.38, BOX.h + 0.07, -0.2],
  side_left: [-BOX.w / 2 - 0.06, BOX.h * 0.5, 0.25],
  side_right: [BOX.w / 2 + 0.06, BOX.h * 0.5, -0.25],
  front_corner: [0.42, BOX.h * 0.25, BOX.w / 2 + 0.06],
  back_ribbon: [0, BOX.h * 0.6, -BOX.w / 2 - 0.06],
};

const JARS: Record<string, { pos: [number, number, number]; tint: string; label: string }> = {
  wish: { pos: [-2.4, 0, 1.1], tint: "#f2d27a", label: "Wishes" },
  interest: { pos: [-2.9, 0, 0.2], tint: "#a9cde6", label: "Loves" },
  moment: { pos: [-2.4, 0, -0.7], tint: "#f3b9c4", label: "Moments" },
};

const MEMBER_POS: Record<CouncilActor, { p: [number, number, number]; r: number }> = {
  archivist: { p: [-1.7, 0, -1.6], r: 0.55 },
  muse: { p: [-0.85, 0, -2.25], r: 0.25 },
  scout: { p: [0.2, 0, -2.45], r: 0 },
  keeper: { p: [1.25, 0, -2.2], r: -0.3 },
  courier: { p: [2.05, 0, -1.45], r: -0.6 },
};

const SPIRIT_HOME = new THREE.Vector3(-1.6, 0, 1.6);

function GiftBox() {
  const paper = useMemo(() => {
    const map = giftPaperTexture().clone();
    map.repeat.set(0.6, 0.6);
    map.needsUpdate = true;
    return paint("council-gift-paper", { map, color: "#fff7ea" });
  }, []);
  const ribbon = paint("council-ribbon", { color: "#e07a62" });
  return (
    <group position={BOX_POS}>
      <mesh position={[0, BOX.h / 2, 0]} material={paper} castShadow receiveShadow>
        <boxGeometry args={[BOX.w, BOX.h, BOX.w]} />
        <InkOutline weight="medium" color="#4a2c33" />
      </mesh>
      <mesh position={[0, BOX.h / 2, 0]} material={ribbon}>
        <boxGeometry args={[0.18, BOX.h + 0.02, BOX.w + 0.02]} />
      </mesh>
      <mesh position={[0, BOX.h / 2, 0]} material={ribbon}>
        <boxGeometry args={[BOX.w + 0.02, BOX.h + 0.02, 0.18]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.15, BOX.h + 0.08, 0]} rotation={[0, 0, s * 0.5]} scale={[1.4, 0.7, 0.6]} material={ribbon} castShadow>
          <torusGeometry args={[0.1, 0.035, 8, 16]} />
        </mesh>
      ))}
    </group>
  );
}

function Jar({ kind }: { kind: keyof typeof JARS }) {
  const j = JARS[kind]!;
  return (
    <group position={j.pos}>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.26, 0.24, 0.64, 20, 1, true]} />
        <meshToonMaterial color={j.tint} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.66, 0]} material={paint("jar-cork", { color: "#a9774f" })}>
        <cylinderGeometry args={[0.16, 0.18, 0.08, 14]} />
      </mesh>
      <mesh position={[0, 0.04, 0]} material={paint(`jar-glow-${kind}`, { color: j.tint })}>
        <cylinderGeometry args={[0.235, 0.235, 0.06, 18]} />
      </mesh>
    </group>
  );
}

/** A folded paper note: hovers over the jars while the Archivist reads, then drops into the jar the Muse chose. */
function MemoryNote({ jar, settled }: { jar: string | null; settled: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const start = useMemo(() => new THREE.Vector3().copy(SPIRIT_HOME).setY(1.1), []);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    const target = jar && JARS[jar] ? new THREE.Vector3(...JARS[jar]!.pos).setY(settled ? 0.25 : 1.05) : new THREE.Vector3(-2.6, 1.25 + Math.sin(clock.elapsedTime * 2) * 0.08, 0.2);
    g.position.lerp(target, 1 - Math.exp(-Math.min(dt, 0.1) * 3));
    g.rotation.y += dt * (settled ? 0.2 : 1.5);
  });
  return (
    <group ref={ref} position={start}>
      <mesh rotation={[0.3, 0, 0.2]} material={paint("note-paper", { color: "#fbf3e3" })} castShadow>
        <boxGeometry args={[0.16, 0.02, 0.11]} />
        <InkOutline weight="fine" color="#8a6a62" opacity={0.6} />
      </mesh>
    </group>
  );
}

interface Delivery {
  spec: DecorationSpec;
  startedAt: number;
}

/**
 * Plays one delivery at a time: the charm appears over its jar, the spirit
 * walks it to the box, and it settles into its slot. Charms that were
 * already persisted before this page loaded skip straight to their slot.
 */
function Garden({ decorations, freshIds }: { decorations: DecorationSpec[]; freshIds: Set<string> }) {
  const [queue, setQueue] = useState<Delivery[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const spirit = useRef<THREE.Group>(null);
  const carried = useRef<THREE.Group>(null);
  const [clip, setClip] = useState<AvatarClip>("Idle");
  // Frames can outrun re-renders; finish each delivery exactly once.
  const finished = useRef<string | null>(null);

  useEffect(() => {
    const pending = decorations.filter((d) => freshIds.has(d.memoryId) && !done.has(d.memoryId) && !queue.some((q) => q.spec.memoryId === d.memoryId));
    if (pending.length) setQueue((q) => [...q, ...pending.map((spec) => ({ spec, startedAt: -1 }))]);
  }, [decorations, freshIds, done, queue]);

  const active = queue[0];
  useFrame(({ clock }) => {
    const s = spirit.current;
    const c = carried.current;
    if (!s) return;
    const now = clock.elapsedTime;
    if (!active) {
      s.position.lerp(SPIRIT_HOME, 0.05);
      return;
    }
    if (active.startedAt < 0) active.startedAt = now;
    const t = now - active.startedAt;
    const jar = new THREE.Vector3(...(JARS[active.spec.jar]?.pos ?? JARS.moment!.pos));
    const slot = new THREE.Vector3(...(SLOTS[active.spec.placement] ?? SLOTS.front_ribbon!));
    const beside = new THREE.Vector3(slot.x * 1.2, 0, slot.z + 0.9).clampLength(1.1, 2);
    // 0–1 s: rise from the jar · 1–3.5 s: walk to the box · 3.5–4.3 s: attach.
    const walk = THREE.MathUtils.smoothstep(t, 1, 3.5);
    const fromJar = jar.clone().add(new THREE.Vector3(0.5, 0, 0.3));
    s.position.copy(fromJar).lerp(beside, walk);
    const dir = beside.clone().sub(fromJar);
    s.rotation.y = walk < 1 ? Math.atan2(dir.x, dir.z) : Math.atan2(slot.x - s.position.x, slot.z - s.position.z);
    const wantClip: AvatarClip = t > 1 && t < 3.5 ? "Walk" : t >= 3.5 && t < 4.6 ? "Celebrate" : "Idle";
    if (wantClip !== clip) setClip(wantClip);
    if (c) {
      const overJar = jar.clone().setY(0.95 + THREE.MathUtils.smoothstep(t, 0, 1) * 0.25);
      const overHead = s.position.clone().setY(1.35);
      const attach = THREE.MathUtils.smoothstep(t, 3.5, 4.3);
      c.position.copy(t < 1 ? overJar : overHead).lerp(slot, attach);
      c.scale.setScalar(THREE.MathUtils.smoothstep(t, 0, 0.5));
      c.rotation.y = (1 - attach) * now * 2;
    }
    if (t > 4.6 && finished.current !== active.spec.memoryId) {
      finished.current = active.spec.memoryId;
      const id = active.spec.memoryId;
      setDone((d) => new Set(d).add(id));
      setQueue((q) => q.filter((x) => x.spec.memoryId !== id));
    }
  });

  return (
    <>
      {decorations
        .filter((d) => !freshIds.has(d.memoryId) || done.has(d.memoryId))
        .map((d) => (
          <group key={d.memoryId} position={SLOTS[d.placement] ?? SLOTS.front_ribbon}>
            <Decoration spec={d} scale={1.8} />
          </group>
        ))}
      {active && (
        <group ref={carried} scale={0.001}>
          <Decoration spec={active.spec} scale={2.2} />
        </group>
      )}
      <group ref={spirit} position={SPIRIT_HOME}>
        <StorybookAvatar avatar="kind" clip={clip} scale={AVATAR_WORLD_SCALE * 0.8} />
      </group>
    </>
  );
}

export interface CouncilSceneProps {
  members: Record<CouncilActor, CouncilMemberState>;
  decorations: DecorationSpec[];
  /** Memory ids whose charms arrived during this visit (animate them); others render in place. */
  freshIds: Set<string>;
  /** The memory currently being worked on, if any, and the jar the Muse picked for it. */
  note: { jar: string | null; settled: boolean } | null;
}

export default function CouncilScene({ members, decorations, freshIds, note }: CouncilSceneProps) {
  const ground = useMemo(() => {
    const map = stoneTexture().clone();
    map.repeat.set(3, 3);
    map.needsUpdate = true;
    return paint("council-ground", { map, color: "#efe6da" });
  }, []);
  return (
    <Canvas shadows="percentage" flat dpr={[1, 1.75]} camera={{ position: [-0.5, 3.7, 6.6], fov: 40 }} onCreated={({ camera, gl }) => { camera.lookAt(-0.55, 0.55, -0.45); gl.setClearColor("#d9e6f2"); }}>
      <fog attach="fog" args={["#d9e6f2", 12, 30]} />
      <hemisphereLight args={["#e4eeff", "#9d8cc0", 1.0]} />
      <directionalLight position={[4, 7, 3]} intensity={2.6} color="#ffe1ad" castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={ground}>
        <circleGeometry args={[4.6, 64]} />
      </mesh>
      <Suspense fallback={null}>
        <GiftBox />
        {(Object.keys(JARS) as (keyof typeof JARS)[]).map((k) => (
          <Jar key={k} kind={k} />
        ))}
        {COUNCIL_ACTORS.map((a) => (
          <CouncilSpirit key={a} state={members[a]} position={MEMBER_POS[a].p} rotationY={MEMBER_POS[a].r} scale={AVATAR_WORLD_SCALE} />
        ))}
        <Garden decorations={decorations} freshIds={freshIds} />
        {note && <MemoryNote jar={note.jar} settled={note.settled} />}
      </Suspense>
    </Canvas>
  );
}
