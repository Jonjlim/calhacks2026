"use client";

import { InkOutline } from "@/components/world/painterly/InkOutline";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries, wobble } from "../geometry";
import { mulberry32 } from "../painterly/noise";
import { paint } from "../painterly/materials";
import { cloudTexture, plasterTexture, roofTexture, stoneTexture, woodTexture } from "../painterly/textures";
import { groundAt } from "../terrain";

const INK = "#3d2c35";

export function gableRoofGeometry(width: number, height: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(0, height);
  shape.lineTo(width / 2, 0);
  shape.lineTo(-width / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9, uv.getY(i) * 0.9);
  return geo;
}

function Wall({ args, position, rotation }: { args: [number, number, number]; position: [number, number, number]; rotation?: [number, number, number] }) {
  const geo = useMemo(() => wobble(new THREE.BoxGeometry(...args, 4, 4, 4), 0.012, args[0]), [args]);
  return (
    <mesh geometry={geo} position={position} rotation={rotation} material={paint("plaster", { map: plasterTexture() })} castShadow receiveShadow>
      <InkOutline weight="fine" color={INK} />
    </mesh>
  );
}

/** Arched window: dark frame with a warm lit pane. */
function Window({ position, rotationY, scale = 1 }: { position: [number, number, number]; rotationY: number; scale?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <mesh material={paint("window-frame", { color: "#5a4258" })}>
        <boxGeometry args={[0.22, 0.32, 0.05]} />
      </mesh>
      <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]} material={paint("window-frame", { color: "#5a4258" })}>
        <cylinderGeometry args={[0.11, 0.11, 0.05, 12, 1, false, -Math.PI / 2, Math.PI]} />
      </mesh>
      <mesh position={[0, 0.02, 0.028]} material={paint("window-glow", { color: "#ffd88a", emissive: "#ffb85c", emissiveIntensity: 0.9 })}>
        <planeGeometry args={[0.14, 0.24]} />
      </mesh>
      <mesh position={[0, 0.02, 0.03]} material={paint("window-frame", { color: "#5a4258" })}>
        <boxGeometry args={[0.012, 0.24, 0.01]} />
      </mesh>
    </group>
  );
}

function Pennant() {
  const flag = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.7, 0.22, 10, 1);
    g.translate(0.35, 0, 0);
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setY(i, pos.getY(i) * (1 - x / 0.85));
    }
    return g;
  }, []);
  const base = useMemo(() => Float32Array.from(geo.getAttribute("position").array), [geo]);
  useFrame(({ clock }) => {
    const mesh = flag.current;
    if (!mesh) return;
    const pos = mesh.geometry.getAttribute("position");
    const t = clock.elapsedTime;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]!;
      pos.setZ(i, Math.sin(t * 3 - x * 7) * 0.06 * x * 2);
    }
    pos.needsUpdate = true;
  });
  return (
    <mesh ref={flag} geometry={geo} material={paint("pennant", { color: "#e07a62", side: THREE.DoubleSide })} rotation={[0, -0.6, 0]} />
  );
}

/** Painted wooden shutters either side of a window. */
function Shutters({ position, rotationY, width = 0.22, height = 0.3, color = "#7f9ec9" }: { position: [number, number, number]; rotationY: number; width?: number; height?: number; color?: string }) {
  const mat = paint(`shutter-${color}`, { map: woodTexture(), color });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width * 0.5 + 0.06), 0.02, 0.01]} rotation={[0, side * 0.35, 0]} material={mat}>
          <boxGeometry args={[0.1, height, 0.025]} />
          <InkOutline weight="fine" color={INK} opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

const BOX_FLOWERS = ["#f3a1b0", "#ffffff", "#fbe7a1", "#e07a62", "#c9b6ee"];

