"use client";

import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { useConvergenceActive, useConvergenceState } from "@/components/convergence/convergenceClock";
import { AVATAR_WORLD_SCALE, StorybookAvatar } from "@/components/characters/StorybookAvatar";
import { COUNCIL_LABEL, type CouncilClip, poseFor } from "@/lib/council/animation";
import { COUNCIL_AVATAR, ROBOT_TINT, robotClip } from "@/lib/council/robots";
import { BOX_SPOT, HOMES, type P2, assignTargets, pathLength, pointAlong, routeTo } from "@/lib/council/paths";
import { COUNCIL_ACTORS, type CouncilActor, type CouncilMemberState, reduceCouncil } from "@/lib/council/contracts";
import type { RoomWorld } from "../IslandWorldProvider";
import { sparkleTexture } from "../painterly/textures";
import { playCouncilTick } from "../sfx";
import { platformTop } from "../props/Stonework";
import { GIFT_SPOT } from "../sceneConfig";
import { groundAt } from "../terrain";
import { ringBase } from "./stageLayout";
import { useRings } from "./ringsStore";
import { CAMERA_FRAME_PRIORITY, mapView } from "./mapView";
import s from "./gift-rings.module.css";

/**
 * The AI council as five small robot companions. On a desktop map with motion
 * on they live on the main island, each at a home perch in its role's sector,
 * and walk the waypoint graph in lib/council/paths.ts (round the friends, never
 * through them) to whatever their running task concerns. On narrow screens,
 * with reduced motion, or zoomed far out they tuck into a dock down the left
 * edge of the screen, placed in front of the camera, and a trail of light
 * points instead. They only ever show what the
 * council really did: state comes from the stored task events (the same ones the
 * tower uses). A companion wakes and glows in its role colour while its task
 * runs; when something real happens it steps out a little and says it in one
 * small bubble (each active task stays visible), and, where the event clearly
 * concerns something in the world, a thin trail of light points to it. Hover
 * for a name and status; click for the event log. Display only.
 */

const FAILED = "#d95b4a";
/** A finished task's result stays up this long, then fades. */
const RESULT_MS = 7000;
/** Distance in front of the camera, and how tall a companion is on screen (share of the viewport height). */
const DEPTH = 10;
const HEIGHT_SHARE = 0.085;
/** Model height per unit of `scale` (measured). */
const MODEL_UNITS = 1.63;
/** Screen position of the dock in normalised device coordinates. */
const DOCK_TOP = 0.46;
const DOCK_STEP = 0.235;
/** Below this width only the companion that is speaking is shown. */
const NARROW = 760;

interface Bubble {
  text: string;
  tone: "working" | "done" | "failed";
  /** When the underlying task last changed (live); 0 for a state restored on load. */
  at: number;
}

