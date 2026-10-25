"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { convergence, useConvergenceActive, useConvergenceRun } from "@/components/convergence/convergenceClock";
import { type Artifact, buildArtifacts, filledAt, seeded, type ArtifactShape } from "@/lib/convergence/artifacts";
import { CONVERGENCE_TIMES, cameraPush, giftChoreography, smooth, smoother, span } from "@/lib/convergence/timeline";
import { SparkleBurst, type SparkleHandle } from "../AmbientEffects";
import { paint } from "../painterly/materials";
import { sparkleTexture } from "../painterly/textures";
import { platformTop } from "../props/Stonework";
import { ringBase } from "../room/stageLayout";
import { GIFT_SPOT } from "../sceneConfig";

/**
 * The Great Gift Convergence in the shared world: little paper notes, charms
 * and tags lift off their islands, arc across the sky and drop into the open
 * present; the present glows as it fills; then confetti, petals and stars
 * swirl while it charges, and a soft ring of light bursts when it gives way to
 * the chosen gift. Everything is a function of `convergence.t`, so a replay is
 * identical. One pooled sparkle system, three instanced confetti meshes and a
 * few sprites: no extra lights, no extra canvas.
 */

/** Keep in step with HeroGiftBox. */
const GIFT_SCALE = 1.22;
const CENTER = () => new THREE.Vector3(GIFT_SPOT.x, platformTop() + 0.85, GIFT_SPOT.z);

// --- Little symbolic objects -------------------------------------------------

const geometries = new Map<string, THREE.BufferGeometry>();
function geo(key: string, build: () => THREE.BufferGeometry) {
  let g = geometries.get(key);
  if (!g) geometries.set(key, (g = build()));
  return g;
}

