"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { span, UNWRAP_TIMES, unwrapClock, useUnwrapClock } from "@/components/unwrap/unwrapTimeline";
import { inviteQrModules } from "@/lib/invitation/realQr";
import { mulberry32 } from "../painterly/noise";
import { paint } from "../painterly/materials";
import { grassTexture } from "../painterly/textures";
import { StylizedTree } from "../props/Flora";
import { BOX_SHELL, GIFT_BOX, QR_QUIET, QR_SIZE } from "./invitationLayout";

/**
 * What grows out of the present, and how it becomes the QR code.
 *
 * The lid opens, the walls fold down, and an autumn tree with a square crown
 * grows from the floor (HeroGiftBox). Once the room exists, a faint "ghost"
 * of its QR code shows on the floor beneath the tree. Seen from above, the
 * crown pixelates into one column per cell of the code — each the shape and
 * colour of the crown above that cell — and then melts down: light cells
 * sink away to the floor, dark cells settle into low autumn-coloured blocks,
 * and the room's real QR code is left lying in the open box. The code
 * encodes the invite link the server issued, so this waits (at the clock's
 * room gate) until the room exists. The blocks are a single instanced draw.
 */

export const LID_OPEN_ANGLE = THREE.MathUtils.degToRad(115);
const TREE_GROW = UNWRAP_TIMES.treeGrow;
/** The crown pixelates into columns. */
export const VOXEL_SWAP_AT = UNWRAP_TIMES.roomGate;
/** Columns pop in over the crown (one per cell), then the tree is hidden under them. */
const PIXELATE = 0.3;
const TREE_GONE_AT = VOXEL_SWAP_AT + PIXELATE + 0.12;
/** Each column then melts down to its cell of the code. */
const MELT_START = VOXEL_SWAP_AT + PIXELATE + 0.15;
const MELT_SPREAD = 0.85;
const MELT_TIME = 0.75;
export const CODE_SETTLED_AT = MELT_START + MELT_SPREAD + MELT_TIME;

/** Grass and a few flowers sprout around the tree's roots on the box floor. */
const GRASS_GROW = UNWRAP_TIMES.grass;
const GRASS_TUFTS = 130;
const GRASS_BLOOMS = 34;

/** Present's tree, in the gift's local frame (it inherits the gift's scale), rooted on the box floor. */
const TREE = { scale: 0.8, seed: 21, floor: 0.045 } as const;
/**
 * The grown square crown in world units above the box floor: a fallback for
 * shaping the columns if the crown couldn't be sampled (see CrownSampler).
 */
const CANOPY = { half: 1.0, top: 2.75, bottom: 1.32 } as const;
/** Resolution of the top-down samples of the real crown. */
const SAMPLE = 64;
/** Height range (world units above the floor) the height samples encode. */
const SAMPLE_RANGE = 4;
/** Render layer the crown is put on so the samplers see nothing else. */
const CROWN_LAYER = 7;

/**
 * Leaf colours by height, matched to how the autumn crown (Flora) renders
 * under the toon light, so the columns read as the same crown pixelated.
 */
const LEAF_RAMP: [number, string][] = [
  [0, "#a8492f"],
  [0.35, "#c0622f"],
  [0.65, "#c98a35"],
  [0.88, "#d2a640"],
  [1, "#dcb855"],
];
/** Deep autumn tones for the dark modules (burnt orange, rust), dark enough for any phone to scan. */
const DARK = ["#a83c22", "#9a4a1c", "#8f3e20", "#b4461f", "#7f3a1c", "#963a1e"];
/** Bronze and olive finder squares, deep enough that the finder's rings binarise cleanly. */
const FINDER = ["#6b4a12", "#5a3e14", "#4f5a1e"];
const LIGHT = "#f6f1e8";
/** The ghost of the code on the box floor: soft grey modules on cream. */
const GHOST = { light: "#f6f1e8", dark: "#d6d0c6" };

