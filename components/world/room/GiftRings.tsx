"use client";

import { Html, QuadraticBezierLine } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type PointerEvent as ReactPointerEvent, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AVATAR_WORLD_SCALE, type AvatarId, StorybookAvatar } from "@/components/characters/StorybookAvatar";
import { BOX_DROP_RADIUS, dragResult, RING_RADII, RING_STRETCH, ringDistance, type RingDragResult, type RingTheme, type RingZone, ZONE_EDGES, zoneAt } from "@/lib/map/rings";
import { portraitUrl } from "@/lib/room/avatars";
import { IslandMesh } from "../FloatingIsland";
import { FAR_PALETTE, MID_PALETTE } from "../islands/shared";
import { GIFT_SPOT } from "../sceneConfig";
import type { IslandShape } from "../terrain";
import { Jar } from "./TowerInterior";
import { mapCursor, type MapCursorMode } from "./mapCursor";
import { mapView } from "./mapView";
import { ringBase } from "./stageLayout";
import { useRings } from "./ringsStore";
import { PledgeRing, type PledgeWorld } from "./PledgeRing";
import { platformTop } from "../props/Stonework";
import s from "./gift-rings.module.css";

/**
 * The gift map (D19), staged in the same world as the island: memories on the
 * outer ring, themes in the middle, gifts inside, the island's own present at
 * the centre. Display data and callbacks come from the room layout; this
 * component holds only local drag state and never writes room data itself.
 */

export interface RingAction {
  icon: string;
  label: string;
  tone?: "yes" | "pass" | "gold";
  on?: boolean;
  disabled?: boolean;
  run(): void;
}

export interface RingsWorld {
  clues: { key: string; text: string; author: string; avatar: AvatarId; theme: string; tint: string; x: number; z: number }[];
  /** Council themes, or the three clue groups until the council has grouped them. */
  themes: { key: string; theme: string; label: string; count: number; x: number; z: number; tint: string; jar: RingTheme }[];
  /** Friends' typed gift ideas: shared, but not products until research finds listings for them. */
  ideas: { key: string; text: string; author: string; avatar: AvatarId; x: number; z: number }[];
  gifts: { key: string; listingId: string; title: string; price: string; imageUrl?: string; themes: string[]; x: number; z: number; rank: number; up: number; down: number; fixture: boolean; finalist?: boolean; faded?: boolean }[];
  /** Votes on memories and themes, by node key. */
  votes?: Readonly<Record<string, { up: number; down: number }>>;
  /** Another member just voted on this node: a short bubble with their name. */
  pulses?: Readonly<Record<string, { name: string; value: number; color: string }>>;
  /** Other members' pointers on the map plane. */
  cursors?: { key: string; name: string; color: string; x: number; z: number }[];
  /** A card floating over the rings, such as the sharpen question. */
  overlay?: ReactNode | null;
  /** The viewer's pointer on the map plane, for their own live cursor. */
  onPointer?(x: number, z: number): void;
  selectedListingId?: string;
  boxLabel: string;
  /** Everyone's share of the current revision, drawn above the present. */
  pledge?: PledgeWorld | null;
  /** Shares, limits and approvals, opened beside the present when the box is selected. */
  boxPanel?: ReactNode | null;
  selectedKey: string | null;
  /** “Why this?”: keys on the path to the chosen gift. Everything else dims. */
  highlight?: ReadonlySet<string> | null;
  composer?: { x: number; z: number; node: ReactNode } | null;
  onSelect(key: string | null): void;
  /** A click on empty sky, as an offset from the present, and the zone it landed in; null closes whatever is open. */
  onEmpty(point: [number, number] | null, zone?: RingZone): void;
  onDrag(key: string, result: RingDragResult): void;
  actionsFor(key: string): { caption: ReactNode; actions: RingAction[] } | null;
}

const SHAPES: Record<"clue" | "theme" | "gift", IslandShape> = {
  clue: { seed: 303, radius: 1.35, stretch: 1.12, depth: 2.2, hilliness: 0.3 },
  theme: { seed: 317, radius: 2.1, stretch: 1.1, depth: 3.1, hilliness: 0.25 },
  gift: { seed: 331, radius: 1.5, stretch: 1.08, depth: 2.4, hilliness: 0.2 },
};
const DETAIL = { rings: 8, segments: 44, layers: 9 };

