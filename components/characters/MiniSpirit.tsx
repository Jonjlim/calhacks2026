"use client";

import { InkOutline } from "@/components/world/painterly/InkOutline";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { paint } from "@/components/world/painterly/materials";
import { onGiftPop } from "@/components/world/worldEvents";
import { playSfx } from "@/components/world/sounds";
import { SPIRIT_LOOKS, type SpiritVariant } from "./spiritVariants";

const INK = "#3b2a36";
const FACE = "#fbf3e8";

export type SpiritBehavior = "idle" | "wave" | "sway";

export interface MiniSpiritProps {
  variant: SpiritVariant;
  position: [number, number, number];
  /** World point the spirit turns its head toward. */
  lookAt?: [number, number, number];
  scale?: number;
  behavior?: SpiritBehavior;
  animate: boolean;
  seed?: number;
}

function cloakGeometry() {
  const pts = [
    [0.0, 0.0],
    [0.23, 0.0],
    [0.255, 0.04],
    [0.235, 0.14],
    [0.19, 0.27],
    [0.135, 0.37],
    [0.08, 0.42],
    [0.0, 0.43],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 22);
}

function wizardHatGeometry() {
  const g = new THREE.ConeGeometry(0.2, 0.46, 18, 6, true);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const h = (pos.getY(i) + 0.23) / 0.46;
    pos.setZ(i, pos.getZ(i) - h * h * h * 0.16);
    pos.setY(i, pos.getY(i) - h * h * h * 0.04);
  }
  g.computeVertexNormals();
  return g;
}