/** What each companion says right now, from its real state. Completed results are shown only when they arrive live, never replayed on a refresh. */
function useCouncilBubbles(members: Record<CouncilActor, CouncilMemberState>): Record<CouncilActor, Bubble | null> {
  const seen = useRef<Record<string, string>>({});
  const first = useRef(true);
  const [results, setResults] = useState<Partial<Record<CouncilActor, { text: string; at: number; until: number }>>>({});
  const [changed, setChanged] = useState<Partial<Record<CouncilActor, number>>>({});
  const key = COUNCIL_ACTORS.map((a) => `${a}:${members[a].sequence}:${members[a].status}:${members[a].summary ?? ""}`).join("|");
  useEffect(() => {
    const now = Date.now();
    if (first.current) {
      first.current = false;
      for (const a of COUNCIL_ACTORS) seen.current[a] = `${members[a].sequence}:${members[a].status}:${members[a].summary ?? ""}`;
      return;
    }
    for (const a of COUNCIL_ACTORS) {
      const m = members[a];
      const identity = `${m.sequence}:${m.status}:${m.summary ?? ""}`;
      if (identity === seen.current[a]) continue;
      seen.current[a] = identity;
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
    out[a] = m.status === "started" ? { text: m.summary ?? poseFor(m).caption, tone: "working", at }
      : m.status === "failed" ? { text: m.summary ?? poseFor(m).caption, tone: "failed", at }
      : m.status === "completed" && results[a] ? { text: results[a]!.text, tone: "done", at: results[a]!.at }
      : null;
  }
  return out;
}

/** Keeps a bubble mounted long enough to fade out, and lets it fade in; the text it last showed stays while it leaves. */
function useGentle(text: string | null): { text: string; mounted: boolean; visible: boolean } {
  const [state, setState] = useState({ text: text ?? "", mounted: !!text, visible: false });
  useEffect(() => {
    if (text) {
      setState((s) => ({ ...s, text, mounted: true }));
      const raf = requestAnimationFrame(() => setState((s) => ({ ...s, visible: true })));
      return () => cancelAnimationFrame(raf);
    }
    setState((s) => ({ ...s, visible: false }));
    const timer = setTimeout(() => setState((s) => ({ ...s, mounted: false })), 520);
    return () => clearTimeout(timer);
  }, [text]);
  return state;
}

/** Each companion's own small, restrained idle gesture. Desynchronised by phase. */
const IDLE_GESTURE: Record<CouncilActor, "Wave" | "Sit"> = { archivist: "Sit", muse: "Wave", scout: "Wave", keeper: "Sit", courier: "Wave" };

/** What in the world an actor's real event concerns, where that is unambiguous. Archivist has no single object, so it gets no trail. */
function trailTarget(actor: CouncilActor, rings: ReturnType<typeof useRings>): THREE.Vector3 | null {
  const centre = new THREE.Vector3(GIFT_SPOT.x, platformTop() + 1.6, GIFT_SPOT.z);
  if (actor === "muse" || actor === "keeper" || actor === "courier") return centre;
  if (actor === "scout") {
    const top = rings?.gifts[0];
    return top ? new THREE.Vector3(GIFT_SPOT.x + top.x, ringBase() + 1.2, GIFT_SPOT.z + top.z) : null;
  }
  return null;
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _pt = new THREE.Vector3();
/** At most this many trails of light at once. */
const MAX_TRAILS = 2;

/** A thin curve of drifting light from a companion to what its news is about. Grows, shimmers, fades. */
function Trail({ from, to, tint, startedAt }: { from: THREE.Object3D; to: THREE.Vector3; tint: string; startedAt: number }) {
  const N = 26;
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  // One material for every sprite of the trail; the twinkle is carried by size alone.
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color: tint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), [tint]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    const age = (Date.now() - startedAt) / 1000;
    const grow = THREE.MathUtils.smoothstep(age, 0, 1.3);
    const fade = 1 - THREE.MathUtils.smoothstep(age, 2.3, 3.4);
    mat.opacity = fade * 0.75;
    from.getWorldPosition(_p0);
    _p1.copy(_p0).lerp(to, 0.5).y += 2.6 + _p0.distanceTo(to) * 0.12;
    for (let i = 0; i < N; i++) {
      const sp = refs.current[i];
      if (!sp) continue;
      const u = (i / (N - 1)) * grow;
      const a = 1 - u;
      _pt.set(a * a * _p0.x + 2 * a * u * _p1.x + u * u * to.x, a * a * _p0.y + 2 * a * u * _p1.y + u * u * to.y, a * a * _p0.z + 2 * a * u * _p1.z + u * u * to.z);
      sp.position.copy(_pt);
      sp.visible = u > 0 && fade > 0.01 && i / (N - 1) <= grow + 0.001;
      const tw = 0.65 + 0.35 * Math.sin(clock.elapsedTime * 7 + i * 1.7);
      sp.scale.setScalar((0.16 + 0.14 * tw) * (0.7 + 0.3 * (1 - i / N)) * 2);
    }
  });
  return (
    <group>
      {Array.from({ length: N }, (_, i) => (
        <sprite key={i} ref={(el) => void (refs.current[i] = el)} material={mat} visible={false} />
      ))}
    </group>
  );
}

