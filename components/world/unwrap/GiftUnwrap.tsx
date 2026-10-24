"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { span, UNWRAP_TIMES, unwrapClock, useUnwrapPhase } from "@/components/unwrap/unwrapTimeline";
import { mockQrModules } from "@/lib/invitation/mockQr";
import { mulberry32 } from "../painterly/noise";
import { paint } from "../painterly/materials";
import { StylizedTree } from "../props/Flora";
import { BASE_TOP, QR_GRID } from "./invitationLayout";

/**
 * What grows out of the present, and how it becomes the QR code.
 *
 * The real box never changes: its lid opens (HeroGiftBox) and a coral-and-gold
 * tree grows up out of it. Seen from above, small blocks grow one by one
 * inside the canopy — coloured like the leaves they replace — until they cover
 * it and the tree is gone; the blocks part, then drop like falling leaves
 * into the box and settle into the code, filling the box to its brim. Closing
 * rewinds the same clock, so the way home is the same film backwards.
 * The blocks are a single instanced draw.
 */

/** The lid starts to open once the ribbon is off. */
export const LID_OPEN_AT = UNWRAP_TIMES.unwrapping + 0.6;
export const LID_OPEN_ANGLE = THREE.MathUtils.degToRad(115);
const TREE_GROW: [number, number] = [LID_OPEN_AT + 0.4, LID_OPEN_AT + 1.5];
/** Blocks begin to grow inside the canopy. */
export const VOXEL_SWAP_AT = UNWRAP_TIMES.assemblingQR;

const DISSOLVE = 0.55;
const TREE_GONE_AT = VOXEL_SWAP_AT + DISSOLVE + 0.05;
const PIXELATE_START = VOXEL_SWAP_AT + DISSOLVE;
const PIXELATE_END = PIXELATE_START + 0.35;
const RESOLVE_START = PIXELATE_START + 0.25;
const RESOLVE_SPREAD = 0.85;
const COLUMN_TIME = 0.45;

/** Grass and a few flowers sprout around the tree's roots on the box top. */
const GRASS_GROW: [number, number] = [TREE_GROW[0] - 0.15, TREE_GROW[0] + 0.7];
const GRASS_TUFTS = 70;
const GRASS_BLOOMS = 26;

/** Present's tree, in the gift's local frame (it inherits the gift's scale). */
const TREE = { scale: 0.72, seed: 21 } as const;
/** The grown canopy in world units above the box top, for shaping the first blocks. */
const CANOPY = { radius: 1.3, centre: 2.1, up: 0.85, down: 0.55 } as const;

/**
 * Leaf colours by height, matched to how the autumn canopy (Flora) actually
 * renders under the toon light, so the first cubes blend into the tree.
 */
const LEAF_RAMP: [number, string][] = [
  [0, "#a8492f"],
  [0.35, "#c0622f"],
  [0.65, "#c98a35"],
  [0.88, "#d2a640"],
  [1, "#dcb855"],
];
const DARK = ["#d9735e", "#c8583f", "#e0a24a", "#d9b66f", "#e48572", "#cf6a4f"];
const FINDER = ["#c9a65a", "#b59a52", "#9aa86a"];
const LIGHT = "#faf1e0";

interface Column {
  x: number;
  z: number;
  /** Canopy chunk this block starts as (h = 0: not part of the canopy). */
  boxH: number;
  boxBottom: number;
  /** When this block grows in during the dissolve. */
  appear: number;
  targetH: number;
  delay: number;
  from: THREE.Color;
  to: THREE.Color;
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const easeOutBack = (x: number) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);

function ramp(stops: [number, string][], t: number, out: THREE.Color) {
  let k = 0;
  while (k < stops.length - 2 && t > stops[k + 1]![0]) k++;
  const [a, ca] = stops[k]!;
  const [b, cb] = stops[k + 1]!;
  return out.set(ca).lerp(new THREE.Color(cb), THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));
}

