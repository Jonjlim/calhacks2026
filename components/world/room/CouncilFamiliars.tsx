"use client";

import { Html } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useConvergenceActive, useConvergenceState } from "@/components/convergence/convergenceClock";
import { AVATAR_WORLD_SCALE, StorybookAvatar } from "@/components/characters/StorybookAvatar";
import { COUNCIL_LABEL, type CouncilClip, poseFor } from "@/lib/council/animation";
import { COUNCIL_AVATAR, ROBOT_TINT, robotClip } from "@/lib/council/robots";
import { COUNCIL_ACTORS, type CouncilActor, type CouncilMemberState, reduceCouncil } from "@/lib/council/contracts";
import type { RoomWorld } from "../IslandWorldProvider";
import { sparkleTexture } from "../painterly/textures";
import { playCouncilTick } from "../sfx";
import { platformTop } from "../props/Stonework";
import { GIFT_SPOT } from "../sceneConfig";
import { ringBase } from "./stageLayout";
import { useRings } from "./ringsStore";
import { mapView } from "./mapView";
import s from "./gift-rings.module.css";

/**
 * The AI council as a dock of five small companions down the left edge of the
 * map. They are real 3D models, placed in front of the camera at a fixed spot
 * on the screen, so orbiting and tilting the world never moves, rotates or
 * hides them, and no second canvas is needed. They only ever show what the
 * council really did: state comes from the stored task events (the same ones the
 * tower uses). A companion wakes and glows in its role colour while its task
 * runs; when something real happens it steps out a little and says it in one
 * small bubble (only one speaks at a time), and, where the event clearly
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

/**
 * What a companion says while its task really is running: a few short phrases
 * for that role, taken in turn so a long task does not repeat one line. They are
 * only ever shown while the stored event says the task is started.
 */
const WORKING_PHRASES: Record<CouncilActor, string[]> = {
  scout: ["Scouting gift ideas…", "Looking for better matches…", "Checking real listings…"],
  archivist: ["Sorting memories…", "Grouping shared clues…"],
  muse: ["Finding patterns…", "Linking ideas together…"],
  keeper: ["Balancing contributions…", "Checking the budget…"],
  courier: ["Preparing the next step…", "Gathering the results…"],
};

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

/** A thin curve of drifting light from a companion to what its news is about. Grows, shimmers, fades. */
function Trail({ from, to, tint, startedAt }: { from: THREE.Object3D; to: THREE.Vector3; tint: string; startedAt: number }) {
  const N = 26;
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color: tint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), [tint]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    const age = (Date.now() - startedAt) / 1000;
    const grow = THREE.MathUtils.smoothstep(age, 0, 1.3);
    const fade = 1 - THREE.MathUtils.smoothstep(age, 2.3, 3.4);
    from.getWorldPosition(_p0);
    _p1.copy(_p0).lerp(to, 0.5).y += 2.6 + _p0.distanceTo(to) * 0.12;
    for (let i = 0; i < N; i++) {
      const sp = refs.current[i];
      if (!sp) continue;
      const u = (i / (N - 1)) * grow;
      const a = 1 - u;
      // Quadratic curve.
      _pt.set(a * a * _p0.x + 2 * a * u * _p1.x + u * u * to.x, a * a * _p0.y + 2 * a * u * _p1.y + u * u * to.y, a * a * _p0.z + 2 * a * u * _p1.z + u * u * to.z);
      sp.position.copy(_pt);
      sp.visible = u > 0 && fade > 0.01 && i / (N - 1) <= grow + 0.001;
      const tw = 0.65 + 0.35 * Math.sin(clock.elapsedTime * 7 + i * 1.7);
      sp.scale.setScalar((0.16 + 0.1 * tw) * (0.7 + 0.3 * (1 - i / N)) * 2);
      (sp.material as THREE.SpriteMaterial).opacity = fade * (0.35 + 0.6 * tw);
    }
  });
  return (
    <group>
      {Array.from({ length: N }, (_, i) => (
        <sprite key={i} ref={(el) => void (refs.current[i] = el)} material={mat.clone()} visible={false} />
      ))}
    </group>
  );
}