interface Column {
  x: number;
  z: number;
  /** The piece of crown this column starts as (none: it rises from the floor instead). */
  inCrown: boolean;
  crownBottom: number;
  crownTop: number;
  /** When this column pops in over the crown. */
  appear: number;
  /** When it starts to melt down. */
  melt: number;
  /** Final height: a low block for a dark module, nothing for a light one. */
  targetH: number;
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

/** The code drawn faintly, quiet zone included, for the floor of the box. */
function ghostTexture(modules: boolean[][]): THREE.CanvasTexture {
  const q = modules.length;
  const n = q + 2 * QR_QUIET;
  const px = Math.max(8, Math.floor(1024 / n));
  const c = document.createElement("canvas");
  c.width = c.height = n * px;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = GHOST.light;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = GHOST.dark;
  modules.forEach((row, r) => row.forEach((dark, col) => dark && ctx.fillRect((col + QR_QUIET) * px, (r + QR_QUIET) * px, px, px)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

/**
 * Samples the grown crown as it actually renders, straight down over the
 * code's square: its lit colours, the height of its top, and of its underside.
 * Three tiny orthographic renders of the crown alone (on its own layer) into a
 * 64×64 target, read back once per run. The columns copy these, so the
 * pixelated crown is the same crown, in the same place, in the same colours.
 */
function useCrownSampler() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  return useMemo(() => {
    const target = new THREE.WebGLRenderTarget(SAMPLE, SAMPLE);
    const cam = new THREE.OrthographicCamera(-QR_SIZE / 2, QR_SIZE / 2, QR_SIZE / 2, -QR_SIZE / 2, 0.01, 30);
    cam.layers.set(CROWN_LAYER);
    const y0 = { value: 0 };
    const heightMat = new THREE.ShaderMaterial({
      uniforms: { uY0: y0, uRange: { value: SAMPLE_RANGE } },
      vertexShader: "varying float vY; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: "uniform float uY0; uniform float uRange; varying float vY; void main() { gl_FragColor = vec4(clamp((vY - uY0) / uRange, 0.0, 1.0), 0.0, 0.0, 1.0); }",
      side: THREE.DoubleSide,
    });
    const colour = new Uint8Array(SAMPLE * SAMPLE * 4);
    const top = new Uint8Array(SAMPLE * SAMPLE * 4);
    const under = new Uint8Array(SAMPLE * SAMPLE * 4);
    const pass = (into: Uint8Array, from: THREE.Vector3, at: THREE.Vector3, up: THREE.Vector3, override: THREE.Material | null) => {
      cam.position.copy(from);
      cam.up.copy(up);
      cam.lookAt(at);
      cam.updateMatrixWorld();
      const prevOverride = scene.overrideMaterial;
      scene.overrideMaterial = override;
      gl.setRenderTarget(target);
      gl.clear();
      gl.render(scene, cam);
      gl.readRenderTargetPixels(target, 0, 0, SAMPLE, SAMPLE, into);
      scene.overrideMaterial = prevOverride;
    };
    return {
      colour,
      top,
      under,
      /** Grid origin and rotation (the code's frame); returns false if the crown isn't there to sample. */
      sample(crown: THREE.Object3D, origin: THREE.Vector3, quat: THREE.Quaternion) {
        const meshes: THREE.Mesh[] = [];
        crown.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && (m.material as THREE.MeshToonMaterial).vertexColors) meshes.push(m);
        });
        if (!meshes.length) return false;
        // Lights only reach cameras on their layers: light the crown exactly as the scene does.
        const lights: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if ((o as THREE.Light).isLight) lights.push(o);
        });
        [...meshes, ...lights].forEach((o) => o.layers.enable(CROWN_LAYER));
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
        // Image "up" is the grid's -z (row 0), so pixels map straight onto rows and columns.
        const north = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
        const prevTarget = gl.getRenderTarget();
        const prevClear = gl.getClearColor(new THREE.Color());
        const prevAlpha = gl.getClearAlpha();
        gl.setClearColor(0x000000, 0);
        y0.value = origin.y;
        pass(colour, origin.clone().addScaledVector(up, 12), origin, north, null);
        pass(top, origin.clone().addScaledVector(up, 12), origin, north, heightMat);
        pass(under, origin.clone().addScaledVector(up, -0.5), origin.clone().addScaledVector(up, 5), north, heightMat);
        gl.setRenderTarget(prevTarget);
        gl.setClearColor(prevClear, prevAlpha);
        [...meshes, ...lights].forEach((o) => o.layers.disable(CROWN_LAYER));
        return true;
      },
      dispose() {
        target.dispose();
        heightMat.dispose();
      },
    };
  }, [gl, scene]);
}