/** Where on the map an actor's running task happens, local to the present, and what it faces there. */
function workSpot(actor: CouncilActor, rings: ReturnType<typeof useRings>): Goal {
  const local = (key: string, x: number, z: number, look: P2, y: number | null): Goal => ({ key, at: [x, z], look, y });
  if (actor === "archivist") {
    const clues = rings?.clues ?? [];
    if (!clues.length) return local("work:archivist", -3.6, 2.4, [-6, 4], null);
    const x = clues.reduce((n, c) => n + c.x, 0) / clues.length;
    const z = clues.reduce((n, c) => n + c.z, 0) / clues.length;
    // Clues all round the map average out near the present: then it reads from its own side.
    if (Math.hypot(x, z) < 6) return local("work:archivist", HOMES.archivist[0] * 1.5, HOMES.archivist[1] * 1.5, [HOMES.archivist[0] * 3, HOMES.archivist[1] * 3], null);
    return local("work:archivist", x, z, [x, z], ringBase());
  }
  if (actor === "muse") {
    const t = rings?.themes[0];
    return t ? local(`work:${t.key}`, t.x * 0.85, t.z * 0.85, [t.x, t.z], ringBase()) : local("work:muse", 2.6, -3.4, [4, -6], null);
  }
  if (actor === "scout") {
    const g = rings?.gifts[0];
    return g ? local(`work:${g.key}`, g.x * 0.85, g.z * 0.85, [g.x, g.z], ringBase()) : local("work:scout", 4.4, 3.4, [7, 5], null);
  }
  return actor === "keeper" ? local("work:keeper", -3.4, 0.8, [0, 0], null) : local("work:courier", 0.6, -3.6, [0, 0], null);
}

/** Where a robot should be right now, local to the present. `y` null means standing on the island. */
interface Goal {
  key: string;
  at: P2;
  /** What it faces once there. */
  look: P2;
  y: number | null;
  /** Its task runs (or waits for a node) here, rather than a post-council errand. */
  work?: boolean;
}

/** Model height in its own units (hood top of the storybook exports). */
const AVATAR_UNITS = 2.2;
/** Size when walking in the world, a touch bigger than the player spirits so they read from the map view. */
const WORLD_SCALE = AVATAR_WORLD_SCALE * 1.25;
/** Unhurried walking pace on the island, world units per second. */
const WALK_SPEED = 2.4;
/** Long errands off the island (to the gift ring) still take no more than this many seconds. */
const MAX_WALK_S = 7;
/** Past this zoom (1 is the default map framing) the robots tuck back into the screen dock. */
const FAR_ZOOM = 1.3;

const _dock = new THREE.Vector3();
const _wp = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _ndc = new THREE.Vector3();
/** Inset of the off-screen chevron from the viewport edge, in px. */
const EDGE_INSET = 28;

const islandY = (p: P2) => groundAt(GIFT_SPOT.x + p[0], GIFT_SPOT.z + p[1]);
/** Ground height along a walk: the island's own ground near the present, easing to the goal's height on the rings beyond. */
function heightAt(p: P2, goal: Goal | null): number {
  const r = Math.hypot(p[0], p[1]);
  if (!goal || goal.y === null || r < 5.5) return islandY(p);
  const rt = Math.max(Math.hypot(goal.at[0], goal.at[1]), 5.6);
  const edge = islandY([(p[0] / r) * 5.5, (p[1] / r) * 5.5]);
  return THREE.MathUtils.lerp(edge, goal.y, THREE.MathUtils.smoothstep(r, 5.5, rt));
}

function angleTo(from: number, to: number, k: number) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;
}

