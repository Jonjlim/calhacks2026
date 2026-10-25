"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { book, useBookOpen } from "@/components/book/bookStore";
import { useConvergenceActive } from "@/components/convergence/convergenceClock";
import { paint } from "../painterly/materials";
import { sparkleTexture } from "../painterly/textures";
import { GIFT_SPOT } from "../sceneConfig";
import { groundAt } from "../terrain";

/**
 * The enchanted book on its little lectern beside the present: the way into
 * the Book of Possibilities from inside the world. It breathes, glows when
 * hovered, and when it is chosen it rises, turns toward the viewer and opens
 * before the painted pages take over (components/book). The same store drives
 * it back down when the pages close.
 */

const AT = { x: GIFT_SPOT.x - 1.7, z: GIFT_SPOT.z + 3.9 };
const COVER = "#b9524a";
const _cam = new THREE.Vector3();
const _me = new THREE.Vector3();

export function EnchantedBook({ animate }: { animate: boolean }) {
  const camera = useThree((st) => st.camera);
  const open = useBookOpen();
  const revealing = useConvergenceActive();
  const root = useRef<THREE.Group>(null);
  const lift = useRef<THREE.Group>(null);
  const cover = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Sprite>(null);
  const [hover, setHover] = useState(false);
  const hoverK = useRef(0);
  const y = groundAt(AT.x, AT.z);

  const mats = useMemo(
    () => ({
      cover: paint("book-cover", { color: COVER, emissive: "#6b2a28", emissiveIntensity: 0.2 }),
      trim: paint("book-trim", { color: "#e2bd6b", emissive: "#7a5a20", emissiveIntensity: 0.35 }),
      pages: paint("book-pages", { color: "#fbf1d8", emissive: "#f6dca0", emissiveIntensity: 0.15 }),
      wood: paint("book-wood", { color: "#9a6b45" }),
    }),
    [],
  );
  const glowMat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color: "#ffd98a", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), []);
  useEffect(() => () => glowMat.dispose(), [glowMat]);
  useEffect(() => () => void (document.body.style.cursor = ""), []);

  useFrame(({ clock }, dt) => {
    const r = root.current;
    const l = lift.current;
    if (!r || !l) return;
    const t = clock.elapsedTime;
    const p = book.progress();
    hoverK.current += ((hover && !open ? 1 : 0) - hoverK.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 9));
    // Raised toward the viewer, turned to face it, and opened.
    _cam.copy(camera.position);
    _me.set(AT.x, y, AT.z);
    const face = Math.atan2(_cam.x - AT.x, _cam.z - AT.z);
    const idle = animate ? Math.sin(t * 1.4) * 0.04 : 0;
    r.visible = p < 0.985 && !revealing;
    l.position.set(0, 0.78 + idle + p * 2.4 + hoverK.current * 0.06, 0);
    l.rotation.set(-0.35 * (1 - p) - p * 0.55, THREE.MathUtils.lerp(0.5, face, p), 0);
    l.scale.setScalar((1 + hoverK.current * 0.1) * (1 + p * 1.6));
    const flip = THREE.MathUtils.smoothstep(p, 0.3, 0.95);
    if (cover.current) cover.current.rotation.z = flip * 2.75;
    const g = glow.current;
    if (g) {
      g.visible = r.visible;
      g.scale.setScalar(1.7 + (animate ? Math.sin(t * 2.2) * 0.18 : 0) + hoverK.current * 0.8 + p * 2);
      glowMat.opacity = 0.35 + hoverK.current * 0.4 + (animate ? 0.12 * Math.sin(t * 2.2) : 0);
    }
  });

  return (
    <group ref={root} position={[AT.x, y, AT.z]} scale={1.7}>
      {/* The lectern. */}
      <mesh position={[0, 0.3, 0]} material={mats.wood} castShadow>
        <cylinderGeometry args={[0.07, 0.11, 0.62, 8]} />
      </mesh>
      <mesh position={[0, 0.02, 0]} material={mats.wood}>
        <cylinderGeometry args={[0.3, 0.34, 0.06, 10]} />
      </mesh>
      <mesh position={[0, 0.63, 0.04]} rotation={[-0.35, 0.5, 0]} material={mats.wood} castShadow>
        <boxGeometry args={[1.0, 0.06, 0.78]} />
      </mesh>
      <sprite ref={glow} material={glowMat} position={[0, 1.15, 0.05]} />
      {/* The book. */}
      <group ref={lift} position={[0, 0.78, 0]}>
        <mesh position={[0, 0, 0]} material={mats.cover} castShadow>
          <boxGeometry args={[0.72, 0.045, 0.94]} />
        </mesh>
        <mesh position={[0, 0.065, 0]} material={mats.pages}>
          <boxGeometry args={[0.66, 0.09, 0.88]} />
        </mesh>
        <mesh position={[-0.37, 0.03, 0]} material={mats.cover}>
          <boxGeometry args={[0.05, 0.16, 0.94]} />
        </mesh>
        {/* The front cover hinges at the spine and swings over to the left. */}
        <group ref={cover} position={[-0.36, 0.125, 0]}>
          <mesh position={[0.36, 0.0225, 0]} material={mats.cover} castShadow>
            <boxGeometry args={[0.72, 0.045, 0.94]} />
          </mesh>
          <mesh position={[0.36, 0.05, 0]} material={mats.trim}>
            <octahedronGeometry args={[0.1, 0]} />
          </mesh>
          <mesh position={[0.36, 0.048, 0]} material={mats.trim}>
            <boxGeometry args={[0.6, 0.006, 0.82]} />
          </mesh>
        </group>
        {/* A generous target: it is the one thing to touch beside the present. */}
        <mesh
          position={[0, 0.2, 0]}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHover(true);
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            setHover(false);
            document.body.style.cursor = "";
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            book.show();
          }}
        >
          <sphereGeometry args={[0.95, 12, 10]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <Html position={[0, 2.2, 0]} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
        <span data-map-token style={{ opacity: hover && !open ? 1 : 0, transition: "opacity .2s", font: "600 12.5px/1 var(--font-figtree, system-ui)", padding: "6px 12px", borderRadius: 999, color: "#4e2f42", background: "#fff8e3", border: "1.5px solid #e2bd6b", boxShadow: "0 8px 18px -10px rgba(40,24,44,.6)", whiteSpace: "nowrap" }}>
          Book of Possibilities
        </span>
      </Html>
    </group>
  );
}
