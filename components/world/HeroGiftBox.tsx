"use client";

import { InkOutline } from "@/components/world/painterly/InkOutline";
import { RoundedBox } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SparkleBurst, type SparkleHandle } from "./AmbientEffects";
import { playChime } from "./chime";
import { wobble } from "./geometry";
import { paint } from "./painterly/materials";
import { giftPaperTexture, ribbonTexture } from "./painterly/textures";
import { platformTop } from "./props/Stonework";
import { createRibbonGeometry } from "./ribbon";
import { GIFT_SPOT } from "./sceneConfig";
import { GiftUnwrap, LID_OPEN_ANGLE, LID_OPEN_AT } from "./unwrap/GiftUnwrap";
import { BASE_TOP, GIFT_BOX } from "./unwrap/invitationLayout";
import { span, UNWRAP_TIMES, unwrapClock } from "@/components/unwrap/unwrapTimeline";
import { emitGiftPop } from "./worldEvents";

const W = 1.7;
const H = 1.45;
const RIBBON_W = 0.3;
const RIBBON_T = 0.03;
const INK = "#4a2c33";
/** The present is the hero: scaled up as a unit so ribbons and bow stay proportional. */
const GIFT_SCALE = 1.22;

/** Rounded-rectangle loop hugging the box in one vertical plane. */
function bandPoints(halfA: number, halfB: number, plane: "xy" | "zy"): THREE.Vector3[] {
  const r = 0.07;
  const pts: THREE.Vector3[] = [];
  const corners: [number, number, number][] = [
    [halfA - r, halfB - r, 0],
    [-(halfA - r), halfB - r, Math.PI / 2],
    [-(halfA - r), -(halfB - r), Math.PI],
    [halfA - r, -(halfB - r), (Math.PI * 3) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= 4; k++) {
      const a = a0 + (k / 4) * (Math.PI / 2);
      const u = cx + Math.cos(a) * r;
      const v = cy + Math.sin(a) * r + H / 2;
      pts.push(plane === "xy" ? new THREE.Vector3(u, v, 0) : new THREE.Vector3(0, v, u));
    }
  }
  return pts;
}

function useRibbonGeometries() {
  return useMemo(() => {
    const e1 = 0.022;
    const e2 = e1 + RIBBON_T + 0.004;
    const bandX = createRibbonGeometry(bandPoints(W / 2 + e1, H / 2 + e1, "xy"), {
      width: RIBBON_W,
      thickness: RIBBON_T,
      segments: 120,
      closed: true,
      across: () => new THREE.Vector3(0, 0, 1),
    });
    const bandZ = createRibbonGeometry(bandPoints(W / 2 + e2, H / 2 + e2, "zy"), {
      width: RIBBON_W,
      thickness: RIBBON_T,
      segments: 120,
      closed: true,
      across: () => new THREE.Vector3(1, 0, 0),
    });

    // Real bow loops sweep out and back roughly horizontally, with the
    // ribbon's width standing upright, so their broad faces meet the eye.
    const pinch = (t: number) => 0.38 + 0.62 * Math.pow(Math.sin(t * Math.PI), 0.6);
    const loopPts = (side: 1 | -1) =>
      [
        [0, 0, 0.02],
        [0.2, 0.1, 0.13],
        [0.48, 0.24, 0.17],
        [0.74, 0.33, 0.09],
        [0.8, 0.33, -0.04],
        [0.62, 0.25, -0.14],
        [0.32, 0.11, -0.12],
        [0.04, 0.0, -0.02],
      ].map(([x, y, z]) => new THREE.Vector3(x! * side, y!, z!));
    const loop = (side: 1 | -1) =>
      createRibbonGeometry(loopPts(side), {
        width: RIBBON_W * 1.3,
        thickness: RIBBON_T * 0.7,
        segments: 72,
        closed: false,
        across: () => new THREE.Vector3(-0.35 * side, 1, 0).normalize(),
        taper: pinch,
      });

    const tail = (pts: [number, number, number][], outward: THREE.Vector3) =>
      createRibbonGeometry(
        pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
        {
          width: RIBBON_W * 0.95,
          thickness: RIBBON_T * 0.8,
          segments: 50,
          across: (t, _p, tan) => {
            const normal = new THREE.Vector3(0, 1, 0).lerp(outward, THREE.MathUtils.smoothstep(t, 0.45, 0.75)).normalize();
            return new THREE.Vector3().crossVectors(tan, normal);
          },
          taper: (t) => 0.55 + 0.45 * Math.min(1, t * 4) - (t > 0.9 ? (t - 0.9) * 2 : 0),
        },
      );
    const top = H + e2 + RIBBON_T;
    const tailFront = tail(
      [
        [0.02, top + 0.02, 0.05],
        [0.2, top, 0.32],
        [0.33, top - 0.005, 0.62],
        [0.4, top - 0.06, W / 2 + e2 + 0.03],
        [0.44, top - 0.38, W / 2 + e2 + 0.04],
        [0.5, top - 0.68, W / 2 + e2 + 0.02],
      ],
      new THREE.Vector3(0, 0, 1),
    );
    const tailSide = tail(
      [
        [0.04, top + 0.02, 0.0],
        [0.32, top, -0.12],
        [0.62, top - 0.005, -0.24],
        [W / 2 + e2 + 0.03, top - 0.06, -0.3],
        [W / 2 + e2 + 0.04, top - 0.42, -0.36],
        [W / 2 + e2 + 0.02, top - 0.62, -0.46],
      ],
      new THREE.Vector3(1, 0, 0),
    );
    return { bandX, bandZ, loopL: loop(-1), loopR: loop(1), tailFront, tailSide, top };
  }, []);
}