function starShape(outer: number, inner: number, points = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

function tagShape() {
  const w = 0.17;
  const h = 0.24;
  const c = 0.07;
  const s = new THREE.Shape();
  s.moveTo(-w + c, -h);
  s.lineTo(w - c, -h);
  s.lineTo(w, -h + c);
  s.lineTo(w, h - c);
  s.lineTo(w - c, h);
  s.lineTo(-w + c, h);
  s.lineTo(-w, h - c);
  s.lineTo(-w, -h + c);
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, h - 0.07, 0.025, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

const PAPER = "#fbf3e3";

/** One artifact's body: a toon-lit little object with a warm glow of its own colour. */
export function buildBody(shape: ArtifactShape, color: string): THREE.Group {
  const tint = paint(`conv-${color}`, { color, emissive: color, emissiveIntensity: 0.3 });
  // Paper tinted a little towards the artifact's colour, so each note reads against the pale sky.
  const paper = paint(`conv-paper-${color}`, { color: new THREE.Color(PAPER).lerp(new THREE.Color(color), 0.5), emissive: color, emissiveIntensity: 0.12, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, p: [number, number, number] = [0, 0, 0], r: [number, number, number] = [0, 0, 0]) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...p);
    m.rotation.set(...r);
    g.add(m);
    return m;
  };
  switch (shape) {
    case "heart": {
      const h = new THREE.Shape();
      h.moveTo(0, -0.2);
      h.bezierCurveTo(-0.34, 0.02, -0.26, 0.3, -0.1, 0.3);
      h.bezierCurveTo(-0.04, 0.3, 0, 0.26, 0, 0.2);
      h.bezierCurveTo(0, 0.26, 0.04, 0.3, 0.1, 0.3);
      h.bezierCurveTo(0.26, 0.3, 0.34, 0.02, 0, -0.2);
      add(geo("heart", () => new THREE.ExtrudeGeometry(h, { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 })), paint("conv-heart", { color: "#ec8a9c", emissive: "#e0607a", emissiveIntensity: 0.4 }), [0, 0, -0.04]);
      break;
    }
    case "note": {
      add(geo("note", () => new THREE.BoxGeometry(0.46, 0.035, 0.34)), paper);
      // A folded corner and a ribbon of the artifact's colour.
      add(geo("note-fold", () => new THREE.BoxGeometry(0.16, 0.04, 0.12)), tint, [0.15, 0.005, 0.11], [0, 0.4, 0]);
      add(geo("note-band", () => new THREE.BoxGeometry(0.46, 0.042, 0.05)), tint, [0, 0, -0.04]);
      break;
    }
    case "letter": {
      add(geo("letter", () => new THREE.BoxGeometry(0.5, 0.06, 0.34)), paper);
      add(geo("letter-flap", () => new THREE.ConeGeometry(0.24, 0.17, 4)), paper, [0, 0.035, -0.09], [0, Math.PI / 4, Math.PI]);
      add(geo("seal", () => new THREE.SphereGeometry(0.05, 12, 8)), paint("conv-seal", { color: "#e48572", emissive: "#e48572", emissiveIntensity: 0.3 }), [0, 0.06, 0.03]);
      break;
    }
    case "charm": {
      const pts = [0.0, 0.07, 0.14, 0.2, 0.17, 0.1, 0.075, 0.1, 0.13].map((r, i) => new THREE.Vector2(r, i * 0.045 - 0.18));
      add(geo("vase", () => new THREE.LatheGeometry(pts, 14)), tint);
      add(geo("vase-rim", () => new THREE.TorusGeometry(0.1, 0.018, 6, 14)), paint("conv-gold", { color: "#e2bd6b", emissive: "#7a5a20", emissiveIntensity: 0.3 }), [0, 0.2, 0], [Math.PI / 2, 0, 0]);
      break;
    }
    case "star": {
      add(geo("star", () => new THREE.ExtrudeGeometry(starShape(0.26, 0.11), { depth: 0.06, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 })), paint("conv-star", { color: "#ffe08a", emissive: "#ffcf5a", emissiveIntensity: 0.55 }), [0, 0, -0.03]);
      break;
    }
    case "brush": {
      add(geo("brush-handle", () => new THREE.CylinderGeometry(0.022, 0.03, 0.6, 8)), paint("conv-wood", { color: "#b87d4b" }), [0, 0, 0], [0, 0, Math.PI / 2]);
      add(geo("brush-ferrule", () => new THREE.CylinderGeometry(0.035, 0.032, 0.1, 8)), paint("conv-gold", { color: "#e2bd6b", emissive: "#7a5a20", emissiveIntensity: 0.3 }), [0.32, 0, 0], [0, 0, Math.PI / 2]);
      add(geo("brush-tip", () => new THREE.ConeGeometry(0.04, 0.2, 8)), tint, [0.46, 0, 0], [0, 0, -Math.PI / 2]);
      break;
    }
    case "tag": {
      add(geo("tag", () => new THREE.ExtrudeGeometry(tagShape(), { depth: 0.035, bevelEnabled: false })), paper, [0, 0, -0.018]);
      add(geo("tag-band", () => new THREE.BoxGeometry(0.3, 0.07, 0.05)), tint, [0, -0.02, 0]);
      break;
    }
    case "leaf": {
      const m = add(geo("leaf", () => new THREE.SphereGeometry(0.2, 12, 8)), paint("conv-leaf", { color: "#8fbf6a", emissive: "#6fa04d", emissiveIntensity: 0.25 }));
      m.scale.set(1, 0.14, 0.55);
      add(geo("leaf-vein", () => new THREE.BoxGeometry(0.4, 0.02, 0.02)), tint, [0, 0.03, 0]);
      break;
    }
  }
  return g;
}

// --- Textures ----------------------------------------------------------------

let glowTex: THREE.Texture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,244,214,1)");
  g.addColorStop(0.35, "rgba(255,214,140,0.55)");
  g.addColorStop(1, "rgba(255,190,120,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

let ringTex: THREE.Texture | null = null;
function ringTexture() {
  if (ringTex) return ringTex;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.38, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,230,170,0)");
  g.addColorStop(0.55, "rgba(255,238,190,0.95)");
  g.addColorStop(1, "rgba(255,220,160,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ringTex = new THREE.CanvasTexture(c);
  ringTex.colorSpace = THREE.SRGBColorSpace;
  return ringTex;
}

let raysTex: THREE.Texture | null = null;
function raysTexture() {
  if (raysTex) return raysTex;
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.translate(S / 2, S / 2);
  const rays = 14;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + (i % 2) * 0.05;
    const width = 0.1 + (i % 3) * 0.04;
    const len = S * (i % 2 ? 0.34 : 0.48);
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    g.addColorStop(0, "rgba(255,240,200,0.85)");
    g.addColorStop(1, "rgba(255,220,170,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a - width) * len, Math.sin(a - width) * len);
    ctx.lineTo(Math.cos(a + width) * len, Math.sin(a + width) * len);
    ctx.closePath();
    ctx.fill();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.22);
  core.addColorStop(0, "rgba(255,248,226,0.9)");
  core.addColorStop(1, "rgba(255,230,180,0)");
  ctx.fillStyle = core;
  ctx.fillRect(-S / 2, -S / 2, S, S);
  raysTex = new THREE.CanvasTexture(c);
  raysTex.colorSpace = THREE.SRGBColorSpace;
  return raysTex;
}

// --- Confetti ------------------------------------------------------------------

const CONFETTI_COLORS = ["#f2d27a", "#f3b9c4", "#d9c8ff", "#fff1c2", "#ffc2b3", "#ffffff", "#e48572"];

interface Piece {
  born: number;
  life: number;
  v: [number, number, number];
  drag: number;
  gravity: number;
  spin: [number, number, number];
  phase: number;
  size: number;
  burst: boolean;
}

function makePieces(count: number, salt: number, kind: "paper" | "petal" | "star"): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    const key = `${kind}:${i}`;
    const r = (n: number) => seeded(key, salt + n);
    const burst = r(0) > 0.3;
    const a = r(1) * Math.PI * 2;
    // The burst throws pieces wide and fast, well past the box, to fill the screen.
    const out = burst ? 3.2 + r(2) * 6.5 : 0.5 + r(2) * 0.9;
    const up = burst ? 2.2 + r(3) * 4.2 : 1.0 + r(3) * 1.4;
    return {
      burst,
      born: burst ? CONVERGENCE_TIMES.burst[0] + r(4) * 0.3 : 7.25 + Math.pow(r(4), 1.6) * 1.9,
      life: burst ? 2.8 + r(5) * 1.2 : 1.5 + r(5) * 0.8,
      v: [Math.cos(a) * out, up, Math.sin(a) * out],
      drag: burst ? 1.1 : 0.6,
      gravity: kind === "paper" ? 2.1 : 1.1,
      spin: [(r(6) - 0.5) * 9, (r(7) - 0.5) * 9, (r(8) - 0.5) * 9],
      phase: r(9) * 6.28,
      size: (kind === "star" ? 0.1 : kind === "petal" ? 0.085 : 0.07) * (0.8 + r(10) * 0.7) * (burst ? 1.35 : 1),
    };
  });
}