/** Where in the world an actor's running task happens, if anywhere: the clues, the top theme, the top gift, the box, the centre. */
function workSpot(actor: CouncilActor, rings: ReturnType<typeof useRings>): THREE.Vector3 | null {
  const ground = platformTop();
  const at = (x: number, z: number, y = ground) => new THREE.Vector3(GIFT_SPOT.x + x, y, GIFT_SPOT.z + z);
  if (actor === "archivist") {
    const clues = rings?.clues ?? [];
    if (!clues.length) return at(-3.2, 2.4);
    const x = clues.reduce((n, c) => n + c.x, 0) / clues.length;
    const z = clues.reduce((n, c) => n + c.z, 0) / clues.length;
    return at(x, z, ringBase());
  }
  if (actor === "muse") {
    const t = rings?.themes[0];
    return t ? at(t.x * 0.85, t.z * 0.85, ringBase()) : at(2.6, -2.6);
  }
  if (actor === "scout") {
    const g = rings?.gifts[0];
    return g ? at(g.x * 0.85, g.z * 0.85, ringBase()) : at(3.4, 2.2);
  }
  // Kept beyond radius 3.2 of the present: the player garden spots (2.45-2.8) and their mini spirits live inside it.
  return actor === "keeper" ? at(-3.4, 0.8) : at(0.6, -3.6);
}

/** Model height in its own units (hood top of the storybook exports). */
const AVATAR_UNITS = 2.2;
/** Size when walking in the world, a touch bigger than the player spirits so they read from the map view. */
const WORLD_SCALE = AVATAR_WORLD_SCALE * 1.25;
/** World units per second when walking out or back. */
const WALK_SPEED = 7;

const _dock = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _qy = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _ndc = new THREE.Vector3();
/** Inset of the off-screen chevron from the viewport edge, in px. */
const EDGE_INSET = 28;