export function MiniSpirit({ variant, position, lookAt, scale = 1, behavior = "idle", animate, seed = 1 }: MiniSpiritProps) {
  const look = SPIRIT_LOOKS[variant];
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const anim = useRef({ nextBlink: 1 + seed, blinkUntil: 0, nextHop: 4 + seed * 2.3, hopAt: -10, hopQueued: -1, waveAt: -10, nextWave: 3 + seed });

  const geos = useMemo(() => {
    // Hood: a sphere shell with the face opening toward +z.
    const gap = 2.1;
    const hood = new THREE.SphereGeometry(0.255, 24, 16, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, 0, 2.05);
    return { cloak: cloakGeometry(), hood, hat: wizardHatGeometry() };
  }, []);

  const mats = useMemo(
    () => ({
      cloak: paint(`spirit-cloak-${variant}`, { color: look.cloak }),
      shade: paint(`spirit-shade-${variant}`, { color: look.cloakShade }),
      hood: paint(`spirit-hood-${variant}`, { color: look.cloak, side: THREE.DoubleSide }),
      face: paint("spirit-face", { color: FACE }),
      ink: paint("spirit-ink", { color: "#2b2130" }),
      white: paint("spirit-white", { color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.6 }),
      blush: new THREE.MeshBasicMaterial({ color: "#f39b9b", transparent: true, opacity: 0.55, depthWrite: false }),
      accent: paint(`spirit-accent-${variant}`, { color: look.accent }),
      gold: paint("gold", { color: "#e2bd6b", emissive: "#7a5a20", emissiveIntensity: 0.25 }),
    }),
    [variant, look],
  );

  useEffect(
    () =>
      onGiftPop(() => {
        anim.current.hopQueued = 0.12 + (seed % 3) * 0.09;
      }),
    [seed],
  );

  const target = useMemo(() => (lookAt ? new THREE.Vector3(...lookAt) : null), [lookAt]);

  useFrame(({ clock }, dt) => {
    const a = anim.current;
    const t = clock.elapsedTime;
    const b = body.current;
    const h = head.current;
    if (!b || !h || !root.current) return;

    if (a.hopQueued >= 0) {
      a.hopQueued -= dt;
      if (a.hopQueued < 0) a.hopAt = t;
    }
    if (animate && t > a.nextHop) {
      a.hopAt = t;
      a.nextHop = t + 6 + ((seed * 7.3 + t) % 6);
    }

    const breathe = animate ? Math.sin(t * 2.2 + seed) * 0.025 : 0;
    let sy = 1 + breathe;
    let sxz = 1 - breathe * 0.6;
    let y = 0;
    const hopAge = t - a.hopAt;
    if (hopAge >= 0 && hopAge < 0.75) {
      if (hopAge < 0.1) {
        sy *= 1 - 0.12 * (hopAge / 0.1);
        sxz *= 1 + 0.08 * (hopAge / 0.1);
      } else if (hopAge < 0.5) {
        const k = (hopAge - 0.1) / 0.4;
        y = Math.sin(k * Math.PI) * 0.22;
        sy *= 1 + 0.1 * Math.sin(k * Math.PI);
        sxz *= 1 - 0.05 * Math.sin(k * Math.PI);
      } else {
        const k = hopAge - 0.5;
        const settle = Math.exp(-k * 10) * Math.cos(k * 30);
        sy *= 1 - 0.1 * settle;
        sxz *= 1 + 0.06 * settle;
      }
    }
    b.position.y = y;
    b.scale.set(sxz, sy, sxz);

    // Head: gentle tilt plus turning toward whatever it is watching.
    if (animate) {
      h.rotation.z = Math.sin(t * 0.7 + seed) * 0.09;
      h.rotation.x = Math.sin(t * 0.5 + seed * 2) * 0.04 - 0.06;
    }
    if (target) {
      const local = root.current.worldToLocal(target.clone());
      const yaw = Math.atan2(local.x, local.z);
      h.rotation.y = THREE.MathUtils.clamp(yaw, -0.7, 0.7) + (animate ? Math.sin(t * 0.33 + seed) * 0.12 : 0);
    }

    // Blink.
    if (animate && t > a.nextBlink) {
      a.blinkUntil = t + 0.12;
      a.nextBlink = t + 2.4 + ((seed * 3.7 + t * 1.3) % 3);
    }
    if (eyes.current) eyes.current.scale.y = t < a.blinkUntil ? 0.12 : look.eyeOpen;

    // Arms: little swing, occasional wave.
    if (animate && behavior === "wave" && t > a.nextWave) {
      a.waveAt = t;
      a.nextWave = t + 5 + (seed % 4);
    }
    const waveAge = t - a.waveAt;
    const waving = waveAge >= 0 && waveAge < 1.6;
    if (armR.current) {
      armR.current.rotation.z = waving ? -2.3 + Math.sin(waveAge * 14) * 0.35 : -0.35 + (animate ? Math.sin(t * 2.2 + seed) * 0.05 : 0);
    }
    if (armL.current) armL.current.rotation.z = 0.35 - (animate ? Math.sin(t * 2.2 + seed) * 0.05 : 0);
    if (behavior === "sway" && animate) root.current.rotation.z = Math.sin(t * 1.4 + seed) * 0.04;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    playSfx("tap");
    anim.current.hopQueued = 0;
    anim.current.waveAt = -10;
  };

  return (
    <group ref={root} position={position} scale={scale}>
      <group
        ref={body}
        onClick={onClick}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        {/* Feet */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.085, 0.035, 0.06]} scale={[1, 0.7, 1.25]} material={mats.ink}>
            <sphereGeometry args={[0.055, 10, 8]} />
          </mesh>
        ))}
        <mesh geometry={geos.cloak} material={mats.cloak} castShadow receiveShadow>
          <InkOutline weight="fine" color={INK} />
        </mesh>
        {/* Arms pivot at the shoulder. */}
        <group ref={armR} position={[0.17, 0.3, 0.02]}>
          <mesh position={[0, -0.09, 0]} material={mats.shade} castShadow>
            <capsuleGeometry args={[0.042, 0.1, 4, 8]} />
          </mesh>
          <mesh position={[0, -0.16, 0]} material={mats.face}>
            <sphereGeometry args={[0.035, 8, 6]} />
          </mesh>
        </group>
        <group ref={armL} position={[-0.17, 0.3, 0.02]}>
          <mesh position={[0, -0.09, 0]} material={mats.shade} castShadow>
            <capsuleGeometry args={[0.042, 0.1, 4, 8]} />
          </mesh>
          <mesh position={[0, -0.16, 0]} material={mats.face}>
            <sphereGeometry args={[0.035, 8, 6]} />
          </mesh>
        </group>

        <group ref={head} position={[0, 0.6, 0]}>
          <mesh scale={[1, 0.93, 0.95]} material={mats.face} castShadow>
            <sphereGeometry args={[0.22, 24, 18]} />
            <InkOutline weight="fine" color={INK} />
          </mesh>
          {/* Eyes, with a tiny catch-light. */}
          <group ref={eyes} position={[0, -0.005, 0]}>
            {[-1, 1].map((s) => (
              <group key={s} position={[s * 0.075, 0, 0.19]}>
                <mesh scale={[0.8, 1.15, 0.5]} material={mats.ink}>
                  <sphereGeometry args={[0.03, 12, 10]} />
                </mesh>
                <mesh position={[0.008, 0.012, 0.014]} material={mats.white}>
                  <sphereGeometry args={[0.008, 6, 6]} />
                </mesh>
              </group>
            ))}
          </group>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.125, -0.055, 0.17]} rotation={[0, s * 0.6, 0]} material={mats.blush}>
              <circleGeometry args={[0.032, 12]} />
            </mesh>
          ))}
          <mesh position={[0, -0.06, 0.205]} rotation={[0, 0, Math.PI]} material={mats.ink}>
            <torusGeometry args={[0.02, 0.0055, 4, 10, Math.PI]} />
          </mesh>

          {look.headwear === "hood" && (
            <mesh geometry={geos.hood} position={[0, 0.02, -0.02]} material={mats.hood} castShadow>
              <InkOutline weight="fine" color={INK} />
            </mesh>
          )}
          {look.headwear === "wizard-hat" && (
            <group position={[0, 0.17, -0.02]} rotation={[-0.15, 0, 0.12]}>
              <mesh position={[0, -0.01, 0]} scale={[1, 0.25, 1]} material={mats.shade} castShadow>
                <cylinderGeometry args={[0.3, 0.3, 0.06, 24]} />
                <InkOutline weight="fine" color={INK} />
              </mesh>
              <mesh geometry={geos.hat} position={[0, 0.23, 0]} material={mats.hood} castShadow>
                <InkOutline weight="fine" color={INK} />
              </mesh>
              <mesh position={[0.08, 0.16, 0.13]} rotation={[0.3, 0.3, 0.4]} material={mats.gold}>
                <octahedronGeometry args={[0.035, 0]} />
              </mesh>
            </group>
          )}

          {look.accessory === "scarf" && (
            <group position={[0, -0.2, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.shade} castShadow>
                <torusGeometry args={[0.15, 0.045, 8, 20]} />
              </mesh>
              <mesh position={[0.09, -0.08, 0.12]} rotation={[0.2, 0, 0.35]} material={mats.shade}>
                <boxGeometry args={[0.07, 0.15, 0.03]} />
              </mesh>
            </group>
          )}
          {look.accessory === "flower" && (
            <group position={[0.16, 0.15, 0.1]} rotation={[0.3, 0.6, 0.2]}>
              {[0, 1, 2, 3, 4].map((k) => (
                <mesh key={k} position={[Math.cos((k / 5) * Math.PI * 2) * 0.035, Math.sin((k / 5) * Math.PI * 2) * 0.035, 0]} scale={[1, 1, 0.45]} material={mats.accent}>
                  <sphereGeometry args={[0.028, 8, 6]} />
                </mesh>
              ))}
              <mesh position={[0, 0, 0.012]} material={mats.gold}>
                <sphereGeometry args={[0.02, 8, 6]} />
              </mesh>
            </group>
          )}
          {look.accessory === "leaf" && (
            <group position={[0.02, 0.27, -0.02]} rotation={[0, 0, -0.5]}>
              <mesh position={[0, -0.02, 0]} material={mats.accent}>
                <cylinderGeometry args={[0.008, 0.01, 0.06, 5]} />
              </mesh>
              <mesh position={[0.05, 0.03, 0]} rotation={[0, 0, -0.6]} scale={[1.8, 0.7, 0.25]} material={mats.accent}>
                <sphereGeometry args={[0.045, 10, 8]} />
                <InkOutline weight="fine" color={INK} />
              </mesh>
            </group>
          )}
          {look.accessory === "goggles" && (
            <group position={[0, 0.13, 0.16]} rotation={[-0.55, 0, 0]}>
              {[-1, 1].map((s) => (
                <group key={s} position={[s * 0.065, 0, 0]}>
                  <mesh material={paint("brass", { color: "#a9733f" })}>
                    <torusGeometry args={[0.042, 0.013, 6, 14]} />
                  </mesh>
                  <mesh material={paint("goggle-glass", { color: look.accent, emissive: "#2b6f88", emissiveIntensity: 0.2 })}>
                    <circleGeometry args={[0.036, 14]} />
                  </mesh>
                </group>
              ))}
            </group>
          )}
          {variant === "explorer" && (
            <mesh position={[0, 0.19, -0.2]} rotation={[-1.1, 0, 0]} material={mats.hood}>
              <coneGeometry args={[0.09, 0.2, 12]} />
            </mesh>
          )}
        </group>
      </group>
      {/* Soft painted contact shadow keeps tiny characters grounded. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.26, 20]} />
        <meshBasicMaterial color="#3a3550" transparent opacity={0.22} depthWrite={false} />
      </mesh>
    </group>
  );
}
