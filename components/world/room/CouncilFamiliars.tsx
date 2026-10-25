"use client";

import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useConvergenceActive } from "@/components/convergence/convergenceClock";
import { CouncilMember } from "@/components/council/CouncilMember";
import { COUNCIL_LABEL, COUNCIL_TINT, poseFor } from "@/lib/council/animation";
import { COUNCIL_ACTORS, type CouncilActor, type CouncilMemberState, reduceCouncil } from "@/lib/council/contracts";
import type { RoomWorld } from "../IslandWorldProvider";
import { sparkleTexture } from "../painterly/textures";
import { GIFT_SPOT } from "../sceneConfig";
import { platformTop } from "../props/Stonework";
import s from "./gift-rings.module.css";

/**
 * The AI council on the gift map: five small familiars hovering around the
 * present. They only ever show what the council really did. Their state comes
 * from the stored task events (the same ones the tower uses): a familiar wakes,
 * glows in its role colour and says what it is doing while its task runs, says
 * what it found when the task completes, and shows the error if it fails.
 * Nothing is invented: an idle familiar just hovers, quietly. Click one for its
 * log. Display only; nothing here writes to the room.
 */

const FAILED = "#d95b4a";
/** A finished task's result stays up this long, then fades. */
const RESULT_MS = 7000;
const SCALE = 3.4;

/** A wide arc in the sky beyond the island's far edge: the map's camera sees all five clear of the island, and none covers the gift. */
function spotFor(index: number): [number, number] {
  const a = Math.PI * (0.1 + index * 0.2);
  return [GIFT_SPOT.x + Math.cos(a) * 10.5, GIFT_SPOT.z - Math.sin(a) * 5 - 3.2];
}

interface Bubble {
  text: string;
  tone: "working" | "done" | "failed";
}

/** What the familiar says right now, from its real state. Completed results are shown only when they arrive live, never replayed on a refresh. */
function useBubble(member: CouncilMemberState): Bubble | null {
  const { status, sequence, summary, actor } = member;
  const first = useRef(true);
  const lastSequence = useRef(sequence);
  const [result, setResult] = useState<{ text: string; until: number } | null>(null);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      lastSequence.current = sequence;
      return;
    }
    if (sequence === lastSequence.current) return;
    lastSequence.current = sequence;
    if (status === "completed") setResult({ text: summary ?? poseFor({ actor, status }).caption, until: Date.now() + RESULT_MS });
    else setResult(null);
  }, [status, sequence, summary, actor]);
  // The result fades after a while; this timer is only reset by a new result.
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), Math.max(0, result.until - Date.now()));
    return () => clearTimeout(timer);
  }, [result]);
  if (status === "started") return { text: poseFor({ actor, status }).caption, tone: "working" };
  if (status === "failed") return { text: summary ?? poseFor({ actor, status }).caption, tone: "failed" };
  if (status === "completed" && result) return { text: result.text, tone: "done" };
  return null;
}

function Familiar({ actor, member, index, animate, onPick }: { actor: CouncilActor; member: CouncilMemberState; index: number; animate: boolean; onPick?: (actor: CouncilActor) => void }) {
  const [x, z] = spotFor(index);
  const baseY = platformTop() + 0.6;
  const group = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Sprite>(null);
  const [hover, setHover] = useState(false);
  const bubble = useBubble(member);
  const working = member.status === "started";
  const failed = member.status === "failed";
  const tint = failed ? FAILED : COUNCIL_TINT[actor];
  const glowMat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color: tint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), [tint]);
  useEffect(() => () => glowMat.dispose(), [glowMat]);
  // Settles toward its resting height, and rises a little while it works.
  const lift = useRef(0);
  const facing = Math.atan2(GIFT_SPOT.x - x, GIFT_SPOT.z - z) * 0.35;

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 4);
    lift.current += ((working ? 0.55 : failed ? -0.1 : 0) - lift.current) * k;
    const t = clock.elapsedTime;
    g.position.y = baseY + lift.current + (animate ? Math.sin(t * 1.1 + index * 1.7) * 0.07 : 0);
    const sc = glow.current;
    if (sc) {
      const on = working || failed || hover;
      sc.visible = on;
      const pulse = working ? 1 + 0.18 * Math.sin(t * 5 + index) : 1;
      sc.scale.setScalar((working ? 3.3 : 2.4) * pulse);
      glowMat.opacity = working ? 0.75 : failed ? 0.6 : 0.35;
    }
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
    document.body.style.cursor = "pointer";
  };
  const out = () => {
    setHover(false);
    document.body.style.cursor = "";
  };
  useEffect(() => () => void (document.body.style.cursor = ""), []);

  return (
    <group ref={group} position={[x, baseY, z]}>
      <sprite ref={glow} material={glowMat} position={[0, 1.7, -0.6]} visible={false} />
      <Suspense fallback={null}>
        <CouncilMember state={member} position={[0, 0, 0]} rotationY={facing} scale={SCALE} animate={animate} />
      </Suspense>
      {/* A generous invisible target: clicking a familiar opens its log without disturbing the map under it. */}
      <mesh position={[0, 1.9, 0]} onPointerOver={over} onPointerOut={out} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPick?.(actor); }}>
        <sphereGeometry args={[2.0, 12, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html position={[0, 4.4, 0]} center zIndexRange={[38, 30]} style={{ pointerEvents: "none" }}>
        <div data-map-token className={s.familiar}>
          {(bubble || hover) && (
            <p role="status" className={`${s.councilBubble} ${bubble ? s[bubble.tone] : ""}`} style={{ ["--tint" as string]: tint }}>
              {bubble ? bubble.text : poseFor(member).caption}
            </p>
          )}
        </div>
      </Html>
      <Html position={[0, -0.35, 0]} center zIndexRange={[36, 30]} style={{ pointerEvents: "none" }}>
        <div data-map-token className={s.familiar}>
          <span className={s.familiarName} style={{ ["--tint" as string]: tint }}>{COUNCIL_LABEL[actor]}</span>
        </div>
      </Html>
    </group>
  );
}

export function CouncilFamiliars({ world, animate }: { world: RoomWorld; animate: boolean }) {
  const revealing = useConvergenceActive();
  const members = useMemo(() => reduceCouncil(world.events), [world.events]);
  if (revealing) return null;
  return (
    <group>
      {COUNCIL_ACTORS.map((actor, i) => (
        <Familiar key={actor} actor={actor} member={members[actor]} index={i} animate={animate} onPick={world.onPick ? (a) => world.onPick?.({ kind: "agent", actor: a }) : undefined} />
      ))}
    </group>
  );
}