function Companion({ actor, member, slot, bubble, speaking, animate, mood, quiet, focused, spot, onPick, onTrail }: { actor: CouncilActor; member: CouncilMemberState; slot: number; bubble: Bubble | null; speaking: boolean; animate: boolean; /** During the gift reveal: how they feel about it. */ mood?: CouncilClip; quiet: boolean; /** The branch in focus concerns this companion (memories: Archivist, themes: Muse, gifts: Scout). */ focused?: boolean; /** Where it goes to work while its task runs. */ spot: THREE.Vector3 | null; onPick?: (actor: CouncilActor) => void; onTrail: (actor: CouncilActor, group: THREE.Group) => void }) {
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
  const state = useRef({ out: 0, react: -10, lastAt: bubble?.at ?? 0, scale: 1, pos: new THREE.Vector3(), mode: "dock" as "dock" | "out" | "there" | "back", init: false, dest: new THREE.Vector3(), edge: { x: 0, y: 0, angle: 0 } });
  const [offscreen, setOffscreen] = useState(false);
  const chevron = useRef<HTMLButtonElement>(null);
  const [walking, setWalking] = useState(false);
  // Only a completion that arrives live celebrates; a refresh restores a quiet pose.
  const [celebrating, setCelebrating] = useState(false);
  const lastSeq = useRef(member.sequence);
  useEffect(() => {
    if (member.sequence === lastSeq.current) return;
    lastSeq.current = member.sequence;
    setCelebrating(member.status === "completed");
  }, [member.sequence, member.status]);
  const [turn, setTurn] = useState(0);
  const running = bubble?.tone === "working";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTurn((n) => n + 1), 3600);
    return () => clearInterval(timer);
  }, [running]);
  const phrases = WORKING_PHRASES[actor];
  const said = bubble ? (running ? phrases[turn % phrases.length]! : bubble.text) : null;
  const gentle = useGentle(!quiet && speaking && said ? said : null);
  const narrow = size.width < NARROW;
  const active = !!bubble;
  // Narrow screens and reduced motion never walk: they stay docked and the trail points instead.
  const away = working && !!spot && !narrow && !mood && animate;

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

  const shown = !narrow || speaking || walking;
  const place = narrow ? 0.05 : DOCK_TOP - slot * DOCK_STEP;
  const clip = !animate ? "Idle" : robotClip({ status: member.status, walking, celebrating, hover, reveal: !!mood, gesture });

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const st = state.current;
    const t = clock.elapsedTime;
    const step = Math.min(dt, 0.1);
    const k = 1 - Math.exp(-step * 5);
    g.visible = shown;
    camera.getWorldDirection(_fwd);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
    const halfH = DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const halfW = halfH * camera.aspect;
    st.out += (((speaking ? 1 : 0) + (hover ? 0.8 : 0) + (working ? 0.4 : 0) + (focused ? 0.6 : 0)) - st.out) * k;
    if (bubble && bubble.at > st.lastAt) {
      st.lastAt = bubble.at;
      st.react = t;
      if (speaking && bubble.tone !== "working") playCouncilTick();
    }
    const hop = Math.max(0, Math.sin((t - st.react) * 7)) * Math.exp(-(t - st.react) * 2.2) * (t - st.react < 1.4 ? 1 : 0);
    const viewShift = camera.view?.enabled ? -camera.view.offsetX / size.width : 0;
    const edgePx = 12 + HEIGHT_SHARE * size.height * 0.42;
    const nx = -1 + (2 * (edgePx + st.out * 26)) / size.width - 2 * viewShift;
    const ny = place + (animate ? Math.sin(t * 1.1 + slot * 1.9) * 0.012 : 0) + hop * 0.035;
    _dock.copy(camera.position).addScaledVector(_fwd, DEPTH).addScaledVector(_right, nx * halfW).addScaledVector(_up, ny * halfH);
    const dockScale = (HEIGHT_SHARE * 2 * halfH) / AVATAR_UNITS * (narrow ? 1.15 : 1) * (1 + st.out * 0.12);
    if (!st.init) { st.pos.copy(_dock); st.init = true; }

    // Docked: fixed on the screen. Away: a real walk in world space to the work spot and back.
    if (away && (st.mode === "dock" || st.mode === "back")) {
      st.mode = "out";
      // Frozen for the whole walk, so a map relayout mid-task does not redirect it.
      st.dest.copy(spot!);
    }
    if (!away && (st.mode === "out" || st.mode === "there")) st.mode = "back";
    const dest = st.mode === "out" || st.mode === "there" ? st.dest : _dock;
    let moving = false;
    if (st.mode === "dock") st.pos.copy(_dock);
    else {
      _dir.subVectors(dest, st.pos);
      const dist = _dir.length();
      const reach = WALK_SPEED * step * (st.mode === "back" ? 1.3 : 1);
      if (dist <= Math.max(reach, 0.05)) {
        st.pos.copy(dest);
        st.mode = st.mode === "back" ? "dock" : "there";
      } else {
        st.pos.addScaledVector(_dir, reach / dist);
        moving = true;
      }
    }
    if (moving !== walking) setWalking(moving);
    // How far into the world it is, by distance from the dock: drives size and orientation smoothly.
    const w = st.mode === "dock" ? 0 : THREE.MathUtils.smoothstep(st.pos.distanceTo(_dock), 0.4, 4);
    g.position.copy(st.pos);
    _q.copy(camera.quaternion);
    if (st.mode === "dock" || w < 0.001) {
      g.quaternion.copy(_q);
      g.rotateY(0.4 + (hover ? 0.2 : 0) + (mood ? 0.55 : 0));
    } else {
      // Faces where it is going; at the work spot, faces the present while it works.
      const look = moving ? _dir : _pt.set(GIFT_SPOT.x - st.pos.x, 0, GIFT_SPOT.z - st.pos.z);
      _e.set(0, Math.atan2(look.x, look.z), 0);
      g.quaternion.copy(_q).multiply(_qy.setFromAxisAngle(_yAxis, 0.4)).slerp(_qy.setFromEuler(_e), w);
    }
    let off = false;
    if (speaking && !quiet && st.mode !== "dock") {
      _ndc.copy(st.pos).project(camera);
      const behind = _ndc.z > 1;
      if (behind) _ndc.multiplyScalar(-1);
      off = behind || Math.abs(_ndc.x) > 1 || Math.abs(_ndc.y) > 1;
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
    st.scale = THREE.MathUtils.lerp(dockScale, WORLD_SCALE, w);
    g.scale.setScalar(st.scale);
    const sc = glow.current;
    if (sc) {
      sc.visible = working || failed || hover || !!focused || hop > 0.02;
      const pulse = working ? 1 + 0.15 * Math.sin(t * 5 + slot) : 1;
      sc.scale.setScalar((working ? 2.0 : 1.5) * pulse);
      glowMat.opacity = working ? 0.7 : failed ? 0.55 : hover ? 0.4 : 0.45;
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
    <group ref={group}>
      <sprite ref={glow} material={glowMat} position={[0, 0.95, -0.35]} visible={false} />
      {/* Role badge: a small coloured ring under its feet. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.42, 0.56, 28]} />
        <meshBasicMaterial color={tint} transparent opacity={0.85} depthWrite={false} toneMapped={false} />
      </mesh>
      <Suspense fallback={null}>
        <StorybookAvatar avatar={COUNCIL_AVATAR[actor]} clip={clip} robot={{ tint: role, working }} castShadow={false} timeScale={animate ? 1 : 0} onClipFinished={(c) => { if (c === "Celebrate") setCelebrating(false); if (c === "Wave") setGesture(undefined); }} />
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
              {poseFor(member).caption}
            </p>
          )}
          {!quiet && gentle.mounted && (
            <p role="status" className={`${s.councilBubble} ${s.dockBubble} ${s.gentle} ${gentle.visible ? s.gentleOn : ""} ${bubble ? s[bubble.tone] : ""}`} style={{ ["--tint" as string]: tint }}>
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
            onClick={() => mapView.focus(state.current.pos.x - GIFT_SPOT.x, state.current.pos.z - GIFT_SPOT.z)}
            style={{ position: "absolute", width: 28, height: 28, border: 0, borderRadius: 14, background: "rgba(20,24,32,0.55)", color: tint, cursor: "pointer", fontSize: 18, lineHeight: "28px", padding: 0, pointerEvents: "auto", transform: `translate(-50%, -50%) rotate(${state.current.edge.angle}rad)` }}
          >
            ›
          </button>
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
export function CouncilFamiliars({ world, animate }: { world: RoomWorld; animate: boolean }) {
  const revealing = useConvergenceActive();
  const conv = useConvergenceState();
  // While the present is revealed they watch with it: excited as it charges, cheering as it bursts.
  const mood: CouncilClip | undefined = !revealing ? undefined : conv === "charging" ? "excited_hop" : conv === "burst" || conv === "revealing" || conv === "complete" ? "celebrate" : undefined;
  const rings = useRings();
  // Choosing something on the map nudges the companion it concerns; the others stay quiet.
  const focusKey = rings?.selectedKey ?? "";
  const focusActor: CouncilActor | null = focusKey.startsWith("clue:") ? "archivist" : focusKey.startsWith("theme:") ? "muse" : focusKey.startsWith("gift:") ? "scout" : null;
  const members = useMemo(() => reduceCouncil(world.events), [world.events]);
  const bubbles = useCouncilBubbles(members);
  const groups = useRef<Partial<Record<CouncilActor, THREE.Group>>>({});
  const registered = useMemo(() => (actor: CouncilActor, group: THREE.Group) => void (groups.current[actor] = group), []);
  // One prominent voice at a time: whoever's task changed most recently.
  // Moss's guide owns the speech while it shows a cue.
  const hush = revealing || rings?.guideScene != null;
  const voices = COUNCIL_ACTORS.filter((a) => bubbles[a]).sort((a, b) => bubbles[b]!.at - bubbles[a]!.at || (members[b].sequence - members[a].sequence)).slice(0, 2);
  const speaker = voices[0] ?? null;
  // A trail only follows a live event whose object is clear, and only for the one that is speaking.
  const trail = speaker && bubbles[speaker]!.at > 0 && bubbles[speaker]!.tone !== "failed" ? { actor: speaker, at: bubbles[speaker]!.at } : null;
  const target = trail ? trailTarget(trail.actor, rings) : null;
  // Recomputed only when the map layout changes, so a walking robot keeps a stable destination.
  const spots = useMemo(() => Object.fromEntries(COUNCIL_ACTORS.map((a) => [a, workSpot(a, rings)])) as Record<CouncilActor, THREE.Vector3 | null>, [rings]);
  return (
    <group>
      {COUNCIL_ACTORS.map((actor, i) => (
        <Companion key={actor} actor={actor} member={members[actor]} slot={i} bubble={bubbles[actor]} speaking={voices.includes(actor) && !hush} animate={animate} mood={mood} quiet={hush} focused={focusActor === actor} spot={spots[actor]} onTrail={registered} onPick={world.onPick ? (a) => world.onPick?.({ kind: "agent", actor: a }) : undefined} />
      ))}
      {trail && target && groups.current[trail.actor] && <Trail key={`${trail.actor}:${trail.at}`} from={groups.current[trail.actor]!} to={target} tint={ROBOT_TINT[trail.actor]} startedAt={trail.at} />}
    </group>
  );
}
