"use client";

import { useFrame } from "@react-three/fiber";
import { Component, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AVATAR_WORLD_SCALE, StorybookAvatar } from "@/components/characters/StorybookAvatar";
import { avatarForIndex, inJoinOrder } from "@/lib/room/avatars";
import { CouncilMember } from "@/components/council/CouncilMember";
import { Decoration } from "@/components/council/Decoration";
import { COUNCIL_ACTORS, type CouncilActor, type CouncilEvent, decorationsFrom, reduceCouncil } from "@/lib/council/contracts";
import { COUNCIL_MODELS } from "@/lib/council/animation";
import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { KitBuilder } from "../kit";
import { KitParts } from "../islands/shared";
import { playSfx } from "../sounds";
import { InkOutline } from "../painterly/InkOutline";
import { mulberry32 } from "../painterly/noise";
import { flat, paint } from "../painterly/materials";
import { plasterTexture, stoneTexture, woodTexture } from "../painterly/textures";
import type { RoomWorld } from "../IslandWorldProvider";
import { INTERIOR, INTERIOR_ORIGIN } from "./stageLayout";
import { sampleRoutine, stationFor, AGENT_ROUTINES } from "./agentRoutines";
import { TowerProps } from "./TowerProps";

/**
 * Inside the storybook tower: the AI Council's round table. The five agents
 * roam the perimeter, pause at their workstations for persisted tasks, and
 * leave the centre-front spot to the player and the friends' spirits. Each newly shared memory is a
 * folded note that floats into the jar for its kind; when the Muse finishes,
 * the charm it designed rises over the table, ready to be carried outside.
 */

const R = INTERIOR.radius;
const H = INTERIOR.height;
const TABLE_Y = INTERIOR.tableHeight;

/** Agents on the far arc of the table, each turned to face its centre. */
const SEATS: Record<CouncilActor, number> = { archivist: 1.12, muse: 1.31, scout: 1.5, keeper: 1.69, courier: 1.88 };
const seat = (turns: number, r: number) => {
  const a = turns * Math.PI;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, faceY: Math.atan2(-Math.cos(a), -Math.sin(a)) };
};

/** Which memory jar a clue's kind belongs in (matches the Muse's jar choice). */
export function jarFor(kind: string): "wish" | "interest" | "moment" {
  return kind === "explicit_wish" ? "wish" : kind === "interest" ? "interest" : "moment";
}
const JARS = {
  wish: { x: -0.55, z: 0.15, tint: "#f2d27a" },
  interest: { x: 0, z: -0.25, tint: "#a9cde6" },
  moment: { x: 0.55, z: 0.15, tint: "#f3b9c4" },
} as const;


