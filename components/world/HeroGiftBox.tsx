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
import { BASE_TOP, BOX_SHELL, GIFT_BOX } from "./unwrap/invitationLayout";
import { FlyingTag } from "./unwrap/FlyingTag";
import { GiftUnwrap, LID_OPEN_ANGLE } from "./unwrap/GiftUnwrap";
import { LobbySpirits } from "./unwrap/LobbySpirits";
import { RIBBON_SWAP, RibbonUnravel } from "./unwrap/RibbonUnravel";
import { progress, span, UNWRAP_TIMES, unwrapClock } from "@/components/unwrap/unwrapTimeline";
import { convergence } from "@/components/convergence/convergenceClock";
import { type Artifact, buildArtifacts, filledAt } from "@/lib/convergence/artifacts";
import { type GiftChoreography, giftChoreography, smoother, span as cspan } from "@/lib/convergence/timeline";
import { GiftConvergence } from "./convergence/GiftConvergence";
import { emitGiftPop } from "./worldEvents";
import { GiftTag } from "./giftTag/GiftTag";
import { giftTag, settleSwing, tugCurves, useGiftTagEnabled } from "./giftTag/giftTagStore";

const W = 1.7;
const H = 1.45;
const RIBBON_W = 0.3;
const RIBBON_T = 0.03;
const INK = "#4a2c33";
/** The present is the hero: scaled up as a unit so ribbons and bow stay proportional. */
const GIFT_SCALE = 1.22;
/** Turns the hanging tag's face from the box side toward the opening close-up. */
const TAG_YAW = 1.12;
const GLOW = new THREE.Color("#ffcf7a");
/** Wall thickness of the hollow box and lid that replace the solid ones as the lid opens. */
const SHELL = BOX_SHELL;
const LID_W = W * GIFT_BOX.lidOverhang;
const LINER = "#f2c9bb";
type V3 = [number, number, number];
/** All four walls fold down flat, hinged at the floor's edges, like a box opened out into its net. */
const WALL_FOLD = THREE.MathUtils.degToRad(87);
const WALL_LINER_H = BASE_TOP - SHELL;
const WALLS: { pivot: V3; offset: V3; size: V3; liner: V3; linerYaw: number; linerW: number; axis: "x" | "z"; dir: 1 | -1 }[] = [
  { pivot: [0, 0, W / 2], offset: [0, BASE_TOP / 2, -SHELL / 2], size: [W, BASE_TOP, SHELL], liner: [0, (BASE_TOP + SHELL) / 2, -SHELL - 0.002], linerYaw: 0, linerW: W - 2 * SHELL, axis: "x", dir: 1 },
  { pivot: [0, 0, -W / 2], offset: [0, BASE_TOP / 2, SHELL / 2], size: [W, BASE_TOP, SHELL], liner: [0, (BASE_TOP + SHELL) / 2, SHELL + 0.002], linerYaw: 0, linerW: W - 2 * SHELL, axis: "x", dir: -1 },
  { pivot: [W / 2, 0, 0], offset: [-SHELL / 2, BASE_TOP / 2, 0], size: [SHELL, BASE_TOP, W - 2 * SHELL], liner: [-SHELL - 0.002, (BASE_TOP + SHELL) / 2, 0], linerYaw: Math.PI / 2, linerW: W - 2 * SHELL, axis: "z", dir: -1 },
  { pivot: [-W / 2, 0, 0], offset: [SHELL / 2, BASE_TOP / 2, 0], size: [SHELL, BASE_TOP, W - 2 * SHELL], liner: [SHELL + 0.002, (BASE_TOP + SHELL) / 2, 0], linerYaw: Math.PI / 2, linerW: W - 2 * SHELL, axis: "z", dir: 1 },
];
const BACK_WALL = 1;
/** A wall falling open: gathers speed like it's tipping over, then a small bounce as it lands. */
const flop = (k: number) => (k <= 0 ? 0 : k < 0.8 ? (k / 0.8) ** 2 : 1 - 0.07 * Math.sin(((k - 0.8) / 0.2) * Math.PI));
/** The open lid, in the hinge's frame: a top and four skirts, open underneath. */
const LID_H = GIFT_BOX.lidHeight;
const LID_SHELL: [V3, V3][] = [
  [[0, LID_H - SHELL / 2, LID_W / 2], [LID_W, SHELL, LID_W]],
  [[0, LID_H / 2, LID_W - SHELL / 2], [LID_W, LID_H, SHELL]],
  [[0, LID_H / 2, SHELL / 2], [LID_W, LID_H, SHELL]],
  [[LID_W / 2 - SHELL / 2, LID_H / 2, LID_W / 2], [SHELL, LID_H, LID_W - 2 * SHELL]],
  [[-LID_W / 2 + SHELL / 2, LID_H / 2, LID_W / 2], [SHELL, LID_H, LID_W - 2 * SHELL]],
];

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
    // The side tail hangs over the box's right edge; the "Begin" tag is tied to its tip.
    const tailPivot: [number, number, number] = [W / 2 + e2 + 0.03, top - 0.06, -0.3];
    const tagAnchor: [number, number, number] = [W / 2 + e2 + 0.035 - tailPivot[0], top - 0.6 - tailPivot[1], -0.45 - tailPivot[2]];
    return { bandX, bandZ, loopL: loop(-1), loopR: loop(1), tailFront, tailSide, top, tailPivot, tagAnchor };
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
  const sideTail = useRef<THREE.Group>(null);
  const bandXMesh = useRef<THREE.Mesh>(null);
  const bandZMesh = useRef<THREE.Mesh>(null);
  const tailFrontMesh = useRef<THREE.Mesh>(null);
  const tailSideMesh = useRef<THREE.Mesh>(null);
  const convCache = useRef<{ run: number; artifacts: Artifact[] }>({ run: -1, artifacts: [] });
  const convWas = useRef(false);
  const tagEnabled = useGiftTagEnabled();
  const tagTug = useRef(0);
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
  const linerMat = paint("gift-liner", { color: LINER, side: THREE.DoubleSide });
  // Both start dark; the tag's tug drives their intensity for the warm magic glow.
  useEffect(() => {
    paperMat.emissive.copy(GLOW);
    paperMat.emissiveIntensity = 0;
    ribbonMat.emissive.copy(GLOW);
    ribbonMat.emissiveIntensity = 0;
    linerMat.emissive.copy(GLOW);
    linerMat.emissiveIntensity = 0;
  }, [paperMat, ribbonMat, linerMat]);

  // Handmade imperfection: soften the machined edges of the box a touch.
  const boxRef = useRef<THREE.Mesh>(null);
  const lidRef = useRef<THREE.Mesh>(null);
  const lidPivot = useRef<THREE.Group>(null);
  const hollowBox = useRef<THREE.Group>(null);
  const hollowLid = useRef<THREE.Group>(null);
  const wallPivots = useRef<(THREE.Group | null)[]>([]);
  const wallShells = useRef<(THREE.Group | null)[]>([]);
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

  // Render-on-demand (reduced motion): redraw for a moment whenever chapter 2 changes state.
  useEffect(() => {
    if (animate) return;
    let raf = 0;
    let until = 0;
    const loop = () => {
      invalidate();
      raf = performance.now() < until ? requestAnimationFrame(loop) : 0;
    };
    const kick = () => {
      until = performance.now() + 700;
      if (!raf) loop();
    };
    const offs = [unwrapClock.subscribe(kick), convergence.subscribe(kick)];
    return () => offs.forEach((off) => off());
  }, [animate, invalidate]);

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
    // --- The "Begin" tag's tug (see giftTag/). ----------------------------
    // A dip and a small hop, the ribbon flexing, and a warm glow; never an unwrap.
    const now = performance.now() / 1000;
    const tug = tugCurves(tagEnabled ? giftTag.tugAge(now) : Infinity, animate);
    lift += tug.hop * 0.07;
    sy *= 1 + Math.min(0, tug.hop) * 0.12 + Math.max(0, tug.hop) * 0.02;
    sxz *= 1 - Math.min(0, tug.hop) * 0.06;
    flap += tug.ribbon * 0.22;
    if (tug.sparkle && tagTug.current !== giftTag.tugCount) {
      tagTug.current = giftTag.tugCount;
      if (animate) sparkles.current?.burst(new THREE.Vector3(GIFT_SPOT.x, baseY + (H + 0.3) * GIFT_SCALE, GIFT_SPOT.z), giftTag.tugCount);
      if (soundEnabled) playChime(giftTag.tugCount);
      emitGiftPop();
    }
    ribbonMat.emissiveIntensity = tug.glow * 0.2;
    paperMat.emissiveIntensity = tug.glow * 0.08;
    const warm = convergence.active ? giftChoreography(convergence.t, filledAt(convCache.current.artifacts, convergence.t)).glow : 0;
    if (warm > 0) {
      ribbonMat.emissiveIntensity = Math.max(ribbonMat.emissiveIntensity, warm * 0.3);
      paperMat.emissiveIntensity = Math.max(paperMat.emissiveIntensity, warm * 0.1);
    }
    linerMat.emissiveIntensity = warm * 0.4;
    if (sideTail.current) {
      // The tail lifts away from the box as the tag pulls on it, and ripples when the tag first swings.
      const kick = settleSwing(now - giftTag.revealAt, animate);
      sideTail.current.rotation.z = tug.pull * 0.09 + tug.ribbon * 0.05 + kick * 0.05 + (giftTag.hovered && !giftTag.busy ? 0.015 : 0);
    }

    // --- Chapter 2: the gift awakens (see unwrap/). ----------------------
    // All a function of the shared clock. The pulled tail swings out and the
    // bow collapses into the knot; the bands hand over to the unravelling
    // strip (RibbonUnravel); the lid lifts and dissolves into sparkles; the
    // four walls fold out like petals around the tree (QrTree).
    const u = unwrapClock;
    const chapter = u.active;
    const ut = chapter ? u.t : 0;
    if (chapter) {
      sy = 1 + Math.min(0, tug.hop) * 0.12;
      sxz = 1 - Math.min(0, tug.hop) * 0.06;
      spin = 0;
      lift = tug.hop * 0.07;
    }

    // --- The Great Gift Convergence (see convergence/): open, receive, close, wrap, rise, shake, burst. ---
    let cv: GiftChoreography | null = null;
    if (convergence.active && !chapter) {
      if (convCache.current.run !== convergence.run) convCache.current = { run: convergence.run, artifacts: buildArtifacts(convergence.inputs).artifacts };
      cv = giftChoreography(convergence.t, filledAt(convCache.current.artifacts, convergence.t));
      // Once the reveal is closed the present comes back, wrapped, to its pedestal.
      const back = convergence.leaving ? smoother(cspan(convergence.exit, 0.35, 1.15)) : 0;
      const presence = convergence.leaving ? back : cv.presence;
      sy = cv.scaleY * presence;
      sxz = cv.scaleXZ * presence;
      lift = convergence.leaving ? 0 : cv.lift;
      spin = 0;
    }
    convWas.current = !!cv;
    r.visible = !cv || sy > 0.002;
    g.scale.set(sxz, sy, sxz);
    r.position.set(GIFT_SPOT.x + (cv && !convergence.leaving ? cv.shakeX : 0), baseY + lift, GIFT_SPOT.z + (cv && !convergence.leaving ? cv.shakeZ : 0));
    r.rotation.set(cv && !convergence.leaving ? cv.tiltX : 0, -0.38 + spin + (animate && !chapter && !cv ? Math.sin(t * 0.5) * 0.02 : 0), cv && !convergence.leaving ? cv.tiltZ : 0);

    const wrapped = !chapter || ut < RIBBON_SWAP;
    const collapse = span(ut, UNWRAP_TIMES.ribbonPull, RIBBON_SWAP);
    // The convergence unties the ribbon, then winds it back on: each part is drawn progressively along its path.
    const rb = cv ? cv.ribbon : null;
    const reveal = (mesh: THREE.Mesh | null, frac: number, segments: number) => {
      if (!mesh) return;
      mesh.visible = frac > 0.002;
      mesh.geometry.setDrawRange(0, frac >= 0.999 ? Infinity : Math.floor(frac * segments) * 24);
    };
    if (rb) {
      reveal(bandXMesh.current, rb.bandX, 120);
      reveal(bandZMesh.current, rb.bandZ, 120);
      reveal(tailFrontMesh.current, rb.tails, 50);
      reveal(tailSideMesh.current, rb.tails, 50);
    } else {
      for (const [m] of [[bandXMesh.current], [bandZMesh.current], [tailFrontMesh.current], [tailSideMesh.current]] as const) {
        if (m && m.geometry.drawRange.count !== Infinity) m.geometry.setDrawRange(0, Infinity);
        if (m) m.visible = true;
      }
    }
    if (bands.current) bands.current.visible = wrapped;
    if (tails.current) {
      tails.current.visible = wrapped;
      tails.current.scale.set(1, Math.max(0.01, 1 - collapse * 0.85), 1);
    }
    if (sideTail.current && chapter) sideTail.current.rotation.z += span(ut, UNWRAP_TIMES.ribbonPull - 0.15, RIBBON_SWAP) * 1.1;

    // The lid hinges open at the back with a soft overshoot and rests at ~115°.
    // Under it, the solid box and lid give way to hollow shells (same outside).
    // Then every wall folds down flat; the lid, hinged to the back wall, rides
    // down with it and settles flat beyond it, hollow side up.
    const open = span(ut, UNWRAP_TIMES.lidOpen[0], UNWRAP_TIMES.lidOpen[1]);
    // The convergence reuses the same hollow shells, folding them down to receive the memories and back up again.
    const hollow = cv ? cv.hollow && !convergence.leaving : chapter && ut >= UNWRAP_TIMES.lidOpen[0];
    if (boxRef.current) boxRef.current.visible = !hollow;
    if (lidRef.current) lidRef.current.visible = !hollow;
    if (hollowBox.current) hollowBox.current.visible = hollow;
    if (hollowLid.current) hollowLid.current.visible = hollow;
    let backFold = cv ? cv.backFold : 0;
    WALLS.forEach((w, i) => {
      const shell = wallShells.current[i];
      if (shell) shell.visible = hollow;
      const pivot = wallPivots.current[i];
      if (!pivot) return;
      let fold: number;
      if (cv) {
        fold = cv.wall[i]!;
      } else {
        const k = progress(ut, UNWRAP_TIMES.wallsFold[0] + i * 0.07, UNWRAP_TIMES.wallsFold[1] - (3 - i) * 0.05);
        if (i === BACK_WALL) backFold = span(k, 0, 0.8);
        fold = flop(k);
      }
      const a = WALL_FOLD * fold * w.dir;
      pivot.rotation.set(w.axis === "x" ? a : 0, 0, w.axis === "z" ? a : 0);
      // At the burst each wall (and the lid riding the back one) is flung outward from the centre.
      const out = cv ? 1 - Math.pow(1 - cv.burst, 3) : 0;
      const len = Math.hypot(w.pivot[0], w.pivot[2]) || 1;
      pivot.position.set(w.pivot[0] + (w.pivot[0] / len) * out * 3.2, w.pivot[1] + Math.sin(out * Math.PI) * 0.5 + out * 0.3, w.pivot[2] + (w.pivot[2] / len) * out * 3.2);
    });
    const lidAngle = LID_OPEN_ANGLE * (cv ? cv.lid : 1 + 1.8 * Math.pow(open - 1, 3) + 0.8 * Math.pow(open - 1, 2));
    if (lidPivot.current) lidPivot.current.rotation.x = -THREE.MathUtils.lerp(lidAngle, Math.PI / 2, backFold);

    if (hollowBox.current) {
      // The floor rises and swells away, and the ribbon is carried up and out with the burst.
      const out = cv ? 1 - Math.pow(1 - cv.burst, 3) : 0;
      hollowBox.current.position.y = out * 1.2;
      hollowBox.current.scale.setScalar(1 + out * 0.6);
      if (cv && cv.burst > 0) {
        if (bands.current) bands.current.visible = cv.burst < 0.5;
        if (tails.current) tails.current.visible = cv.burst < 0.5;
        if (bands.current) bands.current.scale.setScalar(1 + out * 0.7);
        if (tails.current) tails.current.position.y = ribbons.top + out * 0.6;
      } else if (bands.current) {
        bands.current.scale.setScalar(1);
        if (tails.current) tails.current.position.y = ribbons.top;
      }
    }

    const sway = animate ? Math.sin(t * 2.1) * 0.03 : 0;
    const unfurl = rb ? (1 - Math.min(1, rb.bow)) * 0.9 + (cv && convergence.t >= 9 ? cv.sweep * 0.8 : 0) : collapse * 0.9;
    if (loopL.current) loopL.current.rotation.z = -sway - flap - s.hover * 0.08 - unfurl;
    if (loopR.current) loopR.current.rotation.z = sway + flap + s.hover * 0.08 + unfurl;
    if (bow.current) {
      bow.current.visible = wrapped && (!rb || rb.bow > 0.002);
      // Loops fold down into the knot as the ribbon is pulled through it.
      bow.current.scale.setScalar(Math.max(0.0001, (1 + s.hover * 0.04 + Math.abs(flap) * 0.15) * (rb ? Math.max(0, rb.bow) : 1 - collapse * 0.92)));
      bow.current.position.set(0, ribbons.top + 0.02 + Math.sin(collapse * Math.PI) * 0.06, 0);
      bow.current.rotation.set(0, 0.55 + collapse * 0.8 + (cv ? cv.burst * 3 : 0), 0);
      if (cv && cv.burst > 0) {
        bow.current.position.y += (1 - Math.pow(1 - cv.burst, 3)) * 2.2;
        bow.current.visible = cv.burst < 0.8;
      }
    }
  });

  // On the title screen the tag is the one thing to touch; the box itself stays put.
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (unwrapClock.active || giftTag.enabled) return;
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
    if (unwrapClock.active || giftTag.enabled) return;
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
          <group ref={hollowBox} visible={false}>
            <mesh material={paperMat} position={[0, SHELL / 2, 0]} receiveShadow>
              <boxGeometry args={[W, SHELL, W]} />
            </mesh>
            {/* Soft liner on the floor of the open box. */}
            <mesh material={linerMat} position={[0, SHELL + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[W - 0.01, W - 0.01]} />
            </mesh>
          </group>
          {WALLS.map((w, i) => (
            <group key={i} ref={(el) => void (wallPivots.current[i] = el)} position={w.pivot}>
              <group ref={(el) => void (wallShells.current[i] = el)} visible={false}>
                <mesh material={paperMat} position={w.offset} castShadow receiveShadow>
                  <boxGeometry args={w.size} />
                  <InkOutline weight="medium" color={INK} />
                </mesh>
                <mesh material={linerMat} position={w.liner} rotation={[0, w.linerYaw, 0]}>
                  <planeGeometry args={[w.linerW, WALL_LINER_H]} />
                </mesh>
              </group>
              {i === BACK_WALL && (
                // The lid is hinged to the back wall, so it folds down with it.
                <group ref={lidPivot} position={[0, BASE_TOP, W / 2 - LID_W / 2]}>
                  <group ref={hollowLid} visible={false}>
                    {LID_SHELL.map(([position, size], i) => (
                      <mesh key={i} material={paperMat} position={position} castShadow receiveShadow>
                        <boxGeometry args={size} />
                        <InkOutline weight="fine" color={INK} />
                      </mesh>
                    ))}
                    <mesh material={linerMat} position={[0, LID_H - SHELL - 0.002, LID_W / 2]} rotation={[Math.PI / 2, 0, 0]}>
                      <planeGeometry args={[LID_W - 2 * SHELL, LID_W - 2 * SHELL]} />
                    </mesh>
                  </group>
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
              )}
            </group>
          ))}
          <RibbonUnravel />
          <group ref={bands}>
            <mesh ref={bandXMesh} geometry={ribbons.bandX} material={ribbonMat} castShadow receiveShadow />
            <mesh ref={bandZMesh} geometry={ribbons.bandZ} material={ribbonMat} castShadow receiveShadow />
          </group>
          <group ref={tails} position={[0, ribbons.top, 0]}>
            <group position={[0, -ribbons.top, 0]}>
              <mesh ref={tailFrontMesh} geometry={ribbons.tailFront} material={ribbonMat} castShadow receiveShadow>
                <InkOutline weight="fine" color={INK} />
              </mesh>
              <group ref={sideTail} position={ribbons.tailPivot}>
                <group position={[-ribbons.tailPivot[0], -ribbons.tailPivot[1], -ribbons.tailPivot[2]]}>
                  <mesh ref={tailSideMesh} geometry={ribbons.tailSide} material={ribbonMat} castShadow receiveShadow>
                    <InkOutline weight="fine" color={INK} />
                  </mesh>
                </group>
                {tagEnabled && <GiftTag position={ribbons.tagAnchor} yaw={TAG_YAW} animate={animate} />}
              </group>
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
      <FlyingTag />
      <GiftUnwrap bodyRef={body} />
      <LobbySpirits animate={animate} />
      <GiftConvergence />
    </>
  );
}
