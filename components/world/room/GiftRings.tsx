"use client";

import { Html, QuadraticBezierLine } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type PointerEvent as ReactPointerEvent, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { AVATAR_WORLD_SCALE, type AvatarId, StorybookAvatar } from "@/components/characters/StorybookAvatar";
import { BOX_DROP_RADIUS, dragResult, RING_RADII, RING_STRETCH, ringDistance, type RingDragResult, type RingTheme } from "@/lib/map/rings";
import { portraitUrl } from "@/lib/room/avatars";
import { IslandMesh } from "../FloatingIsland";
import { FAR_PALETTE, MID_PALETTE } from "../islands/shared";
import { GIFT_SPOT } from "../sceneConfig";
import type { IslandShape } from "../terrain";
import { Jar } from "./TowerInterior";
import { ringBase } from "./stageLayout";
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
  clues: { key: string; text: string; author: string; avatar: AvatarId; theme: RingTheme; x: number; z: number }[];
  themes: { key: string; theme: RingTheme; label: string; count: number; x: number; z: number }[];
  gifts: { key: string; listingId: string; title: string; price: string; imageUrl?: string; themes: RingTheme[]; x: number; z: number; rank: number; up: number; down: number; fixture: boolean }[];
  selectedListingId?: string;
  boxLabel: string;
  selectedKey: string | null;
  /** “Why this?”: keys on the path to the chosen gift. Everything else dims. */
  highlight?: ReadonlySet<string> | null;
  composer?: { x: number; z: number; node: ReactNode } | null;
  onSelect(key: string | null): void;
  /** A click on empty sky, as an offset from the present; null closes whatever is open. */
  onEmpty(point: [number, number] | null): void;
  onDrag(key: string, result: RingDragResult): void;
  actionsFor(key: string): { caption: ReactNode; actions: RingAction[] } | null;
}

const JAR_OF: Record<RingTheme, "interest" | "wish" | "moment"> = { interest: "interest", wish: "wish", moment: "moment" };
const THEME_TINT: Record<RingTheme, string> = { interest: "#a9cde6", wish: "#f2d27a", moment: "#f3b9c4" };
const SHAPES: Record<"clue" | "theme" | "gift", IslandShape> = {
  clue: { seed: 303, radius: 1.35, stretch: 1.12, depth: 2.2, hilliness: 0.3 },
  theme: { seed: 317, radius: 2.1, stretch: 1.1, depth: 3.1, hilliness: 0.25 },
  gift: { seed: 331, radius: 1.5, stretch: 1.08, depth: 2.4, hilliness: 0.2 },
};
const DETAIL = { rings: 8, segments: 44, layers: 9 };

type Kind = "clue" | "theme" | "gift";
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
    <group ref={group} position={at.clone().setY(at.y - 3)}>
      <IslandMesh shape={SHAPES[kind]} palette={palette} detail={DETAIL} />
      {children}
    </group>
  );
}