function buildRoom(): KitBuilder {
  const kit = new KitBuilder();
  const rng = mulberry32(73);
  // Bookshelves hugging the wall on both sides of the window.
  for (const side of [-1, 1]) {
    for (let col = 0; col < 1; col++) {
      const a = -Math.PI / 2 + side * (0.62 + col * 0.34);
      const x = Math.cos(a) * (R - 0.28);
      const z = Math.sin(a) * (R - 0.28);
      const face = Math.atan2(-x, -z);
      kit.at([x, 0, z], face, 1, () => {
        kit.add("wood", new THREE.BoxGeometry(1.3, 2.6, 0.42).translate(0, 1.3, 0), "#8a5d44", undefined, 0.2);
        for (let shelf = 0; shelf < 4; shelf++) {
          const y = 0.35 + shelf * 0.6;
          kit.add("wood", new THREE.BoxGeometry(1.2, 0.05, 0.4).translate(0, y, 0.03), "#a9774f");
          let bx = -0.52;
          while (bx < 0.5) {
            const w = 0.06 + rng() * 0.07;
            const h = 0.3 + rng() * 0.2;
            const col = ["#c8664a", "#7a4a6f", "#8fae6f", "#e2bd6b", "#6f86c4", "#f6ecdc", "#a99bd6"][Math.floor(rng() * 7)]!;
            kit.add("plain", new THREE.BoxGeometry(w, h, 0.28).translate(bx + w / 2, y + 0.025 + h / 2, 0.06), col, undefined, 0.15);
            bx += w + 0.008;
          }
        }
      });
    }
  }
  // Apothecary shelves between the bookcases: rows of corked potion bottles.
  const POTIONS = ["#e0674a", "#4fa36a", "#a072d6", "#4a7fc0", "#d9a23a", "#e48fb0", "#6fd3c6"];
  const potionShelf = (a: number, rows: number) => {
    const x = Math.cos(a) * (R - 0.22);
    const z = Math.sin(a) * (R - 0.22);
    kit.at([x, 0, z], Math.atan2(-x, -z), 1, () => {
      for (let row = 0; row < rows; row++) {
        const y = 0.9 + row * 0.55;
        kit.add("wood", new THREE.BoxGeometry(1.0, 0.05, 0.3).translate(0, y, 0), "#7d5a48");
        for (const sx of [-0.46, 0.46]) kit.add("wood", new THREE.BoxGeometry(0.04, 0.12, 0.04).translate(sx, y - 0.08, 0.1), "#6f4a36");
        let bx = -0.42;
        while (bx < 0.42) {
          const r = 0.045 + rng() * 0.035;
          const h = 0.1 + rng() * 0.16;
          const liquid = POTIONS[Math.floor(rng() * POTIONS.length)]!;
          const round = rng() > 0.5;
          kit.at([bx + r, y + 0.025, (rng() - 0.5) * 0.08], 0, 1, () => {
            // Glowing liquid inside a pale glass body, a neck and a cork.
            if (round) kit.add("glow", new THREE.SphereGeometry(r, 10, 8).translate(0, r, 0), liquid);
            else kit.add("glow", new THREE.CylinderGeometry(r * 0.85, r, h * 0.7, 10).translate(0, h * 0.35, 0), liquid);
            const top = round ? r * 2 : h * 0.7;
            kit.add("plain", new THREE.CylinderGeometry(r * 0.35, r * 0.45, h * 0.35, 8).translate(0, top + h * 0.17, 0), "#e8f1f4");
            kit.add("wood", new THREE.CylinderGeometry(r * 0.32, r * 0.36, 0.035, 8).translate(0, top + h * 0.36, 0), "#a9774f");
          });
          bx += r * 2 + 0.03;
        }
      }
    });
  };
  // Either side of the window, where the table camera looks.
  for (const a of [-Math.PI / 2 - 0.38, -Math.PI / 2 + 0.38]) potionShelf(a, 3);

  // A bubbling cauldron, a globe on a stand and stacked books on the floor.
  kit.at([-3.15, 0, -1.55], 0, 1, () => {
    kit.add("plain", new THREE.SphereGeometry(0.38, 16, 12, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7).translate(0, 0.38, 0), "#3d3640");
    kit.add("glow", new THREE.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2).translate(0, 0.6, 0), "#6fd3c6");
    for (let i = 0; i < 3; i++) kit.add("plain", new THREE.CylinderGeometry(0.03, 0.04, 0.16, 6).translate(Math.cos(i * 2.1) * 0.3, 0.06, Math.sin(i * 2.1) * 0.3), "#3d3640");
  });
  kit.at([2.3, 0, -2.0], 0.4, 1, () => {
    kit.add("wood", new THREE.CylinderGeometry(0.05, 0.12, 0.8, 8).translate(0, 0.4, 0), "#7d5a48");
    kit.add("plain", new THREE.SphereGeometry(0.28, 18, 14).translate(0, 1.08, 0), "#8fbfe0");
    kit.add("plain", new THREE.TorusGeometry(0.31, 0.015, 6, 28).rotateY(Math.PI / 2).translate(0, 1.08, 0), "#d9b66f");
  });
  for (const [bx, bz, n] of [[-3.0, -0.4, 4], [2.9, -1.4, 3]] as const) {
    for (let i = 0; i < n; i++) {
      const col = ["#c8664a", "#7a4a6f", "#8fae6f", "#e2bd6b", "#6f86c4"][i % 5]!;
      kit.add("plain", new THREE.BoxGeometry(0.42 - i * 0.03, 0.08, 0.3).translate(0, 0.04 + i * 0.08, 0), col, new THREE.Matrix4().compose(new THREE.Vector3(bx, 0, bz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.35), new THREE.Vector3(1, 1, 1)), 0.1);
    }
  }
  // Candles on the bookshelf tops.
  for (const a of [-Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62, -Math.PI / 2 - 1.3, -Math.PI / 2 + 1.3]) {
    const x = Math.cos(a) * (R - 0.3);
    const z = Math.sin(a) * (R - 0.3);
    kit.add("plain", new THREE.CylinderGeometry(0.04, 0.045, 0.2, 8).translate(x, 2.7, z), "#fff4d6");
    kit.add("glow", new THREE.SphereGeometry(0.035, 8, 6).scale(1, 1.6, 1).translate(x, 2.84, z), "#ffcf7a");
  }

  // Ceiling beams radiating from the centre.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    kit.at([Math.cos(a) * R * 0.5, H - 0.25, Math.sin(a) * R * 0.5], -a, 1, () => {
      kit.add("wood", new THREE.BoxGeometry(R, 0.16, 0.16), "#6f4a36");
    });
  }
  // Bundles of drying herbs and a few hanging potion flasks under the beams.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r = R * (0.55 + (i % 2) * 0.2);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const len = 0.5 + rng() * 0.4;
    kit.add("plain", new THREE.CylinderGeometry(0.006, 0.006, len, 3).translate(x, H - 0.3 - len / 2, z), "#8a6a58");
    if (i % 3 === 0) {
      kit.add("glow", new THREE.SphereGeometry(0.07, 10, 8).translate(x, H - 0.36 - len, z), POTIONS[i % POTIONS.length]!);
    } else {
      for (let k = 0; k < 5; k++) kit.add("leaf", new THREE.ConeGeometry(0.05, 0.22, 5).rotateZ(Math.PI).translate(x + (rng() - 0.5) * 0.08, H - 0.32 - len - 0.08, z + (rng() - 0.5) * 0.08), k % 2 ? "#6f9a45" : "#8fae6f");
    }
  }

  // The council's round table, stools and a scroll.
  kit.add("wood", new THREE.CylinderGeometry(INTERIOR.tableRadius, INTERIOR.tableRadius * 1.02, 0.1, 40).translate(0, TABLE_Y, 0), "#a9774f", undefined, 0.15);
  kit.add("wood", new THREE.CylinderGeometry(0.16, 0.22, TABLE_Y - 0.05, 12).translate(0, (TABLE_Y - 0.05) / 2, 0), "#7d5a48");
  kit.add("wood", new THREE.CylinderGeometry(0.6, 0.7, 0.08, 16).translate(0, 0.04, 0), "#7d5a48");
  kit.add("plain", new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10).rotateZ(Math.PI / 2).translate(-0.15, TABLE_Y + 0.08, 0.65), "#f6ecdc");
  for (let i = 0; i < 3; i++) {
    const x = -0.9 + i * 0.25;
    kit.add("plain", new THREE.CylinderGeometry(0.03, 0.035, 0.18 + i * 0.05, 8).translate(x, TABLE_Y + 0.1 + i * 0.025, 0.55 - i * 0.05), "#fff4d6");
  }
  return kit;
}