/** Window box spilling with flowers and a little trailing green. */
function FlowerBox({ position, rotationY, width = 0.3, seed = 1 }: { position: [number, number, number]; rotationY: number; width?: number; seed?: number }) {
  const blooms = useMemo(() => {
    const rng = mulberry32(seed * 17);
    return Array.from({ length: 7 }, (_, i) => ({ x: (i / 6 - 0.5) * width * 0.9, y: 0.05 + rng() * 0.03, z: (rng() - 0.5) * 0.04, c: BOX_FLOWERS[Math.floor(rng() * BOX_FLOWERS.length)]!, r: 0.026 + rng() * 0.014 }));
  }, [seed, width]);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh material={paint("flowerbox", { map: woodTexture(), color: "#b9805a" })} castShadow>
        <boxGeometry args={[width, 0.07, 0.08]} />
        <InkOutline weight="fine" color={INK} opacity={0.5} />
      </mesh>
      <mesh position={[0, 0.04, 0]} material={paint("moss", {})} scale={[width * 5.2, 0.5, 0.75]}>
        <sphereGeometry args={[0.09, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {blooms.map((b, i) => (
        <mesh key={i} position={[b.x, b.y, b.z]} material={paint(`box-bloom-${b.c}`, { color: b.c })}>
          <icosahedronGeometry args={[b.r, 0]} />
        </mesh>
      ))}
    </group>
  );
}

/** Ivy climbing a wall: a few wandering stems dotted with leaves. */
function Ivy({ position, rotationY, height, spread = 0.5, seed = 1, curve = 0 }: { position: [number, number, number]; rotationY: number; height: number; spread?: number; seed?: number; curve?: number }) {
  const geo = useMemo(() => {
    const rng = mulberry32(seed * 29 + 3);
    const parts: THREE.BufferGeometry[] = [];
    for (let s = 0; s < 4; s++) {
      const x0 = (rng() - 0.5) * spread;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const x = x0 + Math.sin(t * 4 + s) * 0.08;
        // Optionally hug a cylinder of radius `curve` (towers).
        const z = curve ? Math.sqrt(Math.max(0, curve * curve - x * x)) - curve : 0;
        pts.push(new THREE.Vector3(x, t * height * (0.6 + rng() * 0.4), z + 0.02));
      }
      const c = new THREE.CatmullRomCurve3(pts);
      parts.push(new THREE.TubeGeometry(c, 14, 0.012, 3));
      for (let k = 0; k < 14; k++) {
        const p = c.getPoint(rng());
        parts.push(new THREE.IcosahedronGeometry(0.045 + rng() * 0.03, 0).scale(1.3, 1, 0.5).translate(p.x + (rng() - 0.5) * 0.05, p.y, p.z + 0.02));
      }
    }
    return mergeGeometries(parts);
  }, [height, spread, seed, curve]);
  return <mesh geometry={geo} position={position} rotation={[0, rotationY, 0]} material={paint("ivy", { color: "#5a8d3f" })} castShadow />;
}

/** Soft puffs rising and fading from a chimney. */
function ChimneySmoke({ position, animate }: { position: [number, number, number]; animate: boolean }) {
  const puffs = useRef<(THREE.Sprite | null)[]>([]);
  const mats = useMemo(() => Array.from({ length: 4 }, () => new THREE.SpriteMaterial({ map: cloudTexture(4, true), transparent: true, depthWrite: false, opacity: 0 })), []);
  useFrame(({ clock }) => {
    if (!animate) return;
    const t = clock.elapsedTime;
    puffs.current.forEach((p, i) => {
      if (!p) return;
      const k = ((t * 0.18 + i / 4) % 1 + 1) % 1;
      p.position.set(k * 0.5 + Math.sin(t * 0.7 + i) * 0.05, k * 1.5, -k * 0.2);
      const s = 0.25 + k * 0.7;
      p.scale.set(s, s * 0.6, 1);
      mats[i]!.opacity = Math.sin(k * Math.PI) * 0.5;
    });
  });
  return (
    <group position={position}>
      {mats.map((m, i) => (
        <sprite
          key={i}
          ref={(el) => {
            puffs.current[i] = el;
          }}
          material={m}
        />
      ))}
    </group>
  );
}

/** Little painted signboard on a post. */
function Signpost({ position, rotationY, color = "#e9d3b4" }: { position: [number, number, number]; rotationY: number; color?: string }) {
  const wood = paint("fence-wood", { map: woodTexture(), color: "#d2a983" });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.3, 0]} material={wood} castShadow>
        <cylinderGeometry args={[0.025, 0.03, 0.6, 5]} />
        <InkOutline weight="fine" color={INK} opacity={0.6} />
      </mesh>
      <mesh position={[0.05, 0.52, 0.03]} rotation={[0, 0, -0.06]} material={paint("sign-board", { map: woodTexture(), color })} castShadow>
        <boxGeometry args={[0.34, 0.14, 0.03]} />
        <InkOutline weight="fine" color={INK} opacity={0.7} />
      </mesh>
      {/* A tiny painted gift on the board. */}
      <mesh position={[0.05, 0.52, 0.05]} material={paint("gift-knot", { color: "#e48572" })}>
        <boxGeometry args={[0.06, 0.06, 0.01]} />
      </mesh>
    </group>
  );
}