export function GiftUnwrap({ bodyRef }: { bodyRef: RefObject<THREE.Group | null> }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  // Re-render per phase so a new invitation reseeds the pattern.
  useUnwrapPhase();
  const invite = unwrapClock.invite;
  const seed = invite ? `${invite.recipientDisplayName}·${invite.occasion}` : "unwrap";

  const columns = useMemo<Column[]>(() => {
    const modules = mockQrModules(seed);
    const n = QR_GRID.cells;
    const m = QR_GRID.size / n;
    const rng = mulberry32(modules.length * 31 + seed.length);
    const q = QR_GRID.modules;
    const out: Column[] = [];
    const maxTop = CANOPY.centre + CANOPY.radius * CANOPY.up;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = (c - (n - 1) / 2) * m;
        const z = (r - (n - 1) / 2) * m;
        const mr = r - 1;
        const mc = c - 1;
        const dark = mr >= 0 && mc >= 0 && mr < q && mc < q && modules[mr]![mc]!;
        const finder = (mr < 7 || mr >= q - 7) && (mc < 7 || mc >= q - 7) && !(mr >= q - 7 && mc >= q - 7);
        // Warm hues drift in soft patches, like leaves in a painted canopy.
        const patch = Math.sin(c * 0.45 + r * 0.2) + Math.cos(r * 0.38 - c * 0.15);
        const darkCol = finder ? FINDER[Math.abs(mr * 7 + mc) % FINDER.length]! : DARK[Math.floor(((patch + 2) / 4) * DARK.length + rng() * 1.2) % DARK.length]!;
        // First blocks are a pixelated copy of the canopy: floating chunks, coloured like the leaves at that height.
        const d = Math.hypot(x, z);
        const reach = Math.sqrt(Math.max(0, CANOPY.radius ** 2 - d * d)) * (0.8 + rng() * 0.35);
        const inCanopy = reach > 0.12;
        const top = CANOPY.centre + reach * CANOPY.up;
        const bottom = CANOPY.centre - reach * CANOPY.down;
        const leaf = ramp(LEAF_RAMP, THREE.MathUtils.clamp((top - CANOPY.centre) / (maxTop - CANOPY.centre) + (rng() - 0.5) * 0.25, 0, 1), new THREE.Color());
        const dist = d / (QR_GRID.size / 2);
        out.push({
          x,
          z,
          boxH: inCanopy ? top - bottom : 0,
          boxBottom: inCanopy ? bottom : 0,
          appear: VOXEL_SWAP_AT + rng() * (DISSOLVE - 0.16),
          targetH: dark ? 0.12 + rng() * 0.04 : 0.035,
          // Leaves settle in a gentle, scattered fall rather than a hard radial wave.
          delay: RESOLVE_START + rng() * RESOLVE_SPREAD * 0.7 + dist * RESOLVE_SPREAD * 0.3,
          from: inCanopy ? leaf : new THREE.Color(LIGHT),
          to: new THREE.Color(dark ? darkCol : LIGHT),
        });
      }
    }
    return out;
  }, [seed]);

  const mesh = useRef<THREE.InstancedMesh>(null);
  const tree = useRef<THREE.Group>(null);
  const meadow = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      grid: new THREE.Matrix4(),
      p: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      s: new THREE.Vector3(),
      bodyPos: new THREE.Vector3(),
      bodyQuat: new THREE.Quaternion(),
      bodyScale: new THREE.Vector3(),
      c: new THREE.Color(),
      corner: new THREE.Vector3(),
    }),
    [],
  );

  useLayoutEffect(() => {
    const im = mesh.current;
    if (!im) return;
    columns.forEach((col, i) => im.setColorAt(i, col.from));
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [columns]);

  useFrame(({ clock }) => {
    const u = unwrapClock;
    const on = u.active && !u.staticPreview;
    const t = on ? u.t : 0;

    // --- The tree: sprouts from the open box, and steps aside for its blocks.
    if (tree.current) {
      const g = span(t, TREE_GROW[0], TREE_GROW[1]);
      const k = Math.max(0.0001, g <= 0 ? 0 : easeOutBack(g));
      tree.current.scale.set(k * TREE.scale, Math.max(0.0001, smooth(g)) * TREE.scale, k * TREE.scale);
      tree.current.rotation.y = (1 - g) * 0.8;
      tree.current.visible = on && g > 0 && t < TREE_GONE_AT;
    }

    // --- Grass at the roots: sprouts with the tree, then the code's cream blocks rise over it.
    if (meadow.current) {
      const g = smooth(span(t, GRASS_GROW[0], GRASS_GROW[1]));
      const under = smooth(span(t, RESOLVE_START, RESOLVE_START + RESOLVE_SPREAD * 0.8));
      meadow.current.scale.set(1, Math.max(0.0001, g * (1 - under)), 1);
      meadow.current.visible = on && g > 0 && under < 1;
    }

    // --- The blocks.
    const im = mesh.current;
    if (!im) return;
    im.visible = on && t >= VOXEL_SWAP_AT;
    if (!im.visible) {
      u.cardRect = null;
      return;
    }
    // Grid lies on the open base's top face, in the box's own (turned) frame.
    const body = bodyRef.current;
    if (!body) return;
    body.updateWorldMatrix(true, false);
    body.matrixWorld.decompose(tmp.bodyPos, tmp.bodyQuat, tmp.bodyScale);
    tmp.p.set(0, BASE_TOP * tmp.bodyScale.y + 0.004, 0).applyQuaternion(tmp.bodyQuat).add(tmp.bodyPos);
    tmp.grid.compose(tmp.p, tmp.bodyQuat, tmp.s.set(1, 1, 1));

    const n = QR_GRID.cells;
    const m = QR_GRID.size / n;
    const gap = smooth(span(t, PIXELATE_START, PIXELATE_END)) * 0.16 * (1 - span(t, RESOLVE_START + RESOLVE_SPREAD, RESOLVE_START + RESOLVE_SPREAD + 0.6) * 0.6);
    const shimmer = span(t, PIXELATE_START, PIXELATE_END) * (1 - span(t, RESOLVE_START, RESOLVE_START + 0.5));
    const clockT = clock.elapsedTime;

    columns.forEach((col, i) => {
      const p = Math.min(1, Math.max(0, (t - col.delay) / COLUMN_TIME));
      let h: number;
      let bottom: number;
      let width = m * (1 - gap);
      if (col.boxH > 0) {
        // Leaf-cubes sit on the canopy's surface, then drop like falling leaves.
        const cube = m * 0.95;
        const hCube = cube;
        bottom = (col.boxBottom + col.boxH - cube) * (1 - p * p);
        // A little squash as each one lands.
        const land = span(p, 0.82, 1);
        h = THREE.MathUtils.lerp(hCube, col.targetH, land) * (1 - Math.sin(land * Math.PI) * 0.25);
        h += Math.sin(i * 1.7 + clockT * 9) * 0.04 * shimmer;
        // Dissolve: each grows from its own centre inside the canopy.
        const grow = smooth(span(t, col.appear, col.appear + 0.16));
        bottom += (h * (1 - grow)) / 2;
        h *= grow;
        width *= Math.max(0.0001, grow);
      } else {
        // The rest of the code rises out of the box's top as the leaves come down.
        bottom = 0;
        h = col.targetH * smooth(p);
      }
      if (h <= 0.0005) {
        tmp.m.makeScale(0, 0, 0);
      } else {
        tmp.m.compose(tmp.p.set(col.x, bottom, col.z), tmp.q.identity(), tmp.s.set(width, h, width)).premultiply(tmp.grid);
      }
      im.setMatrixAt(i, tmp.m);
      im.setColorAt(i, tmp.c.copy(col.from).lerp(col.to, smooth(span(p, 0.3, 1))));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;

    // Publish the code's screen rectangle once it has settled, so the DOM note can sit beside it.
    const settled = t >= RESOLVE_START + RESOLVE_SPREAD + COLUMN_TIME && u.phase !== "returningToWorld";
    if (!settled) {
      u.cardRect = null;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [cx, cz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      tmp.corner.set((cx * QR_GRID.size) / 2, 0.1, (cz * QR_GRID.size) / 2).applyMatrix4(tmp.grid).project(camera);
      const sx = ((tmp.corner.x + 1) / 2) * size.width;
      const sy = ((1 - tmp.corner.y) / 2) * size.height;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    u.cardRect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  });

  return (
    <>
      {/* The tree lives in the gift's own frame, rooted on the open base. */}
      <BodyFrame bodyRef={bodyRef}>
        <group ref={tree} position={[0, BASE_TOP, 0]} scale={0.0001} visible={false}>
          <StylizedTree x={0} z={0} y={0.05} seed={TREE.seed} kind="round" blobs={10} palette="autumn" />
        </group>
        <group ref={meadow} position={[0, BASE_TOP + 0.01, 0]} visible={false}>
          <BoxMeadow />
        </group>
      </BodyFrame>
      <instancedMesh key={seed} ref={mesh} args={[geometry, paint("qr-block", {}), columns.length]} visible={false} frustumCulled={false} castShadow receiveShadow />
    </>
  );
}

/** Follows the gift body's world transform each frame (including its lift and scale). */
function BodyFrame({ bodyRef, children }: { bodyRef: RefObject<THREE.Group | null>; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const body = bodyRef.current;
    if (!body || !ref.current) return;
    body.updateWorldMatrix(true, false);
    ref.current.matrix.copy(body.matrixWorld);
  });
  return (
    <group ref={ref} matrixAutoUpdate={false}>
      {children}
    </group>
  );
}

const BLOOM_COLOURS = ["#f6b7c6", "#ffffff", "#fbe7a1", "#f4b496", "#c9b6ee"];

/** Tufts of grass and small flowers scattered over the box top, thicker near the trunk. One draw each. */
function BoxMeadow() {
  const tufts = useRef<THREE.InstancedMesh>(null);
  const blooms = useRef<THREE.InstancedMesh>(null);
  const tuftGeo = useMemo(() => {
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.ConeGeometry(0.03, 0.2 + (i % 3) * 0.05, 3, 1).translate(0, 0.1, 0);
      b.rotateZ((i - 2) * 0.24);
      b.rotateY(i * 1.3);
      blades.push(b.toNonIndexed());
    }
    const count = blades.reduce((n, b) => n + b.getAttribute("position").count, 0);
    const pos = new Float32Array(count * 3);
    let o = 0;
    for (const b of blades) {
      pos.set(b.getAttribute("position").array as Float32Array, o);
      o += b.getAttribute("position").count * 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  useLayoutEffect(() => {
    const rng = mulberry32(77);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const half = 0.8;
    const place = (mesh: THREE.InstancedMesh | null, n: number, colour: () => string, scale: () => number) => {
      if (!mesh) return;
      for (let i = 0; i < n; i++) {
        // Bias toward the trunk so it reads as roots in a little lawn.
        const a = rng() * Math.PI * 2;
        const r = 0.14 + Math.pow(rng(), 0.8) * 0.85;
        const x = THREE.MathUtils.clamp(Math.cos(a) * r, -half, half);
        const z = THREE.MathUtils.clamp(Math.sin(a) * r, -half, half);
        const s = scale();
        m.compose(new THREE.Vector3(x, 0, z), q.setFromEuler(new THREE.Euler(0, rng() * 6, (rng() - 0.5) * 0.3)), new THREE.Vector3(s, s, s));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.set(colour()));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    place(tufts.current, GRASS_TUFTS, () => ["#6a9f45", "#86b852", "#a7cb60", "#55893d"][Math.floor(rng() * 4)]!, () => 0.7 + rng() * 0.8);
    place(blooms.current, GRASS_BLOOMS, () => BLOOM_COLOURS[Math.floor(rng() * BLOOM_COLOURS.length)]!, () => 0.8 + rng() * 0.6);
  }, []);
  return (
    <>
      <instancedMesh ref={tufts} args={[tuftGeo, paint("box-grass", { wind: 0.5 }), GRASS_TUFTS]} receiveShadow />
      <instancedMesh ref={blooms} args={[undefined, paint("box-bloom", {}), GRASS_BLOOMS]}>
        <icosahedronGeometry args={[0.04, 0]} />
      </instancedMesh>
    </>
  );
}