function Room() {
  const parts = useMemo(() => buildRoom().build(), []);
  const walls = useMemo(() => {
    const map = plasterTexture().clone();
    map.repeat.set(6, 2);
    map.needsUpdate = true;
    return paint("tower-wall", { map, color: "#f1e2d2", side: THREE.BackSide });
  }, []);
  const floor = useMemo(() => {
    const map = woodTexture().clone();
    map.repeat.set(5, 5);
    map.needsUpdate = true;
    return paint("tower-floor", { map, color: "#c49470" });
  }, []);
  const stone = useMemo(() => {
    const map = stoneTexture().clone();
    map.repeat.set(10, 0.6);
    map.needsUpdate = true;
    return paint("tower-skirt", { map, color: "#e9dfd2", side: THREE.BackSide });
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={floor} receiveShadow>
        <circleGeometry args={[R, 48]} />
      </mesh>
      {/* Woven rug under the table. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <circleGeometry args={[2.1, 40]} />
        <meshToonMaterial color="#c8664a" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[1.75, 1.85, 40]} />
        <meshToonMaterial color="#e2bd6b" />
      </mesh>
      <mesh position={[0, H / 2, 0]} material={walls} receiveShadow>
        <cylinderGeometry args={[R, R, H, 48, 1, true]} />
      </mesh>
      <mesh position={[0, 0.3, 0]} material={stone}>
        <cylinderGeometry args={[R - 0.01, R - 0.01, 0.6, 48, 1, true]} />
      </mesh>
      <mesh position={[0, H + 0.9, 0]} material={paint("tower-ceiling", { map: woodTexture(), color: "#8a6450", side: THREE.BackSide })}>
        <coneGeometry args={[R, 1.8, 48, 1, true]} />
      </mesh>
      {/* Arched window on the far wall, glowing with the sky outside. */}
      <group position={[0, 1.55, -R + 0.05]}>
        <mesh material={flat("tower-window", "#cfe3f2")}>
          <shapeGeometry args={[(() => { const s = new THREE.Shape(); s.moveTo(-0.55, 0); s.lineTo(0.55, 0); s.lineTo(0.55, 1.1); s.absarc(0, 1.1, 0.55, 0, Math.PI, false); s.closePath(); return s; })()]} />
        </mesh>
        <mesh position={[0, 0.85, 0.02]} material={paint("window-frame", { color: "#5a4258" })}>
          <boxGeometry args={[0.05, 1.7, 0.04]} />
        </mesh>
        <mesh position={[0, 0.75, 0.02]} material={paint("window-frame", { color: "#5a4258" })}>
          <boxGeometry args={[1.1, 0.05, 0.04]} />
        </mesh>
      </group>
      <KitParts parts={parts} outline="fine" shadows />
    </group>
  );
}

function HangingLantern({ x, z, phase }: { x: number; z: number; phase: number }) {
  const light = useRef<THREE.PointLight>(null);
  const glow = useMemo(() => new THREE.MeshToonMaterial({ color: "#ffe2a0", emissive: "#ffb24a", emissiveIntensity: 1.3 }), []);
  useFrame(({ clock }) => {
    const f = 1 + Math.sin(clock.elapsedTime * 6.1 + phase) * 0.05 + Math.sin(clock.elapsedTime * 11.3 + phase) * 0.03;
    glow.emissiveIntensity = 1.3 * f;
    if (light.current) light.current.intensity = 7 * f;
  });
  return (
    <group position={[x, H - 1.0, z]}>
      <mesh position={[0, 0.5, 0]} material={paint("iron", { color: "#4b3d4c" })}>
        <cylinderGeometry args={[0.01, 0.01, 1, 4]} />
      </mesh>
      <mesh material={glow}>
        <boxGeometry args={[0.2, 0.28, 0.2]} />
        <InkOutline weight="fine" color="#3d2c35" />
      </mesh>
      <pointLight ref={light} color="#ffc078" intensity={7} distance={7} decay={1.6} castShadow={false} />
    </group>
  );
}

/** Folded notes stacked inside a jar: one per real memory, so the fill is the count. */
function JarNotes({ count, tint }: { count: number; tint: string }) {
  const notes = useMemo(() => {
    const rng = mulberry32(count * 13 + 7);
    return Array.from({ length: Math.min(count, 9) }, (_, i) => ({ y: 0.06 + i * 0.03, ry: rng() * 6, rz: (rng() - 0.5) * 0.4, x: (rng() - 0.5) * 0.08, z: (rng() - 0.5) * 0.08 }));
  }, [count]);
  return (
    <>
      {notes.map((n, i) => (
        <mesh key={i} position={[n.x, n.y, n.z]} rotation={[0, n.ry, n.rz]} material={paint(i % 3 ? "note-paper" : `note-${tint}`, { color: i % 3 ? "#fbf3e3" : tint })}>
          <boxGeometry args={[0.13, 0.018, 0.09]} />
        </mesh>
      ))}
    </>
  );
}

export function Jar({ kind, count, onPick, scale = 1, position }: { kind: keyof typeof JARS; count: number; onPick?: () => void; scale?: number; position?: [number, number, number] }) {
  const j = JARS[kind];
  const [hover, setHover] = useState(false);
  useEffect(() => () => void (document.body.style.cursor = ""), []);
  return (
    <group
      position={position ?? [j.x, TABLE_Y + 0.05, j.z]}
      scale={scale * (hover ? 1.08 : 1)}
      onClick={(e) => {
        e.stopPropagation();
        playSfx(kind === "wish" ? "wish" : "tap");
        onPick?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
    >
      <JarNotes count={count} tint={j.tint} />
      <mesh position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.14, 0.13, 0.34, 18, 1, true]} />
        <meshToonMaterial color={j.tint} transparent opacity={hover ? 0.55 : 0.4} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.36, 0]} material={paint("jar-cork", { color: "#a9774f" })}>
        <cylinderGeometry args={[0.09, 0.1, 0.05, 12]} />
      </mesh>
      <mesh position={[0, 0.03, 0]} material={paint(`jar-glow-${kind}`, { color: j.tint })}>
        <cylinderGeometry args={[0.13, 0.13, 0.04, 14]} />
      </mesh>
    </group>
  );
}