interface CompanionProps {
  actor: CouncilActor;
  member: CouncilMemberState;
  slot: number;
  bubble: Bubble | null;
  speaking: boolean;
  animate: boolean;
  /** During the gift reveal or once everything is approved: how they feel about it. */
  mood?: CouncilClip;
  quiet: boolean;
  /** The branch in focus concerns this companion (memories: Archivist, themes: Muse, gifts: Scout). */
  focused?: boolean;
  /** Robots stand on the island (desktop, motion on, not zoomed far out) rather than in the screen dock. */
  inWorld: boolean;
  /** Where it should be; null is its home perch. */
  goal: Goal | null;
  /** A small standing tag, such as the Keeper's approval count. */
  badge?: string | null;
  /** A quiet suggestion from real state when it has nothing else to say; clicking it opens the agent drawer. */
  note?: string | null;
  onPick?: (actor: CouncilActor) => void;
  onTrail: (actor: CouncilActor, group: THREE.Group) => void;
}

function Companion({ actor, member, slot, bubble, speaking, animate, mood, quiet, focused, inWorld, goal, badge, note, onPick, onTrail }: CompanionProps) {
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  const size = useThree((st) => st.size);
  const group = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Sprite>(null);
  const [hover, setHover] = useState(false);
  const [gesture, setGesture] = useState<"Wave" | "Sit" | undefined>(undefined);
  const working = member.status === "started";
  const failed = member.status === "failed";
  const role = ROBOT_TINT[actor];
  const tint = failed ? FAILED : role;
  const glowMat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color: tint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), [tint]);
  useEffect(() => () => glowMat.dispose(), [glowMat]);
  const home = HOMES[actor];
  const state = useRef({
    out: 0, react: -10, lastAt: bubble?.at ?? 0, init: false, edge: { x: 0, y: 0, angle: 0 },
    /** 0 docked on the screen, 1 standing in the world. */
    blend: inWorld ? 1 : 0,
    /** Position on the island, local to the present, and the walk it is on. */
    at: [home[0], home[1]] as P2, yaw: Math.atan2(-home[0], -home[1]), path: [home] as P2[], s: 0, speed: WALK_SPEED, goalKey: "home", arrived: true,
  });
  const [offscreen, setOffscreen] = useState(false);
  const [paused, setPaused] = useState(false);
  const chevron = useRef<HTMLButtonElement>(null);
  const [walking, setWalking] = useState(false);
  const [arrived, setArrived] = useState(true);
  // Only a completion that arrives live celebrates; a refresh restores a quiet pose.
  const [celebrating, setCelebrating] = useState(false);
  const lastSeq = useRef(member.sequence);
  useEffect(() => {
    if (member.sequence === lastSeq.current) return;
    lastSeq.current = member.sequence;
    setCelebrating(member.status === "completed");
  }, [member.sequence, member.status]);
  // The bubble says what the task really reports; no canned "working" lines.
  const said = bubble ? bubble.text : note ?? null;
  const noting = !bubble && !!note;
  const gentle = useGentle(!quiet && (speaking || noting) && said ? said : null);
  const narrow = size.width < NARROW;
  const active = !!bubble;
  // Walks happen on the island only; narrow screens and reduced motion never walk.
  const walks = animate && !narrow;

  useEffect(() => {
    if (!animate || member.status !== "idle") return;
    let timer = 0;
    const loop = (delay: number) => {
      timer = window.setTimeout(() => {
        setGesture(IDLE_GESTURE[actor]);
        // Sit holds its last frame, so it is released after a moment; Wave ends itself.
        timer = window.setTimeout(() => {
          setGesture(undefined);
          loop(9000 + Math.random() * 9000);
        }, 3000);
      }, delay);
    };
    loop(2500 + COUNCIL_ACTORS.indexOf(actor) * 2300 + Math.random() * 3000);
    return () => window.clearTimeout(timer);
  }, [animate, actor, member.status]);

  useEffect(() => {
    if (group.current) onTrail(actor, group.current);
  }, [actor, onTrail]);

  const shown = !narrow || speaking || walking || inWorld;
  // Active companions keep distinct slots on narrow screens too.
  const place = DOCK_TOP - slot * DOCK_STEP;
  const atWork = inWorld && arrived && !!goal?.work;
  const clip = !animate ? "Idle" : robotClip({ status: member.status, walking, atWork, celebrating, hover, reveal: !!mood, gesture: walking ? undefined : gesture });

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const st = state.current;
    const t = clock.elapsedTime;
    const step = Math.min(dt, 0.1);
    const k = 1 - Math.exp(-step * 5);
    g.visible = shown;

    // The walk on the island, in local map coordinates. It runs even while docked, so zooming back in finds it where its task is.
    const want = walks && goal ? goal : null;
    const wantKey = want ? want.key : "home";
    if (wantKey !== st.goalKey) {
      st.goalKey = wantKey;
      st.path = routeTo(st.at, want ? want.at : home);
      st.s = 0;
      st.speed = Math.max(WALK_SPEED, pathLength(st.path) / MAX_WALK_S);
      st.arrived = false;
    }
    let moving = false;
    if (!st.arrived) {
      st.s += st.speed * step;
      const r = pointAlong(st.path, st.s);
      st.at = r.p;
      if (r.end) st.arrived = true;
      else {
        moving = true;
        st.yaw = angleTo(st.yaw, Math.atan2(r.dir[0], r.dir[1]), 1 - Math.exp(-step * 8));
      }
    }
    if (!moving) {
      const look = want ? want.look : ([0, 0] as P2);
      st.yaw = angleTo(st.yaw, Math.atan2(look[0] - st.at[0], look[1] - st.at[1]), 1 - Math.exp(-step * 4));
    }
    const walkingNow = moving && st.blend > 0.5;
    if (walkingNow !== walking) setWalking(walkingNow);
    if (st.arrived !== arrived) setArrived(st.arrived);

    st.blend += ((inWorld ? 1 : 0) - st.blend) * (1 - Math.exp(-step * 3));
    if (Math.abs(st.blend - (inWorld ? 1 : 0)) < 0.002) st.blend = inWorld ? 1 : 0;
    const w = THREE.MathUtils.smoothstep(st.blend, 0, 1);

    st.out += (((speaking ? 1 : 0) + (hover ? 0.8 : 0) + (working ? 0.4 : 0) + (focused ? 0.6 : 0)) - st.out) * k;
    if (bubble && bubble.at > st.lastAt) {
      st.lastAt = bubble.at;
      st.react = t;
      if (speaking && bubble.tone !== "working") playCouncilTick();
    }
    const hop = Math.max(0, Math.sin((t - st.react) * 7)) * Math.exp(-(t - st.react) * 2.2) * (t - st.react < 1.4 ? 1 : 0);

    _wp.set(GIFT_SPOT.x + st.at[0], heightAt(st.at, want) + hop * 0.25, GIFT_SPOT.z + st.at[1]);
    if (w < 1) {
      camera.getWorldDirection(_fwd);
      _right.setFromMatrixColumn(camera.matrixWorld, 0);
      _up.setFromMatrixColumn(camera.matrixWorld, 1);
      const halfH = DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const halfW = halfH * camera.aspect;
      const viewShift = camera.view?.enabled ? -camera.view.offsetX / size.width : 0;
      const edgePx = 12 + HEIGHT_SHARE * size.height * 0.42;
      const nx = -1 + (2 * (edgePx + st.out * 26)) / size.width - 2 * viewShift;
      const ny = place + (animate ? Math.sin(t * 1.1 + slot * 1.9) * 0.012 : 0) + hop * 0.035;
      _dock.copy(camera.position).addScaledVector(_fwd, DEPTH).addScaledVector(_right, nx * halfW).addScaledVector(_up, ny * halfH);
      const dockScale = (HEIGHT_SHARE * 2 * halfH) / AVATAR_UNITS * (narrow ? 1.15 : 1) * (1 + st.out * 0.12);
      g.position.copy(_dock).lerp(_wp, w);
      g.scale.setScalar(THREE.MathUtils.lerp(dockScale, WORLD_SCALE, w));
      _q.copy(camera.quaternion).multiply(_qy.setFromAxisAngle(_yAxis, 0.4 + (hover ? 0.2 : 0) + (mood ? 0.55 : 0)));
      g.quaternion.copy(_q).slerp(_qy.setFromAxisAngle(_yAxis, st.yaw), w);
    } else {
      g.position.copy(_wp);
      g.scale.setScalar(WORLD_SCALE * (1 + st.out * 0.06));
      g.quaternion.setFromAxisAngle(_yAxis, st.yaw);
    }

    // Off the screen in the world: the animation mixer rests, and a speaking robot gets a chevron at the edge.
    let off = false;
    let hidden = false;
    if (w > 0.5) {
      _ndc.copy(g.position).project(camera);
      const behind = _ndc.z > 1;
      if (behind) _ndc.multiplyScalar(-1);
      hidden = behind || Math.abs(_ndc.x) > 1.15 || Math.abs(_ndc.y) > 1.15;
      off = speaking && !quiet && (behind || Math.abs(_ndc.x) > 1 || Math.abs(_ndc.y) > 1);
      if (off) {
        const m = Math.max(Math.abs(_ndc.x), Math.abs(_ndc.y), 1e-6);
        const hx = size.width / 2 - EDGE_INSET, hy = size.height / 2 - EDGE_INSET;
        st.edge.x = size.width / 2 + (_ndc.x / m) * hx;
        st.edge.y = size.height / 2 - (_ndc.y / m) * hy;
        st.edge.angle = Math.atan2(-_ndc.y, _ndc.x);
        const el = chevron.current;
        if (el) el.style.transform = `translate(-50%, -50%) rotate(${st.edge.angle}rad)`;
      }
    }
    if (off !== offscreen) setOffscreen(off);
    if (hidden !== paused) setPaused(hidden);
    const sc = glow.current;
    if (sc) {
      sc.visible = working || failed || hover || !!focused || hop > 0.02;
      const pulse = working ? 1 + 0.15 * Math.sin(t * 5 + slot) : 1;
      sc.scale.setScalar((working ? 2.0 : 1.5) * pulse);
      glowMat.opacity = working ? 0.7 : failed ? 0.55 : hover ? 0.4 : 0.45;
    }
    // Html labels project this group's world matrix later in the frame.
    g.updateMatrixWorld();
  }, CAMERA_FRAME_PRIORITY + 1);

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
    <group ref={group}>
      <sprite ref={glow} material={glowMat} position={[0, 0.95, -0.35]} visible={false} />
      {/* Role badge: a small coloured ring under its feet. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.42, 0.56, 28]} />
        <meshBasicMaterial color={tint} transparent opacity={0.85} depthWrite={false} toneMapped={false} />
      </mesh>
      <Suspense fallback={null}>
        <StorybookAvatar avatar={COUNCIL_AVATAR[actor]} clip={clip} robot={{ tint: role, working }} castShadow={false} timeScale={animate && !paused ? 1 : 0} onClipFinished={(c) => { if (c === "Celebrate") setCelebrating(false); if (c === "Wave") setGesture(undefined); }} />
      </Suspense>
      <mesh position={[0, 1.05, 0]} onPointerOver={over} onPointerOut={out} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPick?.(actor); }}>
        <sphereGeometry args={[1.2, 12, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Html position={[1.3, 1.3, 0]} zIndexRange={[38, 30]} style={{ pointerEvents: "none", transform: "translateY(-50%)" }}>
        <div data-map-token className={s.dock}>
          {!quiet && hover && !gentle.mounted && (
            <p role="status" className={`${s.councilBubble} ${s.dockBubble} ${s.gentleIn}`} style={{ ["--tint" as string]: tint }}>
              <b className={s.dockName}>{COUNCIL_LABEL[actor]}</b>
              {member.summary ?? poseFor(member).caption}
            </p>
          )}
          {!quiet && gentle.mounted && (
            <p
              role="status"
              className={`${s.councilBubble} ${s.dockBubble} ${s.gentle} ${gentle.visible ? s.gentleOn : ""} ${bubble ? s[bubble.tone] : ""}`}
              style={{ ["--tint" as string]: tint, ...(noting && onPick ? { pointerEvents: "auto", cursor: "pointer" } : {}) }}
              onClick={noting && onPick ? () => onPick(actor) : undefined}
            >
              {hover && <b className={s.dockName}>{COUNCIL_LABEL[actor]}</b>}
              {gentle.text}
            </p>
          )}
        </div>
      </Html>
      {offscreen && (
        <Html calculatePosition={() => [state.current.edge.x, state.current.edge.y]} zIndexRange={[40, 39]}>
          <button
            ref={chevron}
            type="button"
            data-map-token
            aria-label={`Show ${COUNCIL_LABEL[actor]}`}
            onClick={() => mapView.focus(state.current.at[0], state.current.at[1])}
            style={{ position: "absolute", width: 28, height: 28, border: 0, borderRadius: 14, background: "rgba(20,24,32,0.55)", color: tint, cursor: "pointer", fontSize: 18, lineHeight: "28px", padding: 0, pointerEvents: "auto", transform: `translate(-50%, -50%) rotate(${state.current.edge.angle}rad)` }}
          >
            ›
          </button>
        </Html>
      )}
      {/* Its name, always, on a small tag under it. */}
      {!quiet && (
        <Html position={[0, 0.1, 0]} center zIndexRange={[36, 30]} style={{ pointerEvents: "none" }}>
          <span data-map-token className={s.familiarName} style={{ ["--tint" as string]: tint }}>{COUNCIL_LABEL[actor]}</span>
        </Html>
      )}
      {/* Beside it rather than above, so the dock at the screen's left edge never clips it. */}
      {!quiet && badge && (
        <Html position={[0.75, 0.1, 0]} zIndexRange={[36, 30]} style={{ pointerEvents: "none", transform: "translateY(-50%)" }}>
          <span data-map-token data-council-badge className={s.familiarName} style={{ ["--tint" as string]: tint, whiteSpace: "nowrap" }}>{badge}</span>
        </Html>
      )}
      {!quiet && active && !speaking && !hover && (
        <Html position={[0.95, 2.0, 0]} style={{ pointerEvents: "none" }}>
          <i data-map-token className={s.statusDot} style={{ background: tint }} aria-hidden />
        </Html>
      )}
    </group>
  );
}