export function GiftUnwrap({ bodyRef }: { bodyRef: RefObject<THREE.Group | null> }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  const sampler = useCrownSampler();
  useEffect(() => () => sampler.dispose(), [sampler]);
  /** Which run the crown was sampled for, and whether the columns have taken it on. */
  const sampled = useRef({ run: -1, ok: false, applied: "" });
  // Re-render when the room (and so the code) arrives.
  const url = useUnwrapClock().invite?.inviteUrl ?? null;
  const seed = url ?? "";
  const modules = useMemo(() => (url ? inviteQrModules(url) : null), [url]);

  const columns = useMemo<Column[]>(() => {
    if (!modules) return [];
    const q = modules.length;
    const n = q + 2 * QR_QUIET;
    const m = QR_SIZE / n;
    const rng = mulberry32(q * 31 + seed.length);
    const out: Column[] = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = (c - (n - 1) / 2) * m;
        const z = (r - (n - 1) / 2) * m;
        const mr = r - QR_QUIET;
        const mc = c - QR_QUIET;
        const dark = mr >= 0 && mc >= 0 && mr < q && mc < q && modules[mr]![mc]!;
        const finder = (mr < 7 || mr >= q - 7) && (mc < 7 || mc >= q - 7) && !(mr >= q - 7 && mc >= q - 7);
        // Warm hues drift in soft patches, like leaves in a painted canopy.
        const patch = Math.sin(c * 0.45 + r * 0.2) + Math.cos(r * 0.38 - c * 0.15);
        const darkCol = finder ? FINDER[Math.abs(Math.floor(mr / 3) * 5 + Math.floor(mc / 3)) % FINDER.length]! : DARK[Math.floor(((patch + 2) / 4) * DARK.length + rng() * 1.2) % DARK.length]!;
        // The crown above this cell: bushy, lumpy top and underside, a little lower toward the edges.
        const lump = (Math.sin(x * 3.1 + z * 1.7) + Math.cos(z * 2.7 - x * 1.3)) * 0.06 + rng() * 0.1;
        const edge = Math.min(1, Math.max(Math.abs(x), Math.abs(z)) / CANOPY.half);
        const top = CANOPY.top - lump - edge * edge * 0.18;
        const bottom = CANOPY.bottom + lump * 0.5 + edge * edge * 0.08;
        const leaf = ramp(LEAF_RAMP, THREE.MathUtils.clamp((top - CANOPY.bottom) / (CANOPY.top - CANOPY.bottom) + (rng() - 0.5) * 0.25, 0, 1), new THREE.Color());
        const dist = Math.hypot(x, z) / (QR_SIZE / 2);
        out.push({
          x,
          z,
          inCrown: edge < 1,
          crownBottom: bottom,
          crownTop: top,
          appear: VOXEL_SWAP_AT + rng() * (PIXELATE - 0.1),
          // The crown melts from its middle outward, unevenly, like wax.
          melt: MELT_START + rng() * MELT_SPREAD * 0.6 + dist * MELT_SPREAD * 0.4,
          // Low relief: tall blocks would show dark sides in perspective and blur the modules.
          targetH: dark ? 0.06 + rng() * 0.02 : 0,
          from: leaf,
          to: new THREE.Color(dark ? darkCol : LIGHT),
        });
      }
    }
    return out;
  }, [modules, seed]);

  const mesh = useRef<THREE.InstancedMesh>(null);
  const tree = useRef<THREE.Group>(null);
  const meadow = useRef<THREE.Group>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  // While it is the pixelated crown, each block shows exactly the colour sampled from the
  // lit crown (unlit, or it would be lit twice). As it becomes the code, light returns a
  // little for depth, but the block stays mostly its own colour, so the code keeps its
  // contrast for phone cameras under any time of day.
  const unlit = useMemo(() => ({ value: 1 }), []);
  const blockMat = useMemo(() => {
    const mat = paint("qr-block", {}).clone();
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uUnlit = unlit;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uUnlit;")
        .replace(
          "#include <opaque_fragment>",
          "#if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )\n  outgoingLight = mix(outgoingLight, vColor.rgb, uUnlit);\n#endif\n#include <opaque_fragment>",
        );
    };
    mat.customProgramCacheKey = () => "qr-block-unlit";
    return mat;
  }, [unlit]);
  // The floor ghost is unlit: it is the code's background, so it must stay light.
  const ghostMat = useMemo(() => (modules ? new THREE.MeshBasicMaterial({ map: ghostTexture(modules), transparent: true, opacity: 0, depthWrite: false }) : null), [modules]);
  useEffect(
    () => () => {
      ghostMat?.map?.dispose();
      ghostMat?.dispose();
    },
    [ghostMat],
  );
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

  useFrame(() => {
    const u = unwrapClock;
    const on = u.active;
    const t = on ? u.t : 0;

    // --- The tree: sprouts from the open box; hidden once its columns cover it.
    if (tree.current) {
      const g = span(t, TREE_GROW[0], TREE_GROW[1]);
      // The crown fills out a beat after the trunk rises, once the walls have fallen away.
      const w = THREE.MathUtils.clamp((g - 0.3) / 0.7, 0, 1);
      const k = Math.max(0.0001, g <= 0 ? 0 : 0.22 + 0.78 * (w <= 0 ? 0 : easeOutBack(w)));
      tree.current.scale.set(k * TREE.scale, Math.max(0.0001, smooth(g)) * TREE.scale, k * TREE.scale);
      // StylizedTree turns each tree by its seed; undo that so the square crown lines up with the box and the code.
      tree.current.rotation.y = (1 - g) * 0.8 - TREE.seed;
      tree.current.visible = on && g > 0 && !(mesh.current && t >= TREE_GONE_AT);
    }

    // --- Once the tree has grown, sample its crown for the columns (once per run).
    const sp = sampled.current;
    if (on && sp.run !== u.run && t >= TREE_GROW[1] && t < VOXEL_SWAP_AT && tree.current?.visible && bodyRef.current) {
      sp.run = u.run;
      sp.applied = "";
      const body = bodyRef.current;
      body.updateWorldMatrix(true, true);
      body.matrixWorld.decompose(tmp.bodyPos, tmp.bodyQuat, tmp.bodyScale);
      const origin = tmp.p.set(0, (BOX_SHELL + 0.002) * tmp.bodyScale.y, 0).applyQuaternion(tmp.bodyQuat).add(tmp.bodyPos).clone();
      tree.current.updateWorldMatrix(true, true);
      sp.ok = sampler.sample(tree.current, origin, tmp.bodyQuat.clone());
    }

    // --- Grass at the roots: sprouts with the tree, and melts away with it.
    if (meadow.current) {
      const g = smooth(span(t, GRASS_GROW[0], GRASS_GROW[1]));
      const under = smooth(span(t, MELT_START, MELT_START + MELT_SPREAD));
      meadow.current.scale.set(1, Math.max(0.0001, g * (1 - under)), 1);
      meadow.current.visible = on && g > 0 && under < 1;
    }

    // --- The ghost of the code on the floor, as the camera rises to look down.
    if (ghost.current && ghostMat) {
      const k = span(t, UNWRAP_TIMES.topView[0] + 0.2, UNWRAP_TIMES.topView[1]);
      ghostMat.opacity = k;
      ghost.current.visible = on && k > 0;
    }

    // --- The columns.
    const im = mesh.current;
    if (!im) {
      u.codeRect = null;
      return;
    }
    im.visible = on && t >= VOXEL_SWAP_AT;
    if (!im.visible) {
      u.codeRect = null;
      return;
    }
    // Grid lies on the open box's floor, in the box's own (turned) frame.
    const body = bodyRef.current;
    if (!body) return;
    body.updateWorldMatrix(true, false);
    body.matrixWorld.decompose(tmp.bodyPos, tmp.bodyQuat, tmp.bodyScale);
    tmp.p.set(0, (BOX_SHELL + 0.002) * tmp.bodyScale.y, 0).applyQuaternion(tmp.bodyQuat).add(tmp.bodyPos);
    tmp.grid.compose(tmp.p, tmp.bodyQuat, tmp.s.set(1, 1, 1));

    unlit.value = 1 - span(t, MELT_START + MELT_SPREAD * 0.5, CODE_SETTLED_AT) * 0.2;
    const n = Math.round(Math.sqrt(columns.length));
    const m = QR_SIZE / n;
    // Take on the sampled crown: each column copies the pixel above its cell.
    const s = sampled.current;
    if (s.ok && s.applied !== `${u.run}|${seed}`) {
      s.applied = `${u.run}|${seed}`;
      const px = (x: number) => Math.min(SAMPLE - 1, Math.max(0, Math.floor(((x + QR_SIZE / 2) / QR_SIZE) * SAMPLE)));
      columns.forEach((col) => {
        const ix = px(col.x);
        // Row 0 (−z) is the top of the image; readback rows start at the bottom.
        const iy = SAMPLE - 1 - px(col.z);
        const i = (iy * SAMPLE + ix) * 4;
        // The underside was seen from below, so it is mirrored left–right.
        const j = (iy * SAMPLE + (SAMPLE - 1 - ix)) * 4;
        col.inCrown = sampler.colour[i + 3]! > 128;
        if (!col.inCrown) return;
        col.crownTop = (sampler.top[i]! / 255) * SAMPLE_RANGE;
        col.crownBottom = sampler.under[j + 3]! > 128 ? (sampler.under[j]! / 255) * SAMPLE_RANGE : col.crownTop - 0.4;
        col.from.setRGB(sampler.colour[i]! / 255, sampler.colour[i + 1]! / 255, sampler.colour[i + 2]! / 255);
      });
    }
    columns.forEach((col, i) => {
      // Pop in over the crown, then melt: the bottom sinks to the floor and the top to the module's height.
      const k = Math.min(1, Math.max(0, (t - col.melt) / MELT_TIME));
      const melt = k * k * (3 - 2 * k);
      // Cells the crown didn't cover simply rise out of the ghost on the floor.
      const pop = col.inCrown ? smooth(span(t, col.appear, col.appear + 0.12)) : melt;
      const bottom = col.inCrown ? THREE.MathUtils.lerp(col.crownBottom, 0, melt) : 0;
      const top = col.inCrown ? THREE.MathUtils.lerp(col.crownTop, col.targetH, melt * melt * (3 - 2 * melt) * 0.4 + melt * 0.6) : col.targetH;
      const h = Math.max(0, top - bottom) * pop;
      // A hairline gap while it reads as a pixelated crown; solid once it is the code.
      const width = m * (1 - 0.06 * (1 - melt)) * Math.max(0.0001, pop);
      if (h <= 0.0005) {
        tmp.m.makeScale(0, 0, 0);
      } else {
        tmp.m.compose(tmp.p.set(col.x, bottom + (top - bottom) * (1 - pop) * 0.5, col.z), tmp.q.identity(), tmp.s.set(width, h, width)).premultiply(tmp.grid);
      }
      im.setMatrixAt(i, tmp.m);
      im.setColorAt(i, col.inCrown ? tmp.c.copy(col.from).lerp(col.to, smooth(Math.min(1, melt * 1.4))) : col.to);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;

    // Publish the code's screen rectangle once it has settled.
    if (t < CODE_SETTLED_AT) {
      u.codeRect = null;
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
      tmp.corner.set((cx * QR_SIZE) / 2, 0.1, (cz * QR_SIZE) / 2).applyMatrix4(tmp.grid).project(camera);
      const sx = ((tmp.corner.x + 1) / 2) * size.width;
      const sy = ((1 - tmp.corner.y) / 2) * size.height;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    u.codeRect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  });

  return (
    <>
      {/* The tree lives in the gift's own frame, rooted on the open base. */}
      <BodyFrame bodyRef={bodyRef}>
        <group ref={tree} position={[0, TREE.floor, 0]} scale={0.0001} visible={false}>
          <StylizedTree x={0} z={0} y={0.05} seed={TREE.seed} kind="square" palette="autumn" />
        </group>
        {ghostMat && (
          <mesh ref={ghost} material={ghostMat} position={[0, BOX_SHELL + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={1}>
            <planeGeometry args={[QR_SIZE / GIFT_BOX.scale, QR_SIZE / GIFT_BOX.scale]} />
          </mesh>
        )}
        <group ref={meadow} position={[0, TREE.floor + 0.005, 0]} visible={false}>
          <BoxMeadow />
        </group>
      </BodyFrame>
      {columns.length > 0 && <instancedMesh key={seed} ref={mesh} args={[geometry, blockMat, columns.length]} visible={false} frustumCulled={false} castShadow receiveShadow />}
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
        const r = 0.1 + Math.pow(rng(), 1.3) * 0.8;
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
    // Taller and thicker near the trunk, like a little lawn it grew out of.
    place(tufts.current, GRASS_TUFTS, () => ["#6a9f45", "#86b852", "#a7cb60", "#55893d"][Math.floor(rng() * 4)]!, () => 0.75 + rng() * 0.6);
    place(blooms.current, GRASS_BLOOMS, () => BLOOM_COLOURS[Math.floor(rng() * BLOOM_COLOURS.length)]!, () => 0.8 + rng() * 0.6);
  }, []);
  return (
    <>
      {/* A soft mound of turf around the roots. */}
      <mesh material={paint("box-turf", { map: grassTexture(), color: "#8fbf5a" })} scale={[0.62, 0.16, 0.62]} receiveShadow>
        <sphereGeometry args={[1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <instancedMesh ref={tufts} args={[tuftGeo, paint("box-grass", { wind: 0.5 }), GRASS_TUFTS]} receiveShadow />
      <instancedMesh ref={blooms} args={[undefined, paint("box-bloom", {}), GRASS_BLOOMS]}>
        <icosahedronGeometry args={[0.04, 0]} />
      </instancedMesh>
    </>
  );
}