type Kind = "clue" | "theme" | "gift";
const modeFor = (zone: RingZone | null): MapCursorMode => (zone === "box" ? "box" : zone === "gift" ? "gift" : "memory");
const kindOf = (key: string): Kind => (key.startsWith("gift:") ? "gift" : key.startsWith("theme:") ? "theme" : "clue");

/** Shared drag state between the DOM labels and the scene. */
function useRingDrag(center: THREE.Vector3, onDrag: RingsWorld["onDrag"]) {
  const camera = useThree((st) => st.camera);
  const gl = useThree((st) => st.gl);
  const [preview, setPreview] = useState<{ key: string; x: number; z: number; result: RingDragResult } | null>(null);
  const drag = useRef<{ key: string; from: [number, number]; hit: THREE.Vector3; x: number; y: number; id: number; moved: boolean; last: [number, number] } | null>(null);
  const blocked = useRef<{ key: string; until: number } | null>(null);
  const callback = useRef(onDrag);
  callback.current = onDrag;
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -center.y), [center]);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const hitAt = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      if (!d.moved) mapCursor.set("drag");
      d.moved = true;
      const p = hitAt(e.clientX, e.clientY);
      if (!p) return;
      let x = d.from[0] + p.x - d.hit.x;
      let z = d.from[1] + p.z - d.hit.z;
      const r = ringDistance(x, z);
      if (r > RING_RADII.input + 4) {
        x *= (RING_RADII.input + 4) / r;
        z *= (RING_RADII.input + 4) / r;
      }
      d.last = [x, z];
      setPreview({ key: d.key, x, z, result: dragResult(kindOf(d.key), d.from, d.last) });
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      setPreview(null);
      if (!d.moved) return;
      blocked.current = { key: d.key, until: performance.now() + 350 };
      callback.current(d.key, dragResult(kindOf(d.key), d.from, d.last));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [camera, gl, plane]);
  return {
    preview,
    begin(key: string, from: [number, number], e: ReactPointerEvent) {
      if (e.button !== 0) return;
      const hit = hitAt(e.clientX, e.clientY);
      if (!hit) return;
      drag.current = { key, from, hit, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, last: from };
    },
    clickable(key: string) {
      return !(blocked.current?.key === key && performance.now() < blocked.current.until);
    },
  };
}

/** One floating island that glides to its ring position and bobs gently. */
function RingIsland({ at, kind, delay, animate, muted, children }: { at: THREE.Vector3; kind: Kind; delay: number; animate: boolean; muted?: boolean; children?: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  // Set once: passing a fresh position on every render would snap the island back to its entrance spot each time.
  const start = useMemo(() => at.clone().setY(at.y - 3), []); // eslint-disable-line react-hooks/exhaustive-deps
  const born = useRef(-1);
  const palette = kind === "theme" ? MID_PALETTE : FAR_PALETTE;
  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    if (born.current < 0) born.current = clock.elapsedTime;
    const age = clock.elapsedTime - born.current - delay;
    const grow = animate ? THREE.MathUtils.smoothstep(age, 0, 0.9) : 1;
    g.scale.setScalar(Math.max(0.001, grow) * (muted ? 0.82 : 1));
    g.position.lerp(at, animate ? 1 - Math.exp(-dt * 4) : 1);
    if (animate) g.position.y = at.y + Math.sin(clock.elapsedTime * 0.9 + at.x) * 0.18 - (1 - grow) * 3;
  });
  return (
    <group ref={group} position={start}>
      <IslandMesh shape={SHAPES[kind]} palette={palette} detail={DETAIL} />
      {children}
    </group>
  );
}