/** The Scout lays real results on the table as small paper cards, one per approved gift (from its completed event). */
function ScoutCards({ count, onPick }: { count: number; onPick?: () => void }) {
  const s = seat(SEATS.scout, INTERIOR.tableRadius - 0.45);
  const [hover, setHover] = useState(false);
  if (count <= 0) return null;
  return (
    <group
      position={[s.x, TABLE_Y + 0.06, s.z]}
      rotation={[0, s.faceY + Math.PI, 0]}
      onClick={(e) => {
        e.stopPropagation();
        playSfx("tap");
        onPick?.();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "";
      }}
    >
      {Array.from({ length: Math.min(count, 5) }, (_, i) => (
        <group key={i} position={[(i - (Math.min(count, 5) - 1) / 2) * 0.17, i * 0.004 + (hover ? 0.03 : 0), Math.abs(i - 2) * 0.03]} rotation={[-Math.PI / 2, 0, (i - 2) * 0.16]}>
          <mesh material={paint("gift-card", { color: "#fbf3e3" })}>
            <planeGeometry args={[0.15, 0.2]} />
          </mesh>
          <mesh position={[0, 0.03, 0.001]} material={paint(`gift-card-photo-${i % 3}`, { color: ["#e0a24a", "#a9cde6", "#e48fb0"][i % 3] })}>
            <planeGeometry args={[0.11, 0.08]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A folded note that drifts from its friend's place into the right jar, then settles. */
function MemoryNote({ from, jar, onDone }: { from: THREE.Vector3; jar: keyof typeof JARS; onDone: () => void }) {
  const ref = useRef<THREE.Group>(null);
  const t = useRef(0);
  const done = useRef(false);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    t.current += Math.min(dt, 0.05);
    const k = THREE.MathUtils.smoothstep(t.current, 0, 1.6);
    const j = JARS[jar];
    const to = new THREE.Vector3(j.x, TABLE_Y + 0.2, j.z);
    g.position.copy(from).lerp(to, k);
    g.position.y += Math.sin(k * Math.PI) * 0.7;
    g.rotation.set(0.3 * (1 - k), t.current * 3 * (1 - k), 0.2);
    g.scale.setScalar(1 - THREE.MathUtils.smoothstep(t.current, 1.4, 1.8) * 0.9);
    if (t.current > 1.9 && !done.current) {
      done.current = true;
      onDone();
    }
  });
  return (
    <group ref={ref} position={from}>
      <mesh material={paint("note-paper", { color: "#fbf3e3" })} castShadow>
        <boxGeometry args={[0.16, 0.02, 0.11]} />
        <InkOutline weight="fine" color="#8a6a62" opacity={0.6} />
      </mesh>
    </group>
  );
}

function Agent({ actor, events, animate, onStatus, onPick }: { actor: CouncilActor; events: CouncilEvent[]; animate: boolean; onStatus: (actor: CouncilActor, s: "ready" | "failed") => void; onPick?: () => void }) {
  const state = useMemo(() => reduceCouncil(events)[actor], [events, actor]);
  const ready = useCallback(() => onStatus(actor, "ready"), [actor, onStatus]);
  const root = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const initial = useMemo(() => sampleRoutine(actor, 0), [actor]);
  const [activity, setActivity] = useState<import("@/lib/council/animation").CouncilClip>(initial.clip);
  const activityRef = useRef<string | undefined>(initial.clip);
  const [reacting, setReacting] = useState(false);
  const reactionRemaining = useRef(0);
  const previousSequence = useRef(state.sequence);
  useEffect(() => {
    if (state.sequence !== previousSequence.current && state.status === "completed") {
      reactionRemaining.current = 3;
      setReacting(true);
    }
    previousSequence.current = state.sequence;
  }, [state.sequence, state.status]);
  useFrame((_, dt) => {
    const g = root.current;
    if (!g || !animate) return;
    const delta = Math.min(dt, 0.05);
    const inReaction = reactionRemaining.current > 0;
    reactionRemaining.current = Math.max(0, reactionRemaining.current - delta);
    // Pause the background routine while a real task is in progress, so it resumes naturally.
    if (state.status !== "started" && !inReaction) elapsed.current += delta;

    if (!inReaction && reacting) setReacting(false);
    const plan = sampleRoutine(actor, elapsed.current);
    const station = state.status === "started" ? stationFor(actor) : null;
    const target = inReaction ? { x: g.position.x, z: g.position.z } : station ?? plan;
    // Polar movement stays in a clear aisle even when a real task interrupts a patrol.
    const angle = Math.atan2(g.position.z, g.position.x);
    const want = Math.atan2(target.z, target.x);
    const turn = Math.atan2(Math.sin(want - angle), Math.cos(want - angle));
    const radius = Math.hypot(g.position.x, g.position.z);
    const wantRadius = Math.hypot(target.x, target.z);
    const speed = AGENT_ROUTINES[actor].speed;
    const nextAngle = angle + THREE.MathUtils.clamp(turn, -speed * delta / radius, speed * delta / radius);
    const nextRadius = radius + THREE.MathUtils.clamp(wantRadius - radius, -speed * delta, speed * delta);
    const oldX = g.position.x, oldZ = g.position.z;
    g.position.set(Math.cos(nextAngle) * nextRadius, 0, Math.sin(nextAngle) * nextRadius);
    const moving = Math.hypot(g.position.x - oldX, g.position.z - oldZ) > 0.0001;
    const look = station?.lookAt ?? plan.lookAt;
    const face = moving ? Math.atan2(g.position.x - oldX, g.position.z - oldZ) : Math.atan2(look[0] - g.position.x, look[1] - g.position.z);
    g.rotation.y += Math.atan2(Math.sin(face - g.rotation.y), Math.cos(face - g.rotation.y)) * (1 - Math.exp(-delta * 5));
    const nextActivity = moving ? "walk" : plan.clip;
    if (activityRef.current !== nextActivity) { activityRef.current = nextActivity; setActivity(nextActivity); }
    g.userData.moving = moving;
  });
  return (
    <group ref={root} position={[initial.x, 0, initial.z]} userData={{ councilActor: actor, roaming: true }}
      onClick={(e) => { e.stopPropagation(); playSfx("tap"); onPick?.(); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <CouncilMember state={state} position={[0, 0, 0]} scale={0.6} animate={animate} onReady={ready}
        clipOverride={reacting || (state.status === "started" && activity !== "walk") || state.status === "failed" ? undefined : activity} />
    </group>
  );
}

/** A model that fails to load reports it (the page offers a retry) instead of showing a stand-in robot. */
class ModelBoundary extends Component<{ actor: CouncilActor; onStatus: (actor: CouncilActor, s: "ready" | "failed") => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    useGLTF.clear(COUNCIL_MODELS[this.props.actor]);
    this.props.onStatus(this.props.actor, "failed");
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function TowerInterior({ world, animate, onAssetStatus }: {
  world: RoomWorld;
  animate: boolean;
  onAssetStatus: (actor: CouncilActor, s: "ready" | "failed") => void;
}) {
  // The viewer owns the centre-front spot. Friends join on either side; agents use the perimeter.
  const friends = useMemo(() => {
    const ordered = inJoinOrder(world.participants);
    const viewer = ordered.find(p => p.id === world.viewerId) ?? ordered[0];
    const front = viewer ? [viewer, ...ordered.filter(p => p.id !== viewer.id)] : ordered;
    return front.map((p, i) => {
      const side = i % 2 === 1 ? -1 : 1;
      const x = i === 0 ? 0 : side * (0.75 + Math.floor((i - 1) / 2) * 0.65);
      const z = i === 0 ? 2.1 : 2.25 + Math.floor((i - 1) / 2) * 0.25;
      return { ...p, avatar: avatarForIndex(ordered.findIndex(o => o.id === p.id)), x, z, faceY: Math.atan2(-x, -z) };
    });
  }, [world.participants, world.viewerId]);

  // Notes fly only for memories shared during this visit, never on refresh.
  const known = useRef<Set<string> | null>(null);
  const [notes, setNotes] = useState<{ id: string; from: THREE.Vector3; jar: keyof typeof JARS; by?: string }[]>([]);
  const [cheering, setCheering] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (known.current === null) {
      known.current = new Set(world.clues.map((c) => c.id));
      return;
    }
    const fresh = world.clues.filter((c) => !known.current!.has(c.id));
    if (!fresh.length) return;
    for (const c of fresh) known.current.add(c.id);
    setNotes((n) => [
      ...n,
      ...fresh.map((c) => {
        const f = friends.find((p) => p.id === c.publisherId) ?? friends[0];
        return { id: c.id, from: new THREE.Vector3(f?.x ?? 0, 1.1, f?.z ?? 1.5), jar: jarFor(c.kind), by: f?.id };
      }),
    ]);
  }, [world.clues, friends]);

  // Jar fill = real active memories of that kind (persisted, so a refresh shows the same fill).
  const jarCounts = useMemo(() => {
    const c = { wish: 0, interest: 0, moment: 0 };
    for (const clue of world.clues) c[jarFor(clue.kind)]++;
    return c;
  }, [world.clues]);
  // Scout's cards only from its real completed event.
  const scoutCount = useMemo(() => {
    const m = reduceCouncil(world.events).scout;
    if (m.status !== "completed") return 0;
    const done = [...world.events].reverse().find((e) => e.actor === "keeper" && e.status === "completed") ?? [...world.events].reverse().find((e) => e.actor === "scout" && e.status === "completed");
    return Math.max(1, done?.result?.count ?? 1);
  }, [world.events]);

  // The newest charm hovers over the table until the friends carry it out.
  const charm = useMemo(() => decorationsFrom(world.events).at(-1) ?? null, [world.events]);
  const charmRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (charmRef.current) {
      charmRef.current.position.y = TABLE_Y + 0.75 + Math.sin(clock.elapsedTime * 1.6) * 0.05;
      charmRef.current.rotation.y = clock.elapsedTime * 0.6;
    }
  });

  return (
    <group position={INTERIOR_ORIGIN}>
      <ambientLight intensity={0.35} color="#ffe6c8" />
      {/* A small, locally generated reflection map gives the ceramic robots soft window light.
          One capture only; no external HDRI, background change or ongoing postprocessing. */}
      <Environment resolution={128} frames={1} environmentIntensity={0.8}>
        <Lightformer form="rect" color="#fff0d8" intensity={2} position={[-3, 4, 3]} target={[0, 0, 0]} scale={[5, 5, 1]} />
        <Lightformer form="rect" color="#d7eaff" intensity={1.5} position={[3, 2, -2]} target={[0, 0, 0]} scale={[4, 4, 1]} />
        <Lightformer form="rect" color="#f7e9d0" intensity={0.7} position={[0, 5, 0]} target={[0, 0, 0]} scale={[6, 6, 1]} />
      </Environment>
      <HangingLantern x={-1.2} z={0.3} phase={0} />
      <HangingLantern x={1.3} z={-0.6} phase={2} />
      <Room />
      <TowerProps keeperAngle={SEATS.keeper * Math.PI} />
      {(Object.keys(JARS) as (keyof typeof JARS)[]).map((k) => (
        <Jar key={k} kind={k} count={jarCounts[k]} onPick={() => world.onPick?.({ kind: "jar", jar: k })} />
      ))}
      <ScoutCards count={scoutCount} onPick={() => world.onPick?.({ kind: "scout" })} />
      {COUNCIL_ACTORS.map((actor) => (
        <ModelBoundary key={actor} actor={actor} onStatus={onAssetStatus}>
          <Suspense fallback={null}>
            <Agent actor={actor} events={world.events} animate={animate} onStatus={onAssetStatus} onPick={() => world.onPick?.({ kind: "agent", actor })} />
          </Suspense>
        </ModelBoundary>
      ))}
      <Suspense fallback={null}>
        {friends.map((f) => (
          <group key={f.id} position={[f.x, 0, f.z]} rotation={[0, f.faceY, 0]} userData={{ participantId: f.id, playerFront: f.id === (world.viewerId ?? friends[0]?.id) }}>
            <StorybookAvatar
              avatar={f.avatar}
              clip={cheering.has(f.id) ? "Celebrate" : "Idle"}
              onClipFinished={() => setCheering((s) => { const next = new Set(s); next.delete(f.id); return next; })}
              scale={AVATAR_WORLD_SCALE * 0.95}
            />
          </group>
        ))}
      </Suspense>
      {notes.map((n) => (
        <MemoryNote
          key={n.id}
          from={n.from}
          jar={n.jar}
          onDone={() => {
            setNotes((all) => all.filter((x) => x.id !== n.id));
            if (n.by) setCheering((s) => new Set(s).add(n.by!));
          }}
        />
      ))}
      {charm && (
        <group ref={charmRef} position={[0, TABLE_Y + 0.75, 0]}>
          <Decoration spec={charm} scale={2.4} />
        </group>
      )}
    </group>
  );
}

for (const a of COUNCIL_ACTORS) useGLTF.preload(COUNCIL_MODELS[a]);