export function HeroGiftBox({ animate, soundEnabled }: { animate: boolean; soundEnabled: boolean }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const bow = useRef<THREE.Group>(null);
  const loopL = useRef<THREE.Mesh>(null);
  const loopR = useRef<THREE.Mesh>(null);
  const bands = useRef<THREE.Group>(null);
  const tails = useRef<THREE.Group>(null);
  const sparkles = useRef<SparkleHandle>(null);
  const ribbons = useRibbonGeometries();
  const state = useRef({ hover: 0, hoverTarget: 0, popAt: -10, popPending: false, popCount: 0, spin: 1, sparkled: true });
  const baseY = platformTop();
  const invalidate = useThree((st) => st.invalidate);
  const motion = animate ? 1 : 0.25;

  const paperMat = useMemo(() => {
    const map = giftPaperTexture().clone();
    map.repeat.set(0.75, 0.75);
    map.needsUpdate = true;
    return paint("gift-paper", { map, color: "#fff7ea" });
  }, []);
  const ribbonMat = paint("gift-ribbon", { map: ribbonTexture(), color: "#ffffff" });

  // Handmade imperfection: soften the machined edges of the box a touch.
  const boxRef = useRef<THREE.Mesh>(null);
  const lidRef = useRef<THREE.Mesh>(null);
  const lidPivot = useRef<THREE.Group>(null);
  useEffect(() => {
    if (boxRef.current) wobble(boxRef.current.geometry, 0.006, 4);
    if (lidRef.current) wobble(lidRef.current.geometry, 0.005, 9);
  }, []);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
    },
    [],
  );

  useFrame(({ clock }, dt) => {
    const s = state.current;
    const t = clock.elapsedTime;
    if (s.popPending) {
      s.popPending = false;
      s.popAt = t;
    }
    const step = Math.min(dt, 0.05);
    s.hover += (s.hoverTarget - s.hover) * (1 - Math.exp(-step * 10));
    const g = body.current;
    const r = root.current;
    if (!g || !r) return;

    const breathe = animate ? Math.sin(t * 1.7) * 0.012 : 0;
    let sy = 1 + breathe + s.hover * 0.025;
    let sxz = 1 - breathe * 0.5 + s.hover * 0.02;
    let lift = (animate ? (Math.sin(t * 1.1) + 1) * 0.02 : 0) + s.hover * 0.06;
    let spin = 0;
    let flap = 0;

    const age = t - s.popAt;
    if (age >= 0 && age < 1.25) {
      if (age < 0.12) {
        // Anticipation: crouch.
        const k = age / 0.12;
        sy *= 1 - 0.1 * k;
        sxz *= 1 + 0.06 * k;
      } else if (age < 0.6) {
        const k = (age - 0.12) / 0.48;
        if (!s.sparkled) {
          s.sparkled = true;
          sparkles.current?.burst(new THREE.Vector3(GIFT_SPOT.x, baseY + (H + 0.4) * GIFT_SCALE, GIFT_SPOT.z), s.popCount);
        }
        lift += Math.sin(k * Math.PI) * 0.55 * motion;
        sy *= 1 + 0.08 * Math.sin(k * Math.PI);
        sxz *= 1 - 0.04 * Math.sin(k * Math.PI);
        spin = Math.sin(k * Math.PI) * 0.22 * s.spin * motion;
      } else {
        // Land, squash, and settle with a damped wobble.
        const k = age - 0.6;
        const settle = Math.exp(-k * 6) * Math.cos(k * 22);
        sy *= 1 - 0.09 * settle;
        sxz *= 1 + 0.05 * settle;
      }
      flap = Math.exp(-age * 2.5) * Math.sin(age * 18) * 0.35;
    }
    // --- Create-a-room transformation (see unwrap/GiftUnwrap). ----------
    // Everything is a function of the sequence clock, so closing simply
    // rewinds it. Anticipation lifts and loosens the present; it is set back
    // down, the bow unties and drops to the pedestal, the ribbon slips off and
    // lies flat around the box, then the lid hinges open at the back.
    const u = unwrapClock;
    const unwrapping = u.active && !u.staticPreview;
    const ut = unwrapping ? u.t : 0;
    const antic = span(ut, UNWRAP_TIMES.giftAnticipation, UNWRAP_TIMES.unwrapping);
    const setDown = span(ut, UNWRAP_TIMES.unwrapping, UNWRAP_TIMES.unwrapping + 0.45);
    const untie = span(ut, UNWRAP_TIMES.unwrapping, UNWRAP_TIMES.unwrapping + 0.55);
    const slip = span(ut, UNWRAP_TIMES.unwrapping + 0.15, LID_OPEN_AT);
    const spread = span(ut, LID_OPEN_AT, LID_OPEN_AT + 0.5);
    if (unwrapping) {
      sy = sxz = 1;
      spin = 0;
      lift = antic * (1 - setDown) * 0.35 + Math.sin(t * 2.4) * 0.03 * antic * (1 - setDown);
    }
    g.scale.set(sxz, sy, sxz);
    r.position.y = baseY + lift;
    r.rotation.y = -0.38 + spin + (animate && !unwrapping ? Math.sin(t * 0.5) * 0.02 : 0);
    if (lidPivot.current) {
      // A soft overshoot as it swings open, then it rests at ~115°.
      const open = span(ut, LID_OPEN_AT, LID_OPEN_AT + 0.7);
      lidPivot.current.rotation.x = -LID_OPEN_ANGLE * (1 + 1.8 * Math.pow(open - 1, 3) + 0.8 * Math.pow(open - 1, 2));
    }

    if (bands.current) {
      // Loosen, slip down to lie flat around the box, and relax outward a little.
      const loose = 1 + antic * 0.03 + slip * 0.06 + spread * 0.2;
      bands.current.scale.set(loose, Math.max(0.01, 1 - slip * 0.99), loose);
      bands.current.position.y = slip * 0.012;
    }
    if (tails.current) {
      // Tails drop with the knot and lie on the floor.
      tails.current.position.y = ribbons.top * (1 - slip) + 0.015 * slip;
      tails.current.scale.set(1 + spread * 0.25, Math.max(0.012, 1 - slip * 0.988), 1 + spread * 0.25);
    }

    const sway = animate ? Math.sin(t * 2.1) * 0.03 : 0;
    const wiggle = Math.sin(t * 13) * 0.14 * antic * (1 - untie);
    const unfurl = untie * 0.75;
    if (loopL.current) loopL.current.rotation.z = -sway - flap - s.hover * 0.08 - wiggle - unfurl;
    if (loopR.current) loopR.current.rotation.z = sway + flap + s.hover * 0.08 + wiggle + unfurl;
    if (bow.current) {
      bow.current.scale.setScalar(1 + s.hover * 0.04 + Math.abs(flap) * 0.15);
      // A little hop as it comes loose, then it tumbles down beside the box.
      const hop = Math.sin(Math.min(1, untie * 1.6) * Math.PI) * 0.45;
      const fall = span(ut, UNWRAP_TIMES.unwrapping + 0.3, UNWRAP_TIMES.unwrapping + 0.85);
      bow.current.position.set(1.0 * fall, (ribbons.top + 0.02 + hop) * (1 - fall) + 0.05 * fall, 0.8 * fall);
      bow.current.rotation.set(-1.25 * fall, 0.55 + fall * 1.4, 0.2 * fall);
    }
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (unwrapClock.active) return;
    state.current.hoverTarget = 1;
    document.body.style.cursor = "pointer";
    invalidate();
  };
  const onOut = () => {
    state.current.hoverTarget = 0;
    document.body.style.cursor = "";
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (unwrapClock.active) return;
    const s = state.current;
    s.popPending = true;
    s.popCount++;
    s.spin = s.popCount % 2 ? 1 : -1;
    s.sparkled = false;
    if (soundEnabled) playChime(s.popCount);
    emitGiftPop();
    if (!animate) {
      // Render-on-demand mode: keep frames coming just long enough for the pop.
      const until = performance.now() + 1400;
      const tick = () => {
        invalidate();
        if (performance.now() < until) requestAnimationFrame(tick);
      };
      tick();
    }
  };

  return (
    <>
      <group ref={root} position={[GIFT_SPOT.x, baseY, GIFT_SPOT.z]} rotation={[0, -0.38, 0]} scale={GIFT_SCALE} userData={{ sketch: 4, sketchRegion: true }}>
        <group ref={body} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick}>
          {/* A real box and lid: the lid is what opens. */}
          <RoundedBox ref={boxRef} args={[W, BASE_TOP + 0.02, W]} radius={0.05} smoothness={4} position={[0, (BASE_TOP + 0.02) / 2, 0]} material={paperMat} castShadow receiveShadow>
            <InkOutline weight="medium" color={INK} />
          </RoundedBox>
          <group ref={lidPivot} position={[0, BASE_TOP, (-W * GIFT_BOX.lidOverhang) / 2]}>
            <RoundedBox
              ref={lidRef}
              args={[W * GIFT_BOX.lidOverhang, GIFT_BOX.lidHeight, W * GIFT_BOX.lidOverhang]}
              radius={0.05}
              smoothness={4}
              position={[0, GIFT_BOX.lidHeight / 2, (W * GIFT_BOX.lidOverhang) / 2]}
              material={paperMat}
              castShadow
              receiveShadow
            >
              <InkOutline weight="medium" color={INK} />
            </RoundedBox>
          </group>
          <group ref={bands}>
            <mesh geometry={ribbons.bandX} material={ribbonMat} castShadow receiveShadow />
            <mesh geometry={ribbons.bandZ} material={ribbonMat} castShadow receiveShadow />
          </group>
          <group ref={tails} position={[0, ribbons.top, 0]}>
            <group position={[0, -ribbons.top, 0]}>
              <mesh geometry={ribbons.tailFront} material={ribbonMat} castShadow receiveShadow>
                <InkOutline weight="fine" color={INK} />
              </mesh>
              <mesh geometry={ribbons.tailSide} material={ribbonMat} castShadow receiveShadow>
                <InkOutline weight="fine" color={INK} />
              </mesh>
            </group>
          </group>
          <group ref={bow} position={[0, ribbons.top + 0.02, 0]} rotation={[0, 0.55, 0]}>
            <mesh ref={loopL} geometry={ribbons.loopL} material={ribbonMat} castShadow>
              <InkOutline weight="fine" color={INK} />
            </mesh>
            <mesh ref={loopR} geometry={ribbons.loopR} material={ribbonMat} castShadow>
              <InkOutline weight="fine" color={INK} />
            </mesh>
            <mesh position={[0, 0.03, 0]} scale={[0.15, 0.12, 0.17]} material={paint("gift-knot", { color: "#e48572" })} castShadow>
              <sphereGeometry args={[1, 16, 12]} />
              <InkOutline weight="fine" color={INK} />
            </mesh>
            {/* A tiny gold charm tied at the knot. */}
            <mesh position={[0.05, 0.02, 0.19]} rotation={[0.3, 0, 0.4]} material={paint("gold", { color: "#e2bd6b", emissive: "#7a5a20", emissiveIntensity: 0.25 })}>
              <octahedronGeometry args={[0.055, 0]} />
            </mesh>
          </group>
        </group>
      </group>
      <SparkleBurst ref={sparkles} />
      <GiftUnwrap bodyRef={body} />
    </>
  );
}