function Token({ k, rings, from, drag, face, label, offset, dim }: { k: string; rings: RingsWorld; from: [number, number]; drag: ReturnType<typeof useRingDrag>; face: ReactNode; label: string; offset: [number, number, number]; dim: boolean }) {
  const selected = rings.selectedKey === k;
  const info = selected ? rings.actionsFor(k) : null;
  const votes = rings.votes?.[k];
  const pulse = rings.pulses?.[k];
  return (
    <Html position={offset} center zIndexRange={selected ? [60, 50] : [20, 0]}>
      <div data-map-token className={`${s.token} ${selected ? s.on : ""} ${dim ? s.dim : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
        onPointerEnter={() => mapCursor.set("node")} onPointerLeave={() => mapCursor.set("memory")}>
        <button type="button" className={s.face} aria-label={label} aria-expanded={selected}
          onPointerDown={(e) => drag.begin(k, from, e)}
          onClick={() => drag.clickable(k) && rings.onSelect(selected ? null : k)}>
          {face}
        </button>
        {votes && (votes.up > 0 || votes.down > 0) && (
          <span className={s.voteChips} aria-label={`${votes.up} feel it, ${votes.down} not really`}>
            {votes.up > 0 && <i className={s.yes}>♥ {votes.up}</i>}
            {votes.down > 0 && <i className={s.pass}>✕ {votes.down}</i>}
          </span>
        )}
        {pulse && <span key={`${pulse.name}${pulse.value}`} className={`${s.pulse} ${pulse.value > 0 ? s.pulseYes : s.pulsePass}`} style={{ ["--who" as string]: pulse.color }}>{pulse.name} {pulse.value > 0 ? "♥ feels like her" : "✕ not really"}</span>}
        {info && <p className={s.caption}>{info.caption}</p>}
        {info && info.actions.length > 0 && (
          <div className={s.actions}>
            {info.actions.map((a, i) => (
              <button key={a.label} type="button" style={{ ["--i" as string]: i }} className={`${s.act} ${a.tone ? s[a.tone] : ""}`} aria-pressed={a.on} disabled={a.disabled} aria-label={a.label} onClick={a.run}>
                <span aria-hidden>{a.icon}</span>
                <small>{a.label}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </Html>
  );
}

function Ring({ center, radius, label, glow }: { center: THREE.Vector3; radius: number; label?: string; glow?: string | null }) {
  return (
    <group position={[center.x, center.y - 0.9, center.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[RING_STRETCH, 1, 1]}>
        <ringGeometry args={[radius - (glow ? 0.16 : 0.07), radius + (glow ? 0.16 : 0.07), 180]} />
        <meshBasicMaterial color={glow ?? "#fff6e3"} transparent opacity={glow ? 0.75 : 0.32} depthWrite={false} fog={false} />
      </mesh>
      {label && (
        <Html position={[radius * RING_STRETCH * Math.cos(0.3), 0, radius * Math.sin(0.3)]} center zIndexRange={[5, 0]}>
          <span className={s.ringLabel}>{label}</span>
        </Html>
      )}
    </group>
  );
}

/**
 * Moving around the map: drag empty sky to pan, scroll to zoom, arrow keys
 * and +/− from the keyboard, 0 to recenter. A short click still reaches the
 * backdrop's click handler (it ignores anything that moved).
 */
function useMapNavigation(center: THREE.Vector3) {
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  const gl = useThree((st) => st.gl);
  const size = useThree((st) => st.size);
  const pan = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => {
    mapView.reset(true);
    return () => mapView.reset(true);
  }, []);
  useEffect(() => {
    const worldPerPixel = () => (2 * camera.position.distanceTo(center) * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.height);
    const move = (e: PointerEvent) => {
      const p = pan.current;
      if (!p || e.pointerId !== p.id) return;
      // A click wobbles a pixel or two; only a real drag moves the map.
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
      if (!p.moved) {
        p.moved = true;
        mapView.dragging = true;
        mapCursor.set("pan");
      }
      const k = worldPerPixel();
      // Screen-down is toward the viewer on the tilted map, which is foreshortened.
      mapView.pan(-(e.clientX - p.x) * k, -(e.clientY - p.y) * k * 1.3);
      p.x = e.clientX;
      p.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (pan.current?.id !== e.pointerId) return;
      if (pan.current.moved) mapCursor.set("memory");
      pan.current = null;
      mapView.dragging = false;
    };
    const wrapper = gl.domElement.parentElement ?? gl.domElement;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("textarea")) return;
      e.preventDefault();
      const lines = e.deltaMode === 1;
      const mouseNotch = !lines && e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY);
      if (e.ctrlKey || lines || mouseNotch) {
        // Pinch on a trackpad, or a mouse wheel: zoom, a little per notch.
        const amount = e.ctrlKey ? e.deltaY * 0.01 : Math.sign(e.deltaY) * (lines ? 0.08 : Math.min(0.12, Math.abs(e.deltaY) * 0.001));
        mapView.zoomBy(Math.exp(amount));
      } else {
        // Two fingers on a trackpad: move around, like the sky is being slid.
        const k = worldPerPixel();
        mapView.pan(e.deltaX * k, e.deltaY * k * 1.3);
      }
    };
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const step = 3;
      if (e.key === "ArrowLeft") mapView.pan(-step, 0);
      else if (e.key === "ArrowRight") mapView.pan(step, 0);
      else if (e.key === "ArrowUp") mapView.pan(0, -step);
      else if (e.key === "ArrowDown") mapView.pan(0, step);
      else if (e.key === "+" || e.key === "=") mapView.zoomBy(0.85);
      else if (e.key === "-" || e.key === "_") mapView.zoomBy(1 / 0.85);
      else if (e.key === "0") mapView.reset();
      else return;
      e.preventDefault();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    wrapper.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      wrapper.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
      mapView.dragging = false;
    };
  }, [camera, gl, size.height, center]);
  return {
    start(e: ThreeEvent<PointerEvent>) {
      if (e.nativeEvent.button !== 0) return;
      e.nativeEvent.preventDefault();
      window.getSelection()?.removeAllRanges();
      pan.current = { id: e.nativeEvent.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, moved: false };
    },
  };
}

/** A friend's pointer on the map: glides to each update so it moves smoothly between the few updates a second. */
function RemoteCursor({ at, name, color, animate }: { at: THREE.Vector3; name: string; color: string; animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const start = useMemo(() => at.clone(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    if (group.current) group.current.position.lerp(at, animate ? 1 - Math.exp(-Math.min(dt, 0.1) * 10) : 1);
  });
  return (
    <group ref={group} position={start}>
      <Html zIndexRange={[85, 80]} style={{ pointerEvents: "none" }}>
        <span className={s.remoteCursor} style={{ ["--who" as string]: color }}>
          <svg viewBox="0 0 20 22"><path d="M2 2l15 8-6.5 1.8L7.5 19z" /></svg>
          <b>{name}</b>
        </span>
      </Html>
    </group>
  );
}

/** Faint filled bands for each zone; the one under the pointer glows a little. */
function ZoneBands({ center, hover }: { center: THREE.Vector3; hover: RingZone | null }) {
  const bands: [RingZone, number, number, string][] = [
    ["box", 0.01, ZONE_EDGES.box, "#ffe2a6"],
    ["gift", ZONE_EDGES.box, ZONE_EDGES.gift, "#f4d58f"],
    ["theme", ZONE_EDGES.gift, ZONE_EDGES.theme, "#d8cff0"],
    ["outer", ZONE_EDGES.theme, ZONE_EDGES.outer, "#fff3df"],
  ];
  return (
    <group position={[center.x, center.y - 1.05, center.z]}>
      {bands.map(([zone, inner, outer, color]) => (
        <mesh key={zone} rotation={[-Math.PI / 2, 0, 0]} scale={[RING_STRETCH, 1, 1]}>
          <ringGeometry args={[inner, outer, 160]} />
          <meshBasicMaterial color={color} transparent opacity={hover === zone ? 0.16 : 0.05} depthWrite={false} fog={false} />
        </mesh>
      ))}
    </group>
  );
}

export function GiftRings({ animate }: { animate: boolean }) {
  const rings = useRings();
  return rings ? <Rings rings={rings} animate={animate} /> : null;
}

function Rings({ rings, animate }: { rings: RingsWorld; animate: boolean }) {
  const center = useMemo(() => new THREE.Vector3(GIFT_SPOT.x, ringBase(), GIFT_SPOT.z), []);
  const drag = useRingDrag(center, rings.onDrag);
  const nav = useMapNavigation(center);
  const [zone, setZone] = useState<RingZone | null>(null);
  const zoneOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => zoneAt(e.point.x - center.x, e.point.z - center.z);
  const hover = (e: ThreeEvent<PointerEvent>) => {
    const next = zoneOf(e);
    if (next !== zone) setZone(next);
    rings.onPointer?.(e.point.x - center.x, e.point.z - center.z);
    if (mapCursor.mode !== "pan" && mapCursor.mode !== "drag") mapCursor.set(modeFor(next));
  };
  const place = (key: string, x: number, z: number): [number, number] => (drag.preview?.key === key ? [drag.preview.x, drag.preview.z] : [x, z]);
  const world = (x: number, z: number, lift = 0) => new THREE.Vector3(center.x + x, center.y + lift, center.z + z);
  const dim = (key: string) => !!rings.highlight && !rings.highlight.has(key);
  const lit = (key: string) => !!rings.highlight?.has(key);
  const result = drag.preview?.result;
  const themeAt = new Map(rings.themes.map((t) => [t.theme, place(t.key, t.x, t.z)]));
  const giftAt = new Map(rings.gifts.map((g) => [g.listingId, place(g.key, g.x, g.z)]));

  const onBackdrop = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    const x = e.point.x - center.x;
    const z = e.point.z - center.z;
    if (ringDistance(x, z) < BOX_DROP_RADIUS) rings.onSelect("box");
    else rings.onEmpty(rings.selectedKey || rings.composer ? null : [x, z], zoneAt(x, z));
  };

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, center.y - 0.2, center.z]} onClick={onBackdrop} onPointerDown={nav.start}
        onPointerMove={hover} onPointerOut={() => setZone(null)}>
        <planeGeometry args={[220, 220]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <ZoneBands center={center} hover={zone} />
      <Ring center={center} radius={RING_RADII.input} label="everything shared" glow={result === "pass" ? "#e48e88" : null} />
      <Ring center={center} radius={RING_RADII.theme} label={rings.themes.length ? "themes" : undefined} />
      <Ring center={center} radius={RING_RADII.gift} label={rings.gifts.length ? "gift ideas" : undefined} glow={result === "support" ? "#9fcf7f" : null} />
      <Ring center={center} radius={BOX_DROP_RADIUS} glow={result === "box" ? "#ffd98a" : null} />

      {rings.clues.map((c, i) => {
        const [x, z] = place(c.key, c.x, c.z);
        const t = themeAt.get(c.theme);
        return (
          <group key={c.key}>
            {t && <QuadraticBezierLine start={world(x, z, 0.4)} end={world(t[0], t[1], 0.6)} mid={world((x + t[0]) / 2, (z + t[1]) / 2, -1.2)} color={lit(c.key) ? "#ffd98a" : c.tint} lineWidth={lit(c.key) ? 3 : 1.5} transparent opacity={dim(c.key) ? 0.12 : 0.7} />}
            <RingIsland at={world(x, z)} kind="clue" delay={i * 0.06} animate={animate} muted={dim(c.key)}>
              <Suspense fallback={null}>
                <StorybookAvatar avatar={c.avatar} position={[0.35, 0.15, 0]} rotation={[0, -0.4, 0]} scale={AVATAR_WORLD_SCALE * 2.2} />
              </Suspense>
              <Token k={c.key} rings={rings} from={[c.x, c.z]} drag={drag} dim={dim(c.key)} offset={[0, -0.6, 2.2]} label={`${c.author}'s memory`}
                face={<span className={s.bubble} style={{ ["--c" as string]: c.tint }}><img src={portraitUrl(c.avatar)} alt="" /><q>{c.text}</q></span>} />
            </RingIsland>
          </group>
        );
      })}

      {rings.themes.map((t, i) => {
        const [x, z] = place(t.key, t.x, t.z);
        return (
          <RingIsland key={t.key} at={world(x, z)} kind="theme" delay={0.3 + i * 0.12} animate={animate} muted={dim(t.key)}>
            <Jar kind={t.jar} count={t.count} scale={2.4} position={[0, 0.2, 0]} />
            <Token k={t.key} rings={rings} from={[t.x, t.z]} drag={drag} dim={dim(t.key)} offset={[0, -0.8, 3]} label={`${t.label} theme`}
              face={<span className={s.theme} style={{ ["--c" as string]: t.tint }}><b>{t.label}</b><small>{t.count} shared</small></span>} />
          </RingIsland>
        );
      })}

      {rings.gifts.map((g, i) => {
        const [x, z] = place(g.key, g.x, g.z);
        return (
          <group key={g.key}>
            {g.themes.map((theme) => {
              const t = themeAt.get(theme);
              return t ? <QuadraticBezierLine key={theme} start={world(t[0], t[1], 0.6)} end={world(x, z, 0.4)} mid={world((x + t[0]) / 2, (z + t[1]) / 2, -1.2)} color={lit(g.key) ? "#ffd98a" : "#e7c98f"} lineWidth={lit(g.key) ? 3 : 1.5} transparent opacity={dim(g.key) ? 0.1 : 0.75} /> : null;
            })}
            {rings.selectedListingId === g.listingId && <QuadraticBezierLine start={world(x, z, 0.4)} end={world(0, 0, 1.2)} mid={world(x / 2, z / 2, -0.6)} color="#ffd98a" lineWidth={3} />}
            <RingIsland at={world(x, z)} kind="gift" delay={0.5 + i * 0.1} animate={animate} muted={dim(g.key) || !!g.faded}>
              <Token k={g.key} rings={rings} from={[g.x, g.z]} drag={drag} dim={dim(g.key)} offset={[0, -0.4, 2.2]} label={g.title}
                face={<span className={`${s.gift} ${g.finalist ? s.finalist : ""} ${g.faded ? s.fadedGift : ""}`}>{g.imageUrl ? <img src={g.imageUrl} alt="" /> : <i aria-hidden>🎁</i>}<b>{g.price}</b><em>#{g.rank}</em>{(g.up > 0 || g.down > 0) && <span className={s.votes}>{g.up > 0 && <i className={s.yes}>♥ {g.up}</i>}{g.down > 0 && <i className={s.pass}>✕ {g.down}</i>}</span>}</span>} />
            </RingIsland>
          </group>
        );
      })}

      {rings.ideas.map((idea, i) => (
        <RingIsland key={idea.key} at={world(idea.x, idea.z)} kind="gift" delay={0.4 + i * 0.1} animate={animate} muted={dim(idea.key)}>
          <Token k={idea.key} rings={rings} from={[idea.x, idea.z]} drag={{ ...drag, begin: () => undefined }} dim={dim(idea.key)} offset={[0, -0.4, 2.2]} label={`${idea.author}'s gift idea`}
            face={<span className={s.idea}><img src={portraitUrl(idea.avatar)} alt="" /><span><b>{idea.text}</b><small>gift idea · {idea.author}</small></span></span>} />
        </RingIsland>
      ))}

      <group position={[center.x, center.y, center.z]}>
        <Token k="box" rings={rings} from={[0, 0]} drag={{ ...drag, begin: () => undefined }} dim={dim("box")} offset={[0, 1.2, 9]} label="Our gift box"
          face={<span className={s.box}>🎁 <b>{rings.boxLabel}</b></span>} />
      </group>

      {rings.pledge && <PledgeRing pledge={rings.pledge} animate={animate} />}
      {rings.selectedKey === "box" && rings.boxPanel && (
        <Html position={[GIFT_SPOT.x + 4.4, platformTop() + 1.6, GIFT_SPOT.z]} zIndexRange={[75, 65]}>
          <div className={s.boxAnchor} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>{rings.boxPanel}</div>
        </Html>
      )}

      {rings.overlay && (
        <Html position={world(0, -RING_RADII.theme - 1, 4)} center zIndexRange={[78, 70]}>
          <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>{rings.overlay}</div>
        </Html>
      )}
      {(rings.cursors ?? []).map((c) => <RemoteCursor key={c.key} at={world(c.x, c.z, 0.6)} name={c.name} color={c.color} animate={animate} />)}

      {rings.composer && (
        <Html position={world(rings.composer.x, rings.composer.z, 1)} center zIndexRange={[70, 60]}>
          <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>{rings.composer.node}</div>
        </Html>
      )}
      {drag.preview && (
        <Html position={world(0, 0, 2)} center zIndexRange={[80, 70]}>
          <span className={s.hint}>{result === "box" ? "Release to put it in the box" : result === "support" ? "Release: ♥ feels right" : result === "pass" ? "Release: ✕ pass for now" : "Toward the present supports · away passes"}</span>
        </Html>
      )}
    </group>
  );
}
