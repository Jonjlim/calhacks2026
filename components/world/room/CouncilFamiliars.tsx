"use client";

import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useConvergenceActive } from "@/components/convergence/convergenceClock";
import { CouncilMember } from "@/components/council/CouncilMember";
import { COUNCIL_LABEL, COUNCIL_TINT, poseFor } from "@/lib/council/animation";
import { COUNCIL_ACTORS, type CouncilActor, type CouncilMemberState, reduceCouncil } from "@/lib/council/contracts";
import type { RoomWorld } from "../IslandWorldProvider";
import { paint } from "../painterly/materials";
import { sparkleTexture } from "../painterly/textures";
import { platformTop } from "../props/Stonework";
import { GIFT_SPOT } from "../sceneConfig";
import s from "./gift-rings.module.css";

/**
 * The AI council on the gift map: five small familiars forming a Council Ring
 * above the present, each resting on a little cloud. They only ever show what
 * the council really did. State comes from the stored task events (the same
 * ones the tower uses): a familiar wakes, glows in its role colour and says what
 * it is doing while its task runs, says what it found when the task completes,
 * and shows the error if it fails. Only one of them speaks at a time (the most
 * recent); the rest show a small status dot. An idle familiar just hovers.
 * Click one for its log. Display only; nothing here writes to the room.
 */

const FAILED = "#d95b4a";
/** A finished task's result stays up this long, then fades. */
const RESULT_MS = 7000;
const SCALE = 2.3;
/** Height of the ring's centre above the platform, and its half-width. */
const RING_HEIGHT = 9.8;
const RING_RADIUS = 9.2;

interface Bubble {
  text: string;
  tone: "working" | "done" | "failed";
  /** When the underlying task last changed (live); 0 for a state restored on load. */
  at: number;
}

