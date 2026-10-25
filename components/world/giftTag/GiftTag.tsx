"use client";

import { InkOutline } from "@/components/world/painterly/InkOutline";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { span, UNWRAP_TIMES, unwrapClock } from "@/components/unwrap/unwrapTimeline";
import { paint } from "../painterly/materials";
import { giftTagTexture } from "../painterly/textures";
import { giftTag, settleSwing, tugCurves } from "./giftTagStore";

/** Tag size in the present's local units (the present is scaled up as a whole). */
export const TAG_W = 0.4;
export const TAG_H = 0.52;
/** Cut top corners, as a fraction of the width. */
export const CHAMFER = 0.26;
/** Punched hole centre below the top edge, as a fraction of the height. */
export const HOLE_Y = 0.12;
const HOLE_R = 0.02;
const DEPTH = 0.012;
/** String from the ribbon tail down to the hole. */
export const STRING = 0.09;
export const LOOP_R = 0.014;
const INK = "#4a2c33";

/**
 * World transform of the hanging tag's body, refreshed every frame while it
 * hangs, so the flying tag (unwrap/FlyingTag) leaves from exactly here.
 */
export const hangingTag = { matrix: new THREE.Matrix4(), valid: false };

/**
 * Slightly hand-cut luggage-tag silhouette with a real punched hole; top edge
 * at y = 0. Material groups: 0 = printed front, 1 = edge, 2 = blank back.
 */
export function useTagGeometry() {
  return useMemo(() => {
    const hw = TAG_W / 2;
    const ch = TAG_W * CHAMFER;
    const r = 0.022;
    const s = new THREE.Shape();
    s.moveTo(-hw + ch, 0);
    s.lineTo(0, 0.002);
    s.lineTo(hw - ch, 0);
    s.lineTo(hw, -ch);
    s.lineTo(hw + 0.003, -TAG_H * 0.55);
    s.lineTo(hw, -TAG_H + r);
    s.quadraticCurveTo(hw, -TAG_H, hw - r, -TAG_H);
    s.lineTo(0.02, -TAG_H - 0.004);
    s.lineTo(-hw + r, -TAG_H);
    s.quadraticCurveTo(-hw, -TAG_H, -hw, -TAG_H + r);
    s.lineTo(-hw - 0.002, -TAG_H * 0.5);
    s.lineTo(-hw, -ch);
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, -TAG_H * HOLE_Y, HOLE_R, 0, Math.PI * 2, true);
    s.holes.push(hole);

    const geo = new THREE.ExtrudeGeometry(s, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 10 });
    geo.translate(0, 0, -DEPTH / 2);
    // Map the label across the tag face: u by width, v from bottom (0) to top (1).
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + hw) / TAG_W, (pos.getY(i) + TAG_H) / TAG_H);
    uv.needsUpdate = true;
    geo.computeVertexNormals();
    // Extrude writes the back cap's triangles, then the front's, as one group: split them.
    const caps = geo.groups[0]!;
    const half = caps.count / 2;
    geo.clearGroups();
    geo.addGroup(caps.start, half, 2);
    geo.addGroup(caps.start + half, half, 0);
    geo.addGroup(caps.start + caps.count, pos.count - caps.count - caps.start, 1);
    return geo;
  }, []);
}

/**
 * The parchment "Begin" tag, tied to the end of a ribbon tail. Its origin is
 * the tie point, so every swing pivots there like a real hanging tag. `yaw`
 * turns the face toward the close-up camera while it hangs off the box side.
 */
export function useTagMaterials() {
  return useMemo(() => {
    const face = paint("gift-tag-face", { map: giftTagTexture(TAG_H / TAG_W, CHAMFER, HOLE_Y), color: "#ffffff", emissive: "#ffd9a0", emissiveIntensity: 0 });
    const edge = paint("gift-tag-edge", { color: "#e6d0a6", emissive: "#ffd9a0", emissiveIntensity: 0 });
    const back = paint("gift-tag-back", { map: giftTagTexture(TAG_H / TAG_W, CHAMFER, HOLE_Y, "back"), color: "#ffffff" });
    const twine = paint("gift-tag-twine", { color: "#9a7558" });
    return { face, edge, back, twine, materials: [face, edge, back] };
  }, []);
}