function Token({ k, rings, from, drag, face, label, offset, dim }: { k: string; rings: RingsWorld; from: [number, number]; drag: ReturnType<typeof useRingDrag>; face: ReactNode; label: string; offset: [number, number, number]; dim: boolean }) {
  const selected = rings.selectedKey === k;
  const info = selected ? rings.actionsFor(k) : null;
  return (
    <Html position={offset} center zIndexRange={selected ? [60, 50] : [20, 0]}>
      <div className={`${s.token} ${selected ? s.on : ""} ${dim ? s.dim : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={s.face} aria-label={label} aria-expanded={selected}
          onPointerDown={(e) => drag.begin(k, from, e)}
          onClick={() => drag.clickable(k) && rings.onSelect(selected ? null : k)}>
          {face}
        </button>
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

export function GiftRings({ rings, animate }: { rings: RingsWorld; animate: boolean }) {
  const center = useMemo(() => new THREE.Vector3(GIFT_SPOT.x, ringBase(), GIFT_SPOT.z), []);
  const drag = useRingDrag(center, rings.onDrag);
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
    else rings.onEmpty(rings.selectedKey || rings.composer ? null : [x, z]);
  };

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, center.y - 0.2, center.z]} onClick={onBackdrop}>
        <planeGeometry args={[220, 220]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Ring center={center} radius={RING_RADII.input} label="everything shared" glow={result === "pass" ? "#e48e88" : null} />
      <Ring center={center} radius={RING_RADII.theme} label={rings.themes.length ? "themes" : undefined} />
      <Ring center={center} radius={RING_RADII.gift} label={rings.gifts.length ? "gift ideas" : undefined} glow={result === "support" ? "#9fcf7f" : null} />
      <Ring center={center} radius={BOX_DROP_RADIUS} glow={result === "box" ? "#ffd98a" : null} />

      {rings.clues.map((c, i) => {
        const [x, z] = place(c.key, c.x, c.z);
        const t = themeAt.get(c.theme);
        return (
          <group key={c.key}>
            {t && <QuadraticBezierLine start={world(x, z, 0.4)} end={world(t[0], t[1], 0.6)} mid={world((x + t[0]) / 2, (z + t[1]) / 2, -1.2)} color={lit(c.key) ? "#ffd98a" : THEME_TINT[c.theme]} lineWidth={lit(c.key) ? 3 : 1.5} transparent opacity={dim(c.key) ? 0.12 : 0.7} />}
            <RingIsland at={world(x, z)} kind="clue" delay={i * 0.06} animate={animate} muted={dim(c.key)}>
              <Suspense fallback={null}>
                <StorybookAvatar avatar={c.avatar} position={[0.35, 0.15, 0]} rotation={[0, -0.4, 0]} scale={AVATAR_WORLD_SCALE * 2.2} />
              </Suspense>
              <Token k={c.key} rings={rings} from={[c.x, c.z]} drag={drag} dim={dim(c.key)} offset={[0, -0.6, 2.2]} label={`${c.author}'s memory`}
                face={<span className={s.bubble} style={{ ["--c" as string]: THEME_TINT[c.theme] }}><img src={portraitUrl(c.avatar)} alt="" /><q>{c.text}</q></span>} />
            </RingIsland>
          </group>
        );
      })}

      {rings.themes.map((t, i) => {
        const [x, z] = place(t.key, t.x, t.z);
        return (
          <RingIsland key={t.key} at={world(x, z)} kind="theme" delay={0.3 + i * 0.12} animate={animate} muted={dim(t.key)}>
            <Jar kind={JAR_OF[t.theme]} count={t.count} scale={2.4} position={[0, 0.2, 0]} />
            <Token k={t.key} rings={rings} from={[t.x, t.z]} drag={drag} dim={dim(t.key)} offset={[0, -0.8, 3]} label={`${t.label} theme`}
              face={<span className={s.theme} style={{ ["--c" as string]: THEME_TINT[t.theme] }}><b>{t.label}</b><small>{t.count} shared</small></span>} />
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
            <RingIsland at={world(x, z)} kind="gift" delay={0.5 + i * 0.1} animate={animate} muted={dim(g.key)}>
              <Token k={g.key} rings={rings} from={[g.x, g.z]} drag={drag} dim={dim(g.key)} offset={[0, -0.4, 2.2]} label={g.title}
                face={<span className={s.gift}>{g.imageUrl ? <img src={g.imageUrl} alt="" /> : <i aria-hidden>🎁</i>}<b>{g.price}</b><em>#{g.rank}</em>{(g.up > 0 || g.down > 0) && <span className={s.votes}>{g.up > 0 && <i className={s.yes}>♥ {g.up}</i>}{g.down > 0 && <i className={s.pass}>✕ {g.down}</i>}</span>}</span>} />
            </RingIsland>
          </group>
        );
      })}

      <group position={[center.x, center.y, center.z]}>
        <Token k="box" rings={rings} from={[0, 0]} drag={{ ...drag, begin: () => undefined }} dim={dim("box")} offset={[0, 1.2, 9]} label="Our gift box"
          face={<span className={s.box}>🎁 <b>{rings.boxLabel}</b></span>} />
      </group>

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