/** Long cloth banner hanging from the tower's trim. */
function HangingBanner({ position, rotationY }: { position: [number, number, number]; rotationY: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.26, 0.8, 1, 6).translate(0, -0.4, 0);
    const pos = g.getAttribute("position");
    // Notched swallowtail at the bottom.
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.79 && Math.abs(pos.getX(i)) < 0.01) pos.setY(i, -0.68);
    return g;
  }, []);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.x = Math.sin(clock.elapsedTime * 1.3) * 0.04;
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh ref={ref} geometry={geo} material={paint("banner", { color: "#e48572", side: THREE.DoubleSide })} castShadow>
        <InkOutline weight="fine" color={INK} opacity={0.6} />
      </mesh>
      <mesh position={[0, -0.25, 0.006]} material={paint("gold", { color: "#e2bd6b", emissive: "#7a5a20", emissiveIntensity: 0.25 })}>
        <circleGeometry args={[0.06, 10]} />
      </mesh>
    </group>
  );
}

export function StorybookTower({ x, z, rotationY = 0 }: { x: number; z: number; rotationY?: number }) {
  const y = groundAt(x, z) - 0.15;
  const body = useMemo(() => wobble(new THREE.CylinderGeometry(0.6, 0.7, 3.1, 18, 6), 0.02, 3), []);
  const roof = useMemo(() => {
    const g = new THREE.ConeGeometry(0.92, 1.7, 18, 5);
    const pos = g.getAttribute("position");
    // A slight witch-hat droop at the tip.
    for (let i = 0; i < pos.count; i++) {
      const h = (pos.getY(i) + 0.85) / 1.7;
      pos.setX(i, pos.getX(i) + h * h * h * 0.22);
    }
    return wobble(g, 0.015, 9);
  }, []);
  const turret = useMemo(() => wobble(new THREE.CylinderGeometry(0.3, 0.26, 1.3, 14, 3), 0.012, 5), []);
  const turretRoof = useMemo(() => wobble(new THREE.ConeGeometry(0.42, 0.95, 14, 3), 0.01, 6), []);
  const annexRoof = useMemo(() => gableRoofGeometry(1.35, 0.6, 1.15), []);
  const plaster = paint("plaster", { map: plasterTexture() });
  const stone = paint("stone", { map: stoneTexture(), color: "#f1ece6" });
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]} userData={{ sketch: 6, sketchRegion: true }}>
      <mesh position={[0, 0.2, 0]} material={stone} castShadow receiveShadow>
        <cylinderGeometry args={[0.8, 0.88, 0.55, 18]} />
        <InkOutline weight="fine" color={INK} />
      </mesh>
      <mesh geometry={body} position={[0, 1.95, 0]} material={plaster} castShadow receiveShadow>
        <InkOutline weight="fine" color={INK} />
      </mesh>
      <mesh position={[0, 3.52, 0]} material={paint("trim", { color: "#c9b59c", map: woodTexture() })} castShadow>
        <cylinderGeometry args={[0.72, 0.64, 0.14, 18]} />
      </mesh>
      <mesh geometry={roof} position={[0, 4.42, 0]} material={paint("roof-coral", { map: roofTexture("coral") })} castShadow>
        <InkOutline weight="medium" color={INK} />
      </mesh>
      <mesh position={[0.2, 5.33, 0]} material={paint("gold", { color: "#e2bd6b", emissive: "#7a5a20", emissiveIntensity: 0.25 })}>
        <sphereGeometry args={[0.06, 10, 8]} />
      </mesh>
      <mesh position={[0.2, 5.55, 0]} material={paint("iron", { color: "#4b3d4c" })}>
        <cylinderGeometry args={[0.012, 0.012, 0.5, 4]} />
      </mesh>
      <group position={[0.2, 5.72, 0]}>
        <Pennant />
      </group>

      {/* Side turret on a corbel. */}
      <group position={[0.62, 2.35, 0.32]}>
        <mesh position={[0, -0.75, 0]} rotation={[Math.PI, 0, 0]} material={plaster} castShadow>
          <coneGeometry args={[0.28, 0.4, 14]} />
        </mesh>
        <mesh geometry={turret} material={plaster} castShadow receiveShadow>
          <InkOutline weight="fine" color={INK} />
        </mesh>
        <mesh geometry={turretRoof} position={[0, 1.1, 0]} material={paint("roof-slate", { map: roofTexture("slate") })} castShadow>
          <InkOutline weight="fine" color={INK} />
        </mesh>
        <Window position={[0.12, 0.1, 0.26]} rotationY={0.45} scale={0.7} />
      </group>

      <Window position={[0.18, 1.55, 0.64]} rotationY={0.28} />
      <Shutters position={[0.18, 1.55, 0.65]} rotationY={0.28} />
      <FlowerBox position={[0.19, 1.36, 0.7]} rotationY={0.28} seed={2} />
      <Window position={[-0.12, 2.75, 0.62]} rotationY={-0.18} scale={0.9} />
      <FlowerBox position={[-0.12, 2.58, 0.68]} rotationY={-0.18} width={0.26} seed={3} />
      <Window position={[0.55, 3.0, 0.35]} rotationY={1.0} scale={0.8} />
      <Ivy position={[-0.38, 0.45, 0.52]} rotationY={-0.6} height={2.4} spread={0.4} seed={4} curve={0.62} />
      <HangingBanner position={[-0.5, 3.42, 0.45]} rotationY={-0.75} />
      <Signpost position={[0.6, 0.0, 1.25]} rotationY={-0.3} />

      {/* Door */}
      <group position={[0.05, 0.62, 0.8]} rotation={[0, 0.06, 0]}>
        <mesh material={paint("door", { map: woodTexture(), color: "#c8835c" })}>
          <boxGeometry args={[0.36, 0.5, 0.06]} />
        </mesh>
        <mesh position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]} material={paint("door", { map: woodTexture(), color: "#c8835c" })}>
          <cylinderGeometry args={[0.18, 0.18, 0.06, 14, 1, false, -Math.PI / 2, Math.PI]} />
        </mesh>
      </group>

      {/* Annex cottage leaning against the tower. */}
      <group position={[-1.05, 0, 0.25]} rotation={[0, 0.25, 0]}>
        <Wall args={[1.1, 0.95, 0.95]} position={[0, 0.48, 0]} />
        <mesh geometry={annexRoof} position={[0, 0.95, 0]} material={paint("roof-coral", { map: roofTexture("coral") })} castShadow>
          <InkOutline weight="fine" color={INK} />
        </mesh>
        <Window position={[0.15, 0.45, 0.49]} rotationY={0} scale={0.85} />
      </group>
    </group>
  );
}