/** Follows the map camera's zoom target, only re-rendering when it crosses the far-zoom line. */
function useZoomedFar(): boolean {
  return useSyncExternalStore((fn) => mapView.subscribe(fn), () => mapView.target.zoom > FAR_ZOOM, () => false);
}

export function CouncilFamiliars({ world, animate }: { world: RoomWorld; animate: boolean }) {
  const revealing = useConvergenceActive();
  const conv = useConvergenceState();
  const size = useThree((st) => st.size);
  const far = useZoomedFar();
  const inWorld = animate && size.width >= NARROW && !far;
  const rings = useRings();
  const pledge = rings?.pledge ?? null;
  const allApproved = !!pledge?.allApproved;
  // While the present is revealed they watch with it: excited as it charges, cheering as it bursts. Once every share is approved they cheer too.
  const mood: CouncilClip | undefined = revealing
    ? conv === "charging" ? "excited_hop" : conv === "burst" || conv === "revealing" || conv === "complete" ? "celebrate" : undefined
    : allApproved ? "celebrate" : undefined;
  // Choosing something on the map nudges the companion it concerns; the others stay quiet.
  const focusKey = rings?.selectedKey ?? "";
  const focusActor: CouncilActor | null = focusKey.startsWith("clue:") ? "archivist" : focusKey.startsWith("theme:") ? "muse" : focusKey.startsWith("gift:") ? "scout" : null;
  const members = useMemo(() => world.members ?? reduceCouncil(world.events), [world.members, world.events]);
  const bubbles = useCouncilBubbles(members);
  const groups = useRef<Partial<Record<CouncilActor, THREE.Group>>>({});
  const registered = useMemo(() => (actor: CouncilActor, group: THREE.Group) => void (groups.current[actor] = group), []);
  // Every active task keeps its bubble; recent results cannot hide ongoing work.
  // Moss's guide owns the speech while it shows a cue.
  const hush = revealing || rings?.guideScene != null;
  const voices = COUNCIL_ACTORS.filter((a) => bubbles[a]).sort((a, b) => bubbles[b]!.at - bubbles[a]!.at || (members[b].sequence - members[a].sequence));
  const anyRunning = COUNCIL_ACTORS.some((a) => members[a].status === "started");

  // Where each robot should be, from real state only. Running tasks first; after the council, errands that match the room's phase.
  const goals = useMemo(() => {
    const requests: { actor: CouncilActor; goal: Goal; since: number }[] = [];
    if (!mood) {
      for (const a of COUNCIL_ACTORS) if (members[a].status === "started") requests.push({ actor: a, goal: { ...workSpot(a, rings), work: true }, since: members[a].sequence });
      if (!anyRunning && pledge && !pledge.allApproved) requests.push({ actor: "keeper", goal: { key: "box", at: BOX_SPOT, look: [0, 0], y: null }, since: 0 });
      if (!anyRunning && !pledge) {
        // Review: Scout visits the gift friends voted up most, if any has a vote.
        const top = [...(rings?.gifts ?? [])].filter((g) => !g.hidden && g.up > 0).sort((x, y) => y.up - x.up || x.rank - y.rank)[0];
        if (top) requests.push({ actor: "scout", goal: { key: `voted:${top.key}`, at: [top.x * 0.85, top.z * 0.85], look: [top.x, top.z], y: ringBase() }, since: 0 });
      }
    }
    const placed = assignTargets(requests.map((r) => ({ actor: r.actor, target: r.goal.at, since: r.since })));
    const out: Partial<Record<CouncilActor, Goal>> = {};
    for (const r of requests) {
      const p = placed[r.actor];
      if (!p) continue;
      out[r.actor] = p.waiting ? { ...r.goal, key: `${r.goal.key}:wait`, at: p.at, y: null } : { ...r.goal, at: p.at };
    }
    // A walk restarts only when a goal's key changes, so a relayout of the rings mid-walk does not redirect it.
    return out;
  }, [rings, members, mood, anyRunning, pledge]);

  const approvals = pledge && !pledge.allApproved && !anyRunning ? (() => {
    const counted = pledge.segments.filter((x) => x.status !== "withdrawn");
    return `${counted.filter((x) => x.status === "approved").length} of ${counted.length} approved`;
  })() : null;

  // Memories published since the Archivist last read them (its last completed count), never starting anything itself.
  const lastRead = useMemo(() => {
    const done = world.events.filter((e) => e.actor === "archivist" && e.status === "completed" && typeof e.result?.count === "number").sort((x, y) => y.timestamp - x.timestamp)[0];
    return done ? done.result!.count! : null;
  }, [world.events]);
  const newMemories = !anyRunning && !mood && lastRead !== null && world.clues.length > lastRead && !bubbles.archivist ? "New memories to read" : null;

  // Trails point at a live event's object only while the robots are docked; standing in the world, they walk there instead.
  const trails = inWorld ? [] : voices.filter((a) => bubbles[a]!.at > 0 && bubbles[a]!.tone !== "failed").slice(0, MAX_TRAILS);
  return (
    <group>
      {COUNCIL_ACTORS.map((actor, i) => (
        <Companion
          key={actor}
          actor={actor}
          member={members[actor]}
          slot={i}
          bubble={bubbles[actor]}
          speaking={voices.includes(actor) && !hush}
          animate={animate}
          mood={mood}
          quiet={hush}
          focused={focusActor === actor}
          inWorld={inWorld}
          goal={goals[actor] ?? null}
          badge={actor === "keeper" ? approvals : null}
          note={actor === "archivist" ? newMemories : null}
          onTrail={registered}
          onPick={world.onPick ? (a) => world.onPick?.({ kind: "agent", actor: a }) : undefined}
        />
      ))}
      {trails.map((a) => {
        const to = trailTarget(a, rings);
        const from = groups.current[a];
        return to && from ? <Trail key={`${a}:${bubbles[a]!.at}`} from={from} to={to} tint={ROBOT_TINT[a]} startedAt={bubbles[a]!.at} /> : null;
      })}
    </group>
  );
}
