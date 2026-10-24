"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { InkOutline } from "@/components/world/painterly/InkOutline";
import { paint } from "@/components/world/painterly/materials";
import { DECORATION_COLOR_HEX, type DecorationSpec } from "@/lib/council/contracts";

/**
 * The approved decoration library as small hand-built primitives, one per
 * `assetId` in lib/council/library.json. Cheap to render, nothing loaded or
 * generated at runtime. Unknown ids cannot reach here (validated upstream),
 * but fall back to the memory heart just in case.
 */

const INK = "#3d2c35";
const shared = {
  cream: () => paint("deco-cream", { color: "#f6ecdc" }),
  wood: () => paint("deco-wood", { color: "#a9774f" }),
  brass: () => paint("deco-brass", { color: "#d9b66f" }),
  ink: () => paint("deco-ink", { color: "#41344c" }),
};

function heartShape() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.08);
  s.bezierCurveTo(-0.1, 0, -0.1, 0.08, -0.05, 0.09);
  s.bezierCurveTo(-0.02, 0.1, 0, 0.07, 0, 0.05);
  s.bezierCurveTo(0, 0.07, 0.02, 0.1, 0.05, 0.09);
  s.bezierCurveTo(0.1, 0.08, 0.1, 0, 0, -0.08);
  return s;
}

function starShape() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.04 : 0.09;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

const extrude = { depth: 0.035, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 };

function Body({ assetId, color }: { assetId: string; color: THREE.Material }) {
  const bowl = useMemo(
    () => new THREE.LatheGeometry([[0, 0], [0.06, 0.005], [0.09, 0.04], [0.1, 0.09], [0.088, 0.095], [0.078, 0.05], [0.05, 0.02], [0, 0.02]].map(([x, y]) => new THREE.Vector2(x, y)), 24),
    [],
  );
  const heart = useMemo(() => new THREE.ExtrudeGeometry(heartShape(), extrude).translate(0, 0, -0.017), []);
  const star = useMemo(() => new THREE.ExtrudeGeometry(starShape(), extrude).translate(0, 0, -0.017), []);
  switch (assetId) {
    case "ceramic_charm":
      return (
        <group>
          <mesh geometry={bowl} material={color} position={[0, -0.05, 0]} castShadow>
            <InkOutline weight="fine" color={INK} />
          </mesh>
          {/* Glaze drip band */}
          <mesh position={[0, 0.03, 0]} material={shared.cream()}>
            <torusGeometry args={[0.096, 0.008, 6, 24]} />
          </mesh>
        </group>
      );
    case "book_charm":
      return (
        <group rotation={[0, 0.4, 0]}>
          <mesh material={color} castShadow>
            <boxGeometry args={[0.15, 0.19, 0.05]} />
            <InkOutline weight="fine" color={INK} />
          </mesh>
          <mesh material={shared.cream()} position={[0.008, 0, 0]}>
            <boxGeometry args={[0.14, 0.175, 0.055]} />
          </mesh>
        </group>
      );
    case "music_note":
      return (
        <group>
          <mesh material={color} position={[-0.03, -0.06, 0]} scale={[1.2, 0.85, 0.8]} castShadow>
            <sphereGeometry args={[0.04, 14, 10]} />
          </mesh>
          <mesh material={color} position={[0.012, 0.02, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.17, 6]} />
          </mesh>
          <mesh material={color} position={[0.045, 0.09, 0]} rotation={[0, 0, -0.6]}>
            <boxGeometry args={[0.07, 0.02, 0.02]} />
          </mesh>
        </group>
      );
    case "paintbrush":
      return (
        <group rotation={[0, 0, 0.7]}>
          <mesh material={shared.wood()} position={[0, -0.03, 0]}>
            <cylinderGeometry args={[0.013, 0.016, 0.16, 8]} />
          </mesh>
          <mesh material={shared.brass()} position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.018, 0.015, 0.03, 8]} />
          </mesh>
          <mesh material={color} position={[0, 0.1, 0]} castShadow>
            <coneGeometry args={[0.02, 0.06, 8]} />
          </mesh>
        </group>
      );
    case "leaf_sprig":
      return (
        <group>
          {[-0.5, 0.2, 0.9].map((a, i) => (
            <mesh key={i} material={color} position={[Math.sin(a) * 0.04, i * 0.04 - 0.04, 0]} rotation={[0, 0, a]} scale={[0.5, 1, 0.15]} castShadow>
              <sphereGeometry args={[0.06, 10, 8]} />
            </mesh>
          ))}
        </group>
      );
    case "coffee_cup":
      return (
        <group>
          <mesh material={color} castShadow>
            <cylinderGeometry args={[0.065, 0.05, 0.11, 18]} />
            <InkOutline weight="fine" color={INK} />
          </mesh>
          <mesh material={color} position={[0.07, 0, 0]}>
            <torusGeometry args={[0.03, 0.01, 6, 14]} />
          </mesh>
        </group>
      );
    case "camera_charm":
      return (
        <group>
          <mesh material={color} castShadow>
            <boxGeometry args={[0.17, 0.11, 0.07]} />
            <InkOutline weight="fine" color={INK} />
          </mesh>
          <mesh material={shared.ink()} position={[0, 0, 0.045]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.03, 16]} />
          </mesh>
        </group>
      );
    case "map_pin":
      return (
        <group>
          <mesh material={color} position={[0, 0.04, 0]} castShadow>
            <sphereGeometry args={[0.055, 16, 12]} />
          </mesh>
          <mesh material={color} position={[0, -0.04, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.04, 0.09, 12]} />
          </mesh>
          <mesh material={shared.cream()} position={[0, 0.045, 0.045]}>
            <sphereGeometry args={[0.018, 8, 6]} />
          </mesh>
        </group>
      );
    case "whisk_charm":
      return (
        <group>
          <mesh material={shared.wood()} position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.014, 0.014, 0.07, 8]} />
          </mesh>
          {[0, 1.05, 2.1].map((r) => (
            <mesh key={r} material={color} position={[0, 0.02, 0]} rotation={[0, r, 0]} scale={[0.7, 1.2, 1]}>
              <torusGeometry args={[0.05, 0.006, 6, 18]} />
            </mesh>
          ))}
        </group>
      );
    case "yarn_ball":
      return (
        <group>
          <mesh material={color} castShadow>
            <sphereGeometry args={[0.08, 16, 12]} />
          </mesh>
          {[0, 0.8, 1.6].map((r) => (
            <mesh key={r} material={shared.cream()} rotation={[r, r * 0.6, 0]}>
              <torusGeometry args={[0.081, 0.004, 4, 24]} />
            </mesh>
          ))}
        </group>
      );
    case "star_charm":
      return (
        <mesh geometry={star} material={color} castShadow>
          <InkOutline weight="fine" color={INK} />
        </mesh>
      );
    default:
      return (
        <mesh geometry={heart} material={color} castShadow>
          <InkOutline weight="fine" color={INK} />
        </mesh>
      );
  }
}

export function Decoration({ spec, scale = 1 }: { spec: Pick<DecorationSpec, "assetId" | "color">; scale?: number }) {
  const material = paint(`deco-${spec.color}`, { color: DECORATION_COLOR_HEX[spec.color] ?? "#e07a62" });
  return (
    <group scale={scale}>
      <Body assetId={spec.assetId} color={material} />
    </group>
  );
}