export function Cottage({ x, z, rotationY = 0, animate = true }: { x: number; z: number; rotationY?: number; animate?: boolean }) {
  const y = groundAt(x, z) - 0.08;
  // Slightly lumpy, hand-cut roof rather than a perfect prism.
  const roofGeo = useMemo(() => wobble(gableRoofGeometry(1.75, 0.85, 1.35).toNonIndexed(), 0.018, 7), []);
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]} userData={{ sketch: 6, sketchRegion: true }}>
      <Wall args={[1.45, 1.0, 1.1]} position={[0, 0.5, 0]} />
      <mesh geometry={roofGeo} position={[0, 1.0, 0]} rotation={[0, Math.PI / 2, 0]} material={paint("roof-slate", { map: roofTexture("slate") })} castShadow>
        <InkOutline weight="fine" color={INK} />
      </mesh>
      <mesh position={[0.42, 1.45, -0.2]} material={paint("stone", { map: stoneTexture(), color: "#f1ece6" })} castShadow>
        <boxGeometry args={[0.2, 0.55, 0.2]} />
        <InkOutline weight="fine" color={INK} />
      </mesh>
      {/* Ridge beam and a chimney cap. */}
      <mesh position={[0, 1.84, 0]} rotation={[0, 0, Math.PI / 2]} material={paint("trim", { color: "#c9b59c", map: woodTexture() })}>
        <cylinderGeometry args={[0.035, 0.035, 1.42, 5]} />
      </mesh>
      <mesh position={[0.42, 1.75, -0.2]} material={paint("stone", { map: stoneTexture(), color: "#f1ece6" })}>
        <boxGeometry args={[0.26, 0.06, 0.26]} />
      </mesh>
      <ChimneySmoke position={[0.42, 1.85, -0.2]} animate={animate} />
      <Window position={[-0.35, 0.5, 0.56]} rotationY={0} />
      <Shutters position={[-0.35, 0.5, 0.57]} rotationY={0} color="#9ab68a" />
      <FlowerBox position={[-0.35, 0.31, 0.6]} rotationY={0} seed={5} />
      <Window position={[0.73, 0.5, 0.1]} rotationY={Math.PI / 2} scale={0.85} />
      <FlowerBox position={[0.77, 0.33, 0.1]} rotationY={Math.PI / 2} width={0.26} seed={6} />
      <mesh position={[0.25, 0.32, 0.56]} material={paint("door", { map: woodTexture(), color: "#c8835c" })}>
        <boxGeometry args={[0.3, 0.6, 0.04]} />
      </mesh>
      <Ivy position={[-0.7, 0.0, 0.56]} rotationY={0} height={0.95} spread={0.2} seed={8} />
      <Signpost position={[0.75, 0.0, 0.9]} rotationY={-0.2} color="#f0dcc0" />
    </group>
  );
}
