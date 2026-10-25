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
import { MapIcon, type MapIconName } from "./MapIcon";
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
  icon: MapIconName;
  label: string;
  tone?: "yes" | "pass" | "gold";
  on?: boolean;
  disabled?: boolean;
  /** Tucked behind the ⋯ button instead of shown in the main row. */
  more?: boolean;
  run(): void;
}

/** What a selected node shows in its attached card. */
export interface RingDetail {
  caption: ReactNode;
  /** A short explanation under the caption, such as why a gift fits. */
  note?: ReactNode;
  actions: RingAction[];
}

export type RingResearch = "running" | "failed" | null;

export interface RingsWorld {
  clues: { key: string; text: string; author: string; avatar: AvatarId; color: string; theme: string; tint: string; x: number; z: number; fromPhoto?: boolean; photo?: string }[];
  /** Photos members added, shared with the whole room (D20). The uploader also sees what the private read found. */
  photos?: { key: string; images: string[]; author: string; mine: boolean; found: number; reading: boolean; x: number; z: number }[];
  /** Council themes, or the three clue groups until the council has grouped them. */
  themes: { key: string; theme: string; label: string; count: number; x: number; z: number; tint: string; jar: RingTheme; faces: { avatar: AvatarId; color: string }[]; research?: RingResearch }[];
  /** The theme whose memories are fanned out as readable bubbles. Others rest as small face dots. */
  openTheme?: string | null;
  /** Friends' typed gift ideas: shared, but not products until research finds listings for them. */
  /** Friends' gift ideas and sourced trend suggestions. `tag` replaces the "gift idea" caption; `faded` after someone passed. */
  ideas: { key: string; text: string; author: string; avatar: AvatarId; x: number; z: number; tag?: string; faded?: boolean; trend?: boolean }[];
  gifts: { key: string; listingId: string; title: string; price: string; imageUrl?: string; themes: string[]; x: number; z: number; rank: number; up: number; down: number; fixture: boolean; finalist?: boolean; faded?: boolean; hidden?: boolean }[];
  /** Gifts past the first few rest behind a “+N more” chip. */
  moreGifts?: { count: number; open: boolean; toggle(): void } | null;
  /** Research someone else started, shown at the present. */
  boxResearch?: RingResearch;
  /** The council's one suggested next step, offered right under the present. */
  nextStep?: { icon: MapIconName; label: string; disabled?: boolean; run?(): void } | null;
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
  actionsFor(key: string): RingDetail | null;
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
function RingIsland({ at, kind, delay, animate, muted, size = 1, children }: { at: THREE.Vector3; kind: Kind; delay: number; animate: boolean; muted?: boolean; size?: number; children?: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  // Set once: passing a fresh position on every render would snap the island back to its entrance spot each time.
  const start = useMemo(() => at.clone().setY(at.y - 3), []); // eslint-disable-line react-hooks/exhaustive-deps
  const born = useRef(-1);
  const scale = useRef(size);
  const palette = kind === "theme" ? MID_PALETTE : FAR_PALETTE;
  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    if (born.current < 0) born.current = clock.elapsedTime;
    const age = clock.elapsedTime - born.current - delay;
    const grow = animate ? THREE.MathUtils.smoothstep(age, 0, 0.9) : 1;
    // Resting memories shrink to small islets; opening them grows them back smoothly.
    scale.current += (size - scale.current) * (animate ? 1 - Math.exp(-dt * 6) : 1);
    g.scale.setScalar(Math.max(0.001, grow) * scale.current * (muted ? 0.82 : 1));
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

/**
 * Stacking: hover and open cards on top, then small nodes (memories, gifts,
 * ideas, photos), then the big theme clouds at the back, so a cloud can never
 * hide a smaller thing. drei sorts by distance inside each band.
 */
const LAYER = { back: [12, 0], front: [30, 13], lift: [48, 41], hover: [56, 49], open: [64, 57] } as const;

function Token({ k, rings, from, drag, face, peek, label, offset, dim, recede, lift, back, above }: { k: string; rings: RingsWorld; from: [number, number]; drag: ReturnType<typeof useRingDrag>; face: ReactNode; peek?: ReactNode; label: string; offset: [number, number, number]; dim: boolean; recede?: boolean; lift?: boolean; back?: boolean; above?: ReactNode }) {
  const selected = rings.selectedKey === k;
  const info = selected ? rings.actionsFor(k) : null;
  const votes = rings.votes?.[k];
  const pulse = rings.pulses?.[k];
  const [hover, setHover] = useState(false);
  const [more, setMore] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) setMore(false);
    setHover(false);
  }, [selected]);
  // A node that moves or re-renders under a still pointer can miss its leave event; any move elsewhere clears the preview.
  useEffect(() => {
    if (!hover) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setHover(false); };
    window.addEventListener("pointermove", away);
    return () => window.removeEventListener("pointermove", away);
  }, [hover]);
  const main = info?.actions.filter((a) => !a.more) ?? [];
  const extra = info?.actions.filter((a) => a.more) ?? [];
  return (
    <Html position={offset} center zIndexRange={[...(selected ? LAYER.open : hover ? LAYER.hover : lift ? LAYER.lift : back ? LAYER.back : LAYER.front)]}>
      <div ref={root} data-map-token className={`${s.token} ${selected ? s.on : ""} ${dim ? s.dim : ""} ${recede && !hover ? s.recede : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
        onPointerEnter={() => { mapCursor.set("node"); setHover(true); }} onPointerLeave={() => { mapCursor.set("memory"); setHover(false); }}>
        {!selected && hover && peek && <span className={`${s.peek} ${s.cloud}`} role="tooltip">{peek}<i className={s.trailDown} aria-hidden /></span>}
        {above}
        <button type="button" className={s.face} aria-label={label} aria-expanded={selected}
          onPointerDown={(e) => drag.begin(k, from, e)}
          onClick={() => drag.clickable(k) && rings.onSelect(selected ? null : k)}>
          {face}
        </button>
        {votes && (votes.up > 0 || votes.down > 0) && (
          <span className={s.voteChips} aria-label={`${votes.up} feel it, ${votes.down} not really`}>
            {votes.up > 0 && <i className={s.yes}><MapIcon name="heart" size={10} />{votes.up}</i>}
            {votes.down > 0 && <i className={s.pass}><MapIcon name="drift" size={10} />{votes.down}</i>}
          </span>
        )}
        {pulse && <span key={`${pulse.name}${pulse.value}`} className={`${s.pulse} ${pulse.value > 0 ? s.pulseYes : s.pulsePass}`} style={{ ["--who" as string]: pulse.color }}><MapIcon name={pulse.value > 0 ? "heart" : "drift"} size={12} />{pulse.name} {pulse.value > 0 ? "feels it’s her" : "isn’t sure"}</span>}
        {info && (
          <div className={s.detail} onWheel={(e) => e.stopPropagation()}>
            <span className={s.tether} aria-hidden />
            <div className={`${s.detailCard} ${s.cloud}`}>{info.caption}</div>
            {(main.length > 0 || extra.length > 0) && (
              <div className={s.pills}>
                {main.map((a, i) => (
                  <button key={a.label} type="button" style={{ ["--i" as string]: i }} className={`${s.pill} ${a.tone ? s[a.tone] : ""}`} aria-pressed={a.on} disabled={a.disabled} onClick={a.run}>
                    <MapIcon name={a.icon} size={14} />{a.label}
                  </button>
                ))}
                {extra.length > 0 && (
                  <button type="button" style={{ ["--i" as string]: main.length }} className={s.pill} aria-expanded={more} aria-label="More" onClick={() => setMore((m) => !m)}><span className={s.dots} aria-hidden><i /><i /><i /></span></button>
                )}
              </div>
            )}
            {more && (
              <div className={s.moreList}>
                {extra.map((a) => (
                  <button key={a.label} type="button" aria-pressed={a.on} disabled={a.disabled} onClick={() => { setMore(false); a.run(); }}>
                    <MapIcon name={a.icon} size={15} />{a.label}
                  </button>
                ))}
              </div>
            )}
            {info.note && <p className={`${s.note} ${s.cloud}`}><MapIcon name="thread" size={14} />{info.note}</p>}
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
 * Moving around the map: hold the left button on empty sky and drag to turn
 * and tilt the view around the present; drag with the right button (or Shift)
 * to move it; scroll with two fingers to move, pinch or wheel to zoom. Keys:
 * arrows move, Q/E turn, +/− zoom, 0 recenters. A short click still reaches
 * the backdrop's click handler (it ignores anything that moved).
 */
function useMapNavigation(center: THREE.Vector3) {
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  const gl = useThree((st) => st.gl);
  const size = useThree((st) => st.size);
  const pan = useRef<{ id: number; x: number; y: number; moved: boolean; orbit: boolean } | null>(null);
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
      if (p.orbit) {
        // Grab the world and turn it: right turns it right, down tips its far side up.
        mapView.orbit(-(e.clientX - p.x) * 0.006, (e.clientY - p.y) * 0.004);
      } else {
        const k = worldPerPixel();
        // Screen-down is toward the viewer on the tilted map, which is foreshortened.
        mapView.pan(-(e.clientX - p.x) * k, -(e.clientY - p.y) * k * 1.3);
      }
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
      else if (e.key === "q" || e.key === "Q") mapView.orbit(0.2, 0);
      else if (e.key === "e" || e.key === "E") mapView.orbit(-0.2, 0);
      else if (e.key === "0") mapView.reset();
      else return;
      e.preventDefault();
    };
    // The right button moves the map, so the browser menu stays out of the way on the sky.
    const menu = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.("[data-map-token], textarea, input, a")) e.preventDefault();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    wrapper.addEventListener("wheel", wheel, { passive: false });
    wrapper.addEventListener("contextmenu", menu);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      wrapper.removeEventListener("wheel", wheel);
      wrapper.removeEventListener("contextmenu", menu);
      window.removeEventListener("keydown", key);
      mapView.dragging = false;
    };
  }, [camera, gl, size.height, center]);
  return {
    start(e: ThreeEvent<PointerEvent>) {
      const { button, shiftKey, pointerId, clientX, clientY } = e.nativeEvent;
      if (button !== 0 && button !== 2) return;
      e.nativeEvent.preventDefault();
      window.getSelection()?.removeAllRanges();
      pan.current = { id: pointerId, x: clientX, y: clientY, moved: false, orbit: button === 0 && !shiftKey };
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

/**
 * A theme's resting memories: a row of face dots perched on its cloud, one per
 * memory in the colour of who shared it. Hover reads one; click opens the
 * theme with that memory selected. Part of the theme's own label, so the
 * cloud can never cover them.
 */
function MemoryDots({ clues, onPick }: { clues: RingsWorld["clues"]; onPick(key: string): void }) {
  const [hover, setHover] = useState<string | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  // Clear the preview whenever the pointer is anywhere else, even if the dots moved or re-rendered under it.
  useEffect(() => {
    if (!hover) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setHover(null); };
    window.addEventListener("pointermove", away);
    return () => window.removeEventListener("pointermove", away);
  }, [hover]);
  if (!clues.length) return null;
  const shown = clues.slice(0, 7);
  const peek = clues.find((c) => c.key === hover);
  return (
    <span ref={root} className={s.perch} onPointerLeave={() => setHover(null)}>
      {peek && <span className={`${s.peek} ${s.cloud}`} role="tooltip"><q>{peek.text}</q><small>{peek.author}{peek.fromPhoto ? " · from a photo" : ""}</small><i className={s.trailDown} aria-hidden /></span>}
      {shown.map((c) => (
        <button key={c.key} type="button" className={s.dotFace} style={{ ["--who" as string]: c.color }} aria-label={`${c.author}'s memory: ${c.text}`}
          onPointerEnter={() => setHover(c.key)} onFocus={() => setHover(c.key)} onBlur={() => setHover(null)}
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setHover(null); onPick(c.key); }}>
          <img src={c.photo ?? portraitUrl(c.avatar)} alt="" />
        </button>
      ))}
      {clues.length > shown.length && <span className={s.perchMore}>+{clues.length - shown.length}</span>}
    </span>
  );
}