/** What each familiar says right now, from its real state. Completed results are shown only when they arrive live, never replayed on a refresh. */
function useCouncilBubbles(members: Record<CouncilActor, CouncilMemberState>): Record<CouncilActor, Bubble | null> {
  const seen = useRef<Record<string, number>>({});
  const first = useRef(true);
  const [results, setResults] = useState<Partial<Record<CouncilActor, { text: string; at: number; until: number }>>>({});
  const [changed, setChanged] = useState<Partial<Record<CouncilActor, number>>>({});
  const key = COUNCIL_ACTORS.map((a) => `${a}:${members[a].sequence}:${members[a].status}`).join("|");
  useEffect(() => {
    const now = Date.now();
    if (first.current) {
      first.current = false;
      for (const a of COUNCIL_ACTORS) seen.current[a] = members[a].sequence;
      return;
    }
    for (const a of COUNCIL_ACTORS) {
      const m = members[a];
      if (m.sequence === seen.current[a]) continue;
      seen.current[a] = m.sequence;
      setChanged((c) => ({ ...c, [a]: now }));
      if (m.status === "completed") setResults((r) => ({ ...r, [a]: { text: m.summary ?? poseFor(m).caption, at: now, until: now + RESULT_MS } }));
      else setResults((r) => ({ ...r, [a]: undefined }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Results fade after a while.
  useEffect(() => {
    const live = Object.values(results).filter((r): r is { text: string; at: number; until: number } => !!r);
    if (!live.length) return;
    const next = Math.min(...live.map((r) => r.until));
    const timer = setTimeout(() => setResults((r) => Object.fromEntries(Object.entries(r).map(([a, v]) => [a, v && v.until > Date.now() ? v : undefined]))), Math.max(0, next - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [results]);
  const out = {} as Record<CouncilActor, Bubble | null>;
  for (const a of COUNCIL_ACTORS) {
    const m = members[a];
    const at = changed[a] ?? 0;
    out[a] = m.status === "started" ? { text: poseFor(m).caption, tone: "working", at }
      : m.status === "failed" ? { text: m.summary ?? poseFor(m).caption, tone: "failed", at }
      : m.status === "completed" && results[a] ? { text: results[a]!.text, tone: "done", at: results[a]!.at }
      : null;
  }
  return out;
}

const _right = new THREE.Vector3();
const _away = new THREE.Vector3();

/** A small painted cloud for a familiar to rest on. */
function CloudSeat() {
  const mat = useMemo(() => paint("council-cloud", { color: "#fffaf0", emissive: "#f3ecff", emissiveIntensity: 0.35 }), []);
  const puffs: [number, number, number, number][] = [[0, 0, 0, 1.1], [0.85, -0.08, 0.1, 0.75], [-0.85, -0.05, -0.05, 0.8], [0.3, -0.05, 0.55, 0.7], [-0.35, -0.02, 0.5, 0.65]];
  return (
    <group>
      {puffs.map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} scale={[r, r * 0.55, r]} material={mat}>
          <sphereGeometry args={[1, 12, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function Familiar({ actor, member, index, bubble, speaking, animate, onPick }: { actor: CouncilActor; member: CouncilMemberState; index: number; bubble: Bubble | null; speaking: boolean; animate: boolean; onPick?: (actor: CouncilActor) => void }) {
  const camera = useThree((st) => st.camera);
  const group = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Sprite>(null);
  const [hover, setHover] = useState(false);
  const working = member.status === "started";
  const failed = member.status === "failed";
  const tint = failed ? FAILED : COUNCIL_TINT[actor];
  const glowMat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color: tint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), [tint]);
  useEffect(() => () => glowMat.dispose(), [glowMat]);
  const base = useMemo(() => new THREE.Vector3(GIFT_SPOT.x, platformTop() + RING_HEIGHT, GIFT_SPOT.z), []);
  const state = useRef({ forward: 0, lift: 0, react: -10, lastAt: bubble?.at ?? 0 });

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const st = state.current;
    const t = clock.elapsedTime;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 4);
    // The ring is camera-relative: a gentle arch across the screen, above the present, so it reads from every angle and never reaches the islands below.
    _right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    _away.setFromMatrixColumn(camera.matrixWorld, 2).setY(0).normalize().negate(); // horizontal, from the camera into the scene
    const u = (index - 2) / 2;
    // From a low angle the ring sits closer to the present, so the familiars stay in frame; from above it rises clear of the island.
    const groundY = base.y - RING_HEIGHT;
    const camEl = Math.asin(THREE.MathUtils.clamp((camera.position.y - groundY) / Math.max(1, camera.position.distanceTo(base)), 0, 1));
    const height = 5.2 + (RING_HEIGHT - 5.2) * THREE.MathUtils.smoothstep(camEl, 0.15, 0.9);
    const forwardTarget = speaking ? 1.6 : 0;
    st.forward += (forwardTarget - st.forward) * k;
    st.lift += ((working ? 0.5 : failed ? -0.15 : 0) - st.lift) * k;
    // A live result makes its familiar hop once.
    if (bubble && bubble.at > st.lastAt) {
      st.lastAt = bubble.at;
      st.react = t;
    }
    const hop = Math.max(0, Math.sin((t - st.react) * 7)) * Math.exp(-(t - st.react) * 2.2) * (t - st.react < 1.4 ? 1 : 0);
    g.position.copy(base)
      .addScaledVector(_right, u * RING_RADIUS)
      .addScaledVector(_away, -u * u * 2.6 - st.forward)
      .setY(groundY + height + (1 - u * u) * 2.2 + st.lift + hop * 0.7 + (animate ? Math.sin(t * 1.1 + index * 1.7) * 0.12 : 0));
    g.rotation.y = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
    const sc = glow.current;
    if (sc) {
      sc.visible = working || failed || hover || hop > 0.02;
      const pulse = working ? 1 + 0.18 * Math.sin(t * 5 + index) : 1;
      sc.scale.setScalar((working ? 3.6 : 2.6) * pulse);
      glowMat.opacity = working ? 0.75 : failed ? 0.6 : hover ? 0.35 : 0.5;
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
  const dot = bubble && !speaking;

  return (
    <group ref={group}>
      <sprite ref={glow} material={glowMat} position={[0, 1.6, -0.6]} visible={false} />
      <group position={[0, -0.55, 0]}><CloudSeat /></group>
      <Suspense fallback={null}>
        <CouncilMember state={member} position={[0, 0, 0]} scale={SCALE} animate={animate} />
      </Suspense>
      {/* A generous invisible target: clicking a familiar opens its log without disturbing the map under it. */}
      <mesh position={[0, 1.8, 0]} onPointerOver={over} onPointerOut={out} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPick?.(actor); }}>
        <sphereGeometry args={[2.0, 12, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html position={[0, 4.3, 0]} center zIndexRange={[38, 30]} style={{ pointerEvents: "none" }}>
        <div data-map-token className={s.familiar}>
          {((speaking && bubble) || hover) && (
            <p role="status" className={`${s.councilBubble} ${speaking && bubble ? s[bubble.tone] : ""}`} style={{ ["--tint" as string]: tint }}>
              {speaking && bubble ? bubble.text : poseFor(member).caption}
            </p>
          )}
        </div>
      </Html>
      <Html position={[0, -1.15, 0]} center zIndexRange={[36, 30]} style={{ pointerEvents: "none" }}>
        <div data-map-token className={s.familiar}>
          <span className={s.familiarName} style={{ ["--tint" as string]: tint }}>
            {dot && <i className={s.statusDot} style={{ background: tint }} aria-hidden />}
            {COUNCIL_LABEL[actor]}
          </span>
        </div>
      </Html>
    </group>
  );
}

export function CouncilFamiliars({ world, animate }: { world: RoomWorld; animate: boolean }) {
  const revealing = useConvergenceActive();
  const members = useMemo(() => reduceCouncil(world.events), [world.events]);
  const bubbles = useCouncilBubbles(members);
  // One prominent voice at a time: whoever's task changed most recently.
  const speaker = COUNCIL_ACTORS.filter((a) => bubbles[a]).sort((a, b) => bubbles[b]!.at - bubbles[a]!.at || (members[b].sequence - members[a].sequence))[0] ?? null;
  if (revealing) return null;
  return (
    <group>
      {COUNCIL_ACTORS.map((actor, i) => (
        <Familiar key={actor} actor={actor} member={members[actor]} index={i} bubble={bubbles[actor]} speaking={speaker === actor} animate={animate} onPick={world.onPick ? (a) => world.onPick?.({ kind: "agent", actor: a }) : undefined} />
      ))}
    </group>
  );
}