function Confetti({ kind, count, salt, origin }: { kind: "paper" | "petal" | "star"; count: number; salt: number; origin: THREE.Vector3 }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const pieces = useMemo(() => makePieces(count, salt, kind), [count, salt, kind]);
  const geometry = useMemo(() => {
    if (kind === "star") return new THREE.ShapeGeometry(starShape(1, 0.45));
    if (kind === "petal") {
      const g = new THREE.CircleGeometry(1, 10);
      g.scale(0.55, 1, 1);
      return g;
    }
    return new THREE.PlaneGeometry(0.8, 1.1);
  }, [kind]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, toneMapped: false }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    pieces.forEach((_, i) => {
      color.set(kind === "petal" ? (i % 2 ? "#f3b9c4" : "#ffd9e0") : kind === "star" ? (i % 2 ? "#ffe08a" : "#fff7d6") : CONFETTI_COLORS[i % CONFETTI_COLORS.length]!);
      m.setColorAt(i, color);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [pieces, kind, color, geometry, material]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = convergence.t;
    const lift = giftChoreography(t, 1).lift;
    pieces.forEach((p, i) => {
      const age = t - p.born;
      if (age < 0 || age > p.life) {
        dummy.scale.setScalar(0);
      } else {
        const d = (1 - Math.exp(-p.drag * age)) / p.drag;
        const flutter = kind === "petal" ? Math.sin(age * 4 + p.phase) * 0.25 : Math.sin(age * 3 + p.phase) * 0.08;
        dummy.position.set(origin.x + p.v[0] * d + flutter, origin.y + lift + 0.55 + p.v[1] * d - 0.5 * p.gravity * age * age * (p.burst ? 1 : 0.4), origin.z + p.v[2] * d + Math.cos(age * 3 + p.phase) * 0.12);
        dummy.rotation.set(p.spin[0] * age + p.phase, p.spin[1] * age, p.spin[2] * age);
        const k = Math.min(1, age / 0.12) * (1 - smooth(span(age, p.life * 0.7, p.life)));
        dummy.scale.setScalar(p.size * k * 1.6);
      }
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />;
}

// --- The stage -------------------------------------------------------------------

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function Stage() {
  const run = useConvergenceRun();
  const sparkles = useRef<SparkleHandle>(null);
  const bodies = useRef<(THREE.Group | null)[]>([]);
  const orbiters = useRef<(THREE.Group | null)[]>([]);
  const landed = useRef(new Set<string>());
  const burstsFired = useRef(0);
  const glow = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.Mesh>(null);
  const rays = useRef<THREE.Sprite>(null);
  const shock = useRef<THREE.Sprite>(null);
  const center = useMemo(CENTER, []);
  const { artifacts } = useMemo(() => buildArtifacts(convergence.inputs), [run]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = ringBase();

  const glowMat = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), []);
  const raysMat = useMemo(() => new THREE.SpriteMaterial({ map: raysTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), []);
  const shockMat = useMemo(() => new THREE.SpriteMaterial({ map: ringTexture(), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }), []);
  const haloMat = useMemo(() => new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: "#ffd9a0" }), []);
  const glimmer = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color: "#ffd98a", opacity: 0.55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), []);

  // The first few return after the burst to circle the revealed gift.
  const orbit = useMemo(() => artifacts.slice(0, 8), [artifacts]);

  useEffect(() => {
    landed.current.clear();
    burstsFired.current = 0;
  }, [run]);
  useEffect(() => () => {
    glowMat.dispose();
    raysMat.dispose();
    shockMat.dispose();
    haloMat.dispose();
    glimmer.dispose();
  }, [glowMat, raysMat, shockMat, haloMat, glimmer]);

  useFrame(({ clock }) => {
    const t = convergence.t;
    const fill = filledAt(artifacts, t);
    const c = giftChoreography(t, fill);
    const push = cameraPush(t);
    const boost = 1 + 1.7 * (1 - push);

    artifacts.forEach((a, i) => {
      const body = bodies.current[i];
      if (!body) return;
      const k = span(t, a.start, a.arrive);
      if (k <= 0 || t > a.arrive) {
        body.visible = false;
        if (t > a.arrive && !landed.current.has(a.key)) {
          landed.current.add(a.key);
          // Only a real arrival sparkles, not one that was skipped past.
          if (t - a.arrive < 0.3) sparkles.current?.burst(_p.set(center.x + (seeded(a.key, 11) - 0.5) * 1.1, center.y - 0.15, center.z + (seeded(a.key, 12) - 0.5) * 1.1), i);
        }
        return;
      }
      body.visible = true;
      // Lift off the island, arc across the sky and drop straight into the open box.
      const from = _a.set(center.x + a.x, base + 0.9, center.z + a.z);
      const into = _b.set(center.x + (seeded(a.key, 11) - 0.5) * 1.1, center.y - 0.35, center.z + (seeded(a.key, 12) - 0.5) * 1.1);
      const e = smoother(k);
      const p1x = from.x + a.swing * 3 + (into.x - from.x) * 0.15;
      const p1y = from.y + 2.4 + a.lift * 2.6;
      const p1z = from.z + (into.z - from.z) * 0.15 - a.swing * 2;
      const p2x = into.x + a.swing * 0.8;
      const p2y = into.y + 2.6 + a.lift;
      const p2z = into.z;
      const u = 1 - e;
      const x = u * u * u * from.x + 3 * u * u * e * p1x + 3 * u * e * e * p2x + e * e * e * into.x;
      const y = u * u * u * from.y + 3 * u * u * e * p1y + 3 * u * e * e * p2y + e * e * e * into.y;
      const z = u * u * u * from.z + 3 * u * u * e * p1z + 3 * u * e * e * p2z + e * e * e * into.z;
      body.position.set(x, y, z);
      // Handmade: a slow turn, a gentle tilt, shrinking as it nears the box, popping out of its island at the start.
      const size = THREE.MathUtils.lerp(1.55, 0.5, smooth(e)) * boost * smooth(span(k, 0, 0.12)) * (1 - 0.6 * smooth(span(k, 0.9, 1)));
      body.scale.setScalar(Math.max(0.0001, size));
      body.rotation.set(Math.sin(k * 5 + a.swing) * 0.4, a.spin * e, Math.cos(k * 4 + a.swing * 3) * 0.35);
    });

    // The present's warmth: inside while it fills, then everywhere while it charges.
    const gl = glow.current;
    if (gl) {
      const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 5);
      gl.visible = c.glow > 0.01 && t < CONVERGENCE_TIMES.reveal[1];
      gl.position.set(center.x, center.y + c.lift + (t < CONVERGENCE_TIMES.lidClose[0] ? -0.1 : 0.45), center.z);
      gl.scale.setScalar((1.3 + c.glow * 1.8 + pulse * 0.12 * c.charge) * c.presence);
      glowMat.opacity = Math.min(0.5, c.glow * 0.55);
    }
    const h = halo.current;
    if (h) {
      h.visible = c.halo > 0.01;
      const s = (3.4 + 0.8 * Math.sin(clock.elapsedTime * 3)) * c.halo;
      h.scale.set(s, s, 1);
      haloMat.opacity = 0.75 * c.halo;
    }
    // The burst: a soft ring of light rays, never a full-screen flash.
    const r = rays.current;
    if (r) {
      const k = span(t, CONVERGENCE_TIMES.burst[0], CONVERGENCE_TIMES.reveal[1]);
      const swell = Math.sin(Math.min(1, k * 1.6) * Math.PI) * (1 - smooth(span(k, 0.5, 1)) * 0.0);
      r.visible = k > 0 && k < 1;
      r.position.set(center.x, center.y + 0.4, center.z);
      r.scale.setScalar(3 + 13 * smoother(Math.min(1, k * 1.3)));
      raysMat.opacity = Math.max(0, Math.min(0.6, swell * 0.7)) * (1 - smooth(span(k, 0.5, 1)));
      raysMat.rotation = clock.elapsedTime * 0.18;
    }
    // A shockwave ring races out from the box at the burst.
    const sh = shock.current;
    if (sh) {
      const k = span(t, CONVERGENCE_TIMES.burst[0], CONVERGENCE_TIMES.burst[0] + 0.9);
      sh.visible = k > 0 && k < 1;
      sh.position.set(center.x, center.y + 0.4, center.z);
      sh.scale.setScalar(1 + 24 * (1 - Math.pow(1 - k, 3)));
      shockMat.opacity = 0.7 * (1 - k) * (1 - k);
    }
    // Sparkle puffs during the charge and the burst.
    const want = Math.floor(span(t, CONVERGENCE_TIMES.charge[0] + 0.3, CONVERGENCE_TIMES.charge[1]) * 9) + (t >= CONVERGENCE_TIMES.burst[0] ? 4 : 0) + (t >= CONVERGENCE_TIMES.burst[0] + 0.1 ? 3 : 0) + (t >= CONVERGENCE_TIMES.burst[0] + 0.25 ? 3 : 0);
    while (burstsFired.current < want && t - CONVERGENCE_TIMES.charge[0] < 6) {
      const n = burstsFired.current++;
      sparkles.current?.burst(_p.set(center.x + (seeded("s", n) - 0.5) * 1.2, center.y + c.lift + 0.9, center.z + (seeded("t", n) - 0.5) * 1.2), n);
    }

    // The memories that powered the gift circle it once it is revealed.
    const orbitIn = smoother(span(t, CONVERGENCE_TIMES.burst[0] + 0.35, CONVERGENCE_TIMES.reveal[1]));
    const leave = convergence.leaving ? smooth(span(convergence.exit, 0, 0.5)) : 0;
    orbiters.current.forEach((o, i) => {
      if (!o) return;
      const s = orbitIn * (1 - leave);
      o.visible = s > 0.01;
      const ang = t * 0.7 + (i / orbit.length) * Math.PI * 2;
      const rad = 2.05 + 0.18 * Math.sin(t * 1.3 + i);
      o.position.set(center.x + Math.cos(ang) * rad * 1.3, center.y + 0.85 + Math.sin(t * 1.6 + i * 1.7) * 0.18, center.z + Math.sin(ang) * rad * 0.55);
      o.rotation.set(0.2, t * 1.1 + i, Math.sin(t + i) * 0.3);
      o.scale.setScalar(Math.max(0.0001, 0.6 * s));
    });
  });

  return (
    <group>
      {artifacts.map((a, i) => (
        <group key={`${run}:${a.key}`} ref={(el) => void (bodies.current[i] = el)} visible={false}>
          <primitive object={buildBody(a.shape, a.color)} />
          <sprite material={glimmer} scale={[0.55, 0.55, 1]} position={[0, 0.05, 0]} />
        </group>
      ))}
      {orbit.map((a, i) => (
        <group key={`${run}:orbit:${a.key}`} ref={(el) => void (orbiters.current[i] = el)} visible={false}>
          <primitive object={buildBody(a.shape, a.color)} />
          <sprite material={glimmer} scale={[0.55, 0.55, 1]} position={[0, 0.05, 0]} />
        </group>
      ))}
      <sprite ref={glow} material={glowMat} visible={false} renderOrder={4} />
      <sprite ref={rays} material={raysMat} visible={false} renderOrder={5} />
      <sprite ref={shock} material={shockMat} visible={false} renderOrder={6} />
      <mesh ref={halo} material={haloMat} rotation={[-Math.PI / 2, 0, 0]} position={[center.x, platformTop() + 0.03, center.z]} visible={false} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <Confetti kind="paper" count={150} salt={1} origin={center} />
      <Confetti kind="petal" count={70} salt={2} origin={center} />
      <Confetti kind="star" count={44} salt={3} origin={center} />
      <SparkleBurst ref={sparkles} />
    </group>
  );
}

export function GiftConvergence() {
  const active = useConvergenceActive();
  return active ? <Stage /> : null;
}

export { GIFT_SCALE as CONVERGENCE_GIFT_SCALE };