export function GiftTag({ position, yaw, animate }: { position: [number, number, number]; yaw: number; animate: boolean }) {
  const swing = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const string = useRef<THREE.Mesh>(null);
  const geometry = useTagGeometry();
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef({ hover: 0, outward: 0 });
  const rootRef = useRef<THREE.Group>(null);

  const { face, edge, twine, materials } = useTagMaterials();
  const stringGeo = useMemo(() => new THREE.CylinderGeometry(0.0055, 0.0055, 1, 6).translate(0, -0.5, 0), []);
  const stringLength = STRING + TAG_H * HOLE_Y - LOOP_R;

  useEffect(() => {
    giftTag.motion = animate;
  }, [animate]);

  // Render-on-demand (reduced motion): keep frames coming while something is easing.
  useEffect(() => {
    if (animate) return;
    let raf = 0;
    let until = 0;
    const loop = () => {
      invalidate();
      raf = giftTag.busy || giftTag.state === "settling" || performance.now() < until ? requestAnimationFrame(loop) : 0;
    };
    const unsubscribe = giftTag.subscribe(() => {
      until = performance.now() + 900;
      if (!raf) loop();
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [animate, invalidate]);

  useEffect(
    () => () => {
      giftTag.setHover(false);
      document.body.style.cursor = "";
    },
    [],
  );

  useFrame(({ clock }, dt) => {
    const now = performance.now() / 1000;
    giftTag.advance(now);
    const g = swing.current;
    const b = body.current;
    const root = rootRef.current;
    if (!g || !b || !root) return;
    // Chapter 2: once the tag lets go, the flying copy takes over.
    const gone = unwrapClock.active && (unwrapClock.staticPreview || unwrapClock.t >= UNWRAP_TIMES.tagDetach);
    root.visible = !gone;
    if (gone) return;
    // As the tug turns into the detach, the string slackens.
    const slack = unwrapClock.active ? span(unwrapClock.t, 0.2, UNWRAP_TIMES.tagDetach) : 0;
    const a = anim.current;
    const step = Math.min(dt, 0.05);
    // Hover never fights the tug: it eases out while the tug plays.
    const hoverTarget = giftTag.hovered && !giftTag.busy && giftTag.state !== "hidden" ? 1 : 0;
    a.hover += (hoverTarget - a.hover) * (1 - Math.exp(-step * 9));

    const t = clock.elapsedTime;
    const { pull, swing: back, glow } = tugCurves(giftTag.tugAge(now), animate);
    const kick = settleSwing(now - giftTag.revealAt - 0.15, animate);
    // Almost still: a slow, slightly irregular pendulum.
    const idle = animate ? Math.sin(t * 1.05) * 0.022 + Math.sin(t * 0.47 + 1.3) * 0.014 : 0;
    const idleOut = animate ? Math.sin(t * 0.8 + 0.6) * 0.012 : 0;

    // rotation.z swings across the face; negative rotation.x brings the bottom out toward the viewer.
    g.rotation.z = idle + kick * 0.2 + a.hover * 0.05 + pull * 0.1 - back * 0.16;
    g.rotation.x = -0.07 + idleOut - kick * 0.12 - a.hover * 0.14 - pull * 0.42 + back * 0.22;
    // A small downward give as the string goes taut.
    const give = pull * 0.028 - a.hover * 0.006 + slack * 0.05;
    b.position.y = -STRING - give;
    if (string.current) string.current.scale.y = stringLength + give;

    // Warm highlight: a soft hover sheen, a glint as it settles, and the present's magic.
    const glint = Math.max(0, kick) * 0.35;
    face.emissiveIntensity = a.hover * 0.14 + glint + glow * 0.12;
    edge.emissiveIntensity = a.hover * 0.45 + glint + glow * 0.3;
    b.updateWorldMatrix(true, false);
    hangingTag.matrix.copy(b.matrixWorld);
    hangingTag.valid = true;
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (unwrapClock.active || (!giftTag.interactive && !giftTag.busy)) return;
    giftTag.setHover(true);
    document.body.style.cursor = "pointer";
    invalidate();
  };
  const out = () => {
    giftTag.setHover(false);
    document.body.style.cursor = "";
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (unwrapClock.active) return;
    giftTag.tug();
    invalidate();
  };

  return (
    <group ref={rootRef} position={position}>
      {/* Knot where the string is tied around the ribbon's tip. */}
      <mesh material={twine} rotation={[0, yaw, Math.PI / 2]}>
        <torusGeometry args={[0.02, 0.0065, 6, 14]} />
      </mesh>
      <group rotation={[0, yaw, 0]}>
        <group ref={swing}>
          <mesh ref={string} geometry={stringGeo} material={twine} scale={[1, stringLength, 1]} />
          <group ref={body} position={[0, -STRING, 0]}>
            {/* Loop threaded through the punched hole. */}
            <mesh material={twine} position={[0, -TAG_H * HOLE_Y, 0]} rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[LOOP_R, 0.0045, 6, 16]} />
            </mesh>
            <mesh geometry={geometry} material={materials} castShadow onPointerOver={over} onPointerOut={out} onClick={click}>
              <InkOutline weight="fine" color={INK} opacity={0.6} />
            </mesh>
            {/* Generous, invisible hit area so the small tag is easy to grab. */}
            <mesh position={[0, -TAG_H * 0.45, 0.02]} onPointerOver={over} onPointerOut={out} onClick={click}>
              <planeGeometry args={[TAG_W * 1.55, TAG_H * 1.45]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}