export function GiftRings({ animate }: { animate: boolean }) {
  const rings = useRings();
  return rings ? <Rings rings={rings} animate={animate} /> : null;
}

/** Zoomed in past this, every memory reads as a bubble; zoomed back out past the second, they rest as dots again. */
const CLOSE_IN = 0.72;
const CLOSE_OUT = 0.8;

function useCloseZoom() {
  const [close, setClose] = useState(false);
  const ref = useRef(close);
  useFrame(() => {
    const zoom = mapView.current.zoom;
    const next = ref.current ? zoom < CLOSE_OUT : zoom < CLOSE_IN;
    if (next !== ref.current) {
      ref.current = next;
      setClose(next);
    }
  });
  return close;
}

/** Spacing for an open theme's bubbles: across the screen, and toward or away from the viewer. */
const FAN_X = 8.8;
const FAN_Z = 4.6;
/** Open memories start this far beyond the outer ring, clear of their theme's cloud. */
const FAN_OUT = 2.2;

/**
 * Where an open theme's memories sit so their bubbles never overlap: a row
 * beyond the theme when it is above or below the present, a column when it
 * is to the side. Wide, short bubbles read best laid out this way.
 */
function fanOut(theme: { x: number; z: number }, keys: string[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const angle = Math.atan2(theme.z, theme.x / RING_STRETCH);
  const [ox, oz] = [Math.cos(angle) * (RING_RADII.input + FAN_OUT) * RING_STRETCH, Math.sin(angle) * (RING_RADII.input + FAN_OUT)];
  const side = Math.abs(Math.cos(angle)) > 0.75;
  const per = side ? 5 : 4;
  keys.forEach((key, j) => {
    const line = Math.floor(j / per);
    const inLine = Math.min(per, keys.length - line * per);
    const slot = (j % per) - (inLine - 1) / 2;
    out.set(key, side
      ? [ox + Math.sign(Math.cos(angle)) * line * FAN_X, oz + slot * FAN_Z]
      : [ox + slot * FAN_X, oz + Math.sign(Math.sin(angle) || 1) * line * FAN_Z]);
  });
  return out;
}

const researchNote = (r: RingResearch | undefined) => (r === "running" ? "Looking for gifts…" : r === "failed" ? "The search stopped · try again" : null);

function Rings({ rings, animate }: { rings: RingsWorld; animate: boolean }) {
  const center = useMemo(() => new THREE.Vector3(GIFT_SPOT.x, ringBase(), GIFT_SPOT.z), []);
  const drag = useRingDrag(center, rings.onDrag);
  const nav = useMapNavigation(center);
  const close = useCloseZoom();
  const [zone, setZone] = useState<RingZone | null>(null);
  const latest = useRef(rings);
  latest.current = rings;
  // Escape closes whatever is open, like clicking the sky.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "Escape" || (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"))) return;
      if (latest.current.selectedKey || latest.current.composer || latest.current.openTheme) latest.current.onEmpty(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
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
  const gifts = rings.gifts.filter((g) => !g.hidden);
  // While one thing is open, the rest steps back so the open card reads first.
  const focus = rings.selectedKey && rings.selectedKey !== "box" && !rings.highlight ? rings.selectedKey : null;
  const recede = (key: string) => !!focus && focus !== key;
  const openT = rings.openTheme ? rings.themes.find((t) => t.theme === rings.openTheme) : undefined;
  const fan = useMemo(
    () => (openT ? fanOut(openT, rings.clues.filter((c) => c.theme === openT.theme).map((c) => c.key)) : new Map<string, [number, number]>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openT?.theme, openT?.x, openT?.z, rings.clues.map((c) => c.key + c.theme).join()],
  );
  const open = (c: RingsWorld["clues"][number]) => close || rings.openTheme === c.theme || rings.selectedKey === c.key || lit(c.key);

  const onBackdrop = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    e.stopPropagation();
    const x = e.point.x - center.x;
    const z = e.point.z - center.z;
    if (ringDistance(x, z) < BOX_DROP_RADIUS) rings.onSelect("box");
    else rings.onEmpty(rings.selectedKey || rings.composer || rings.openTheme ? null : [x, z], zoneAt(x, z));
  };

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, center.y - 0.2, center.z]} onClick={onBackdrop} onPointerDown={nav.start}
        onPointerMove={hover} onPointerOut={() => setZone(null)}>
        <planeGeometry args={[220, 220]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <ZoneBands center={center} hover={zone} />
      <Ring center={center} radius={RING_RADII.input} label={close ? "everything shared" : undefined} glow={result === "pass" ? "#e48e88" : null} />
      <Ring center={center} radius={RING_RADII.theme} />
      <Ring center={center} radius={RING_RADII.gift} glow={result === "support" ? "#9fcf7f" : null} />
      <Ring center={center} radius={BOX_DROP_RADIUS} glow={result === "box" ? "#ffd98a" : null} />

      {rings.clues.map((c, i) => {
        // Resting memories live on their theme's cloud as face dots; only open ones float on their own.
        if (!open(c)) return null;
        const t = themeAt.get(c.theme);
        const seat: [number, number] = fan.get(c.key) ?? [c.x, c.z];
        const [x, z] = place(c.key, seat[0], seat[1]);
        return (
          <group key={c.key}>
            {t && <QuadraticBezierLine start={world(x, z, 0.4)} end={world(t[0], t[1], 0.6)} mid={world((x + t[0]) / 2, (z + t[1]) / 2, -1.2)} color={lit(c.key) ? "#ffd98a" : c.tint} lineWidth={lit(c.key) ? 3 : 1.5} transparent opacity={dim(c.key) ? 0.12 : 0.7} />}
            <RingIsland at={world(x, z)} kind="clue" delay={i * 0.04} animate={animate} muted={dim(c.key)}>
              <Suspense fallback={null}>
                <StorybookAvatar avatar={c.avatar} position={[0.35, 0.15, 0]} rotation={[0, -0.4, 0]} scale={AVATAR_WORLD_SCALE * 2.2} />
              </Suspense>
              <Token k={c.key} rings={rings} from={seat} drag={drag} dim={dim(c.key)} lift={rings.openTheme === c.theme} recede={recede(c.key) && rings.openTheme !== c.theme} offset={[0, -0.6, 2.2]} label={`${c.author}'s memory: ${c.text}`}
                face={<span className={`${s.bubble} ${s.cloud}`} style={{ ["--c" as string]: c.tint }}>{c.photo ? <img className={s.bubblePhoto} src={c.photo} alt="" /> : <img src={portraitUrl(c.avatar)} alt="" />}<q>{c.text}</q><i className={s.trail} aria-hidden />{c.fromPhoto && <i className={s.photoBadge} title="From a photo"><MapIcon name="camera" size={12} /></i>}</span>} />
            </RingIsland>
          </group>
        );
      })}

      {rings.themes.map((t, i) => {
        const [x, z] = place(t.key, t.x, t.z);
        const note = researchNote(t.research);
        const isOpen = rings.openTheme === t.theme;
        return (
          <RingIsland key={t.key} at={world(x, z)} kind="theme" delay={0.3 + i * 0.12} animate={animate} muted={dim(t.key)}>
            <Jar kind={t.jar} count={t.count} scale={2.4} position={[0, 0.2, 0]} />
            <Token k={t.key} rings={rings} from={[t.x, t.z]} drag={drag} dim={dim(t.key)} recede={recede(t.key) && !isOpen} back offset={[0, 0.2, 0.6]} label={`${t.label} theme, ${t.count} shared`}
              above={<MemoryDots clues={rings.clues.filter((c) => c.theme === t.theme && !open(c))} onPick={(key) => rings.onSelect(key)} />}
              face={
                <span className={`${s.theme} ${s.cloud} ${isOpen ? s.themeOpen : ""}`} style={{ ["--c" as string]: t.tint }}>
                  {t.research === "running" && <i className={s.spinner} aria-hidden />}
                  <b>{t.label}</b>
                  <small className={s.themeCount}>{t.count} {t.count === 1 ? "memory" : "memories"}</small>
                  {note && <em className={t.research === "failed" ? s.researchFailed : s.researchNote}>{note}</em>}
                </span>
              } />
          </RingIsland>
        );
      })}

      {gifts.map((g, i) => {
        const [x, z] = place(g.key, g.x, g.z);
        return (
          <group key={g.key}>
            {g.themes.map((theme) => {
              const t = themeAt.get(theme);
              return t ? <QuadraticBezierLine key={theme} start={world(t[0], t[1], 0.6)} end={world(x, z, 0.4)} mid={world((x + t[0]) / 2, (z + t[1]) / 2, -1.2)} color={lit(g.key) ? "#ffd98a" : "#e7c98f"} lineWidth={lit(g.key) ? 3 : 1.5} transparent opacity={dim(g.key) ? 0.1 : focus && focus !== g.key ? 0.35 : 0.75} /> : null;
            })}
            {rings.selectedListingId === g.listingId && <QuadraticBezierLine start={world(x, z, 0.4)} end={world(0, 0, 1.2)} mid={world(x / 2, z / 2, -0.6)} color="#ffd98a" lineWidth={3} />}
            <RingIsland at={world(x, z)} kind="gift" delay={0.5 + i * 0.1} animate={animate} muted={dim(g.key) || !!g.faded}>
              <Token k={g.key} rings={rings} from={[g.x, g.z]} drag={drag} dim={dim(g.key)} recede={recede(g.key)} offset={[0, -0.4, 2.2]} label={`${g.title}, ${g.price}`}
                peek={<><b>{g.title}</b><small>{g.price}{g.fixture ? " · sample" : ""}</small></>}
                face={<span className={`${s.gift} ${g.finalist ? s.finalist : ""} ${g.faded ? s.fadedGift : ""}`}>{g.imageUrl ? <img src={g.imageUrl} alt="" /> : <i aria-hidden><MapIcon name="present" size={26} /></i>}<b>{g.price}</b><em>#{g.rank}</em>{(g.up > 0 || g.down > 0) && <span className={s.votes}>{g.up > 0 && <i className={s.yes}><MapIcon name="heart" size={10} />{g.up}</i>}{g.down > 0 && <i className={s.pass}><MapIcon name="drift" size={10} />{g.down}</i>}</span>}</span>} />
            </RingIsland>
          </group>
        );
      })}
      {rings.moreGifts && rings.moreGifts.count > 0 && (
        <Html position={world(-RING_RADII.gift * RING_STRETCH - 1.5, 0, 1.2)} center zIndexRange={[25, 20]}>
          <button type="button" data-map-token className={s.moreGifts} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); rings.moreGifts?.toggle(); }}
            onPointerEnter={() => mapCursor.set("node")} onPointerLeave={() => mapCursor.set("memory")}>
            {rings.moreGifts.open ? "Show the top gifts only" : `+${rings.moreGifts.count} more ${rings.moreGifts.count === 1 ? "gift" : "gifts"}`}
          </button>
        </Html>
      )}

      {(rings.photos ?? []).map((ph, i) => {
        const shown = rings.selectedKey === ph.key || close;
        return (
          <RingIsland key={ph.key} at={world(ph.x, ph.z)} kind="clue" delay={0.2 + i * 0.1} animate={animate} size={shown ? 1 : 0.6}>
            <Token k={ph.key} rings={rings} from={[ph.x, ph.z]} drag={{ ...drag, begin: () => undefined }} dim={false} recede={recede(ph.key)} offset={[0, -0.4, 2.4]} label={`${ph.author}'s photo`}
              peek={shown ? undefined : <><b>{ph.mine ? "Your photo" : `${ph.author}’s photo`}</b><small>{ph.mine ? (ph.reading ? "reading privately…" : ph.found ? `${ph.found} guesses to review` : "everyone sees it") : "shared with the room"}</small></>}
              face={shown
                ? <span className={s.polaroidStack}>{ph.images.length ? ph.images.slice(0, 3).map((src, j) => <img key={src} src={src} alt="" style={{ ["--j" as string]: j }} />) : <i aria-hidden><MapIcon name="camera" size={30} /></i>}<em>{ph.mine ? (ph.reading ? "reading…" : ph.found ? `${ph.found} to review` : "your photo") : ph.author}</em>{ph.mine && ph.found > 0 && <b>{ph.found}</b>}</span>
                : <span className={s.photoDot}>{ph.images[0] ? <img src={ph.images[0]} alt="" /> : <i aria-hidden><MapIcon name="camera" size={18} /></i>}{ph.mine && ph.found > 0 && <b>{ph.found}</b>}</span>} />
          </RingIsland>
        );
      })}

      {rings.ideas.map((idea, i) => {
        const shown = rings.selectedKey === idea.key || close;
        const caption = idea.tag ?? `gift idea · ${idea.author}`;
        const quiet = dim(idea.key) || !!idea.faded;
        return (
          <RingIsland key={idea.key} at={world(idea.x, idea.z)} kind="gift" delay={0.4 + i * 0.1} animate={animate} muted={quiet} size={shown ? 1 : 0.6}>
            <Token k={idea.key} rings={rings} from={[idea.x, idea.z]} drag={{ ...drag, begin: () => undefined }} dim={quiet} recede={recede(idea.key)} offset={[0, -0.4, 2.2]} label={idea.tag ? `${idea.text}, ${idea.tag}` : `${idea.author}'s gift idea: ${idea.text}`}
              peek={shown ? undefined : <><b>{idea.text}</b><small>{caption}</small></>}
              face={shown
                ? <span className={`${s.idea} ${s.cloud} ${s.ideaCloud} ${idea.trend ? s.trendCloud : ""}`}>{idea.trend ? <i className={s.trendMark} aria-hidden><MapIcon name="trend" size={16} /></i> : <img src={portraitUrl(idea.avatar)} alt="" />}<span><b>{idea.text}</b><small>{caption}</small></span></span>
                : <span className={`${s.ideaDot} ${idea.trend ? s.trendDot : ""}`}>{idea.trend ? <MapIcon name="trend" size={18} /> : <img src={portraitUrl(idea.avatar)} alt="" />}{!idea.trend && <i aria-hidden><MapIcon name="spark" size={12} /></i>}</span>} />
          </RingIsland>
        );
      })}

      <group position={[center.x, center.y, center.z]}>
        <Token k="box" rings={rings} from={[0, 0]} drag={{ ...drag, begin: () => undefined }} dim={dim("box")} offset={[0, 1.2, 9]} label="Our gift box"
          face={<span className={`${s.box} ${s.cloud} ${rings.selectedKey === "box" ? s.boxOn : ""}`}>{rings.boxResearch === "running" && <i className={s.spinner} aria-hidden />}<MapIcon name="present" size={16} /><b>{rings.boxLabel}</b>{researchNote(rings.boxResearch) && <em className={rings.boxResearch === "failed" ? s.researchFailed : s.researchNote}>{researchNote(rings.boxResearch)}</em>}</span>} />
      </group>
      {rings.nextStep && rings.selectedKey !== "box" && (
        <Html position={world(0, 9, 1.2)} center zIndexRange={[26, 21]}>
          {/* Same anchor as the present's label, drawn just below it, so the two stay together from any angle. */}
          <div className={s.nextAnchor}>
          {rings.nextStep.run ? (
            <button type="button" data-map-token className={s.nextStep} disabled={rings.nextStep.disabled} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); rings.nextStep?.run?.(); }}
              onPointerEnter={() => mapCursor.set("node")} onPointerLeave={() => mapCursor.set("memory")}>
              <MapIcon name={rings.nextStep.icon} size={16} />{rings.nextStep.label}
            </button>
          ) : <span className={s.nextHint}><MapIcon name={rings.nextStep.icon} size={16} />{rings.nextStep.label}</span>}
          </div>
        </Html>
      )}

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
          <span className={s.hint}>{result === "box" ? <><MapIcon name="present" size={14} />Release to put it in the box</> : result === "support" ? <><MapIcon name="heart" size={14} />Release: it feels right</> : result === "pass" ? <><MapIcon name="drift" size={14} />Release: pass for now</> : "Toward the present supports · away passes"}</span>
        </Html>
      )}
    </group>
  );
}
