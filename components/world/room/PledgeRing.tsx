"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AvatarId } from "@/components/characters/StorybookAvatar";
import { portraitUrl } from "@/lib/room/avatars";
import { platformTop } from "../props/Stonework";
import { GIFT_SPOT } from "../sceneConfig";
import { emitGiftPop } from "../worldEvents";
import s from "./gift-rings.module.css";

/**
 * The shared yes, drawn above the island's present: one arc per friend,
 * sized to their share of the frozen revision. An arc lights up when that
 * friend approves; when every arc is lit the ring turns gold and the friends
 * celebrate. Display only: approvals come from the room's proposal.
 */

export interface PledgeSegment {
  participantId: string;
  name: string;
  avatar: AvatarId;
  color: string;
  amountLabel: string;
  /** 0..1 of the payable total. */
  fraction: number;
  status: "pending" | "approved" | "invalidated" | "withdrawn";
}

export interface PledgeWorld {
  revisionId: string;
  segments: PledgeSegment[];
  allApproved: boolean;
  feasible: boolean;
}

const RADIUS = 2.5;
const GAP = 0.06;
const GOLD = new THREE.Color("#ffd47a");

function Arc({ start, length, color, lit, allApproved }: { start: number; length: number; color: string; lit: boolean; allApproved: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, fog: false }), [color]);
  const base = useMemo(() => new THREE.Color(color), [color]);
  const geometry = useMemo(() => new THREE.TorusGeometry(RADIUS, 0.11, 10, 64, Math.max(0.02, length - GAP)), [length]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame(({ clock }, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 6);
    material.opacity += ((lit ? 1 : 0.32) - material.opacity) * k;
    material.color.lerp(allApproved ? GOLD : base, k);
    const pulse = lit ? 1 + Math.sin(clock.elapsedTime * 3 + start) * 0.06 : 1;
    if (mesh.current) mesh.current.scale.set(1, 1, lit ? 1.6 * pulse : 1);
  });
  return <mesh ref={mesh} geometry={geometry} material={material} rotation={[0, 0, start + GAP / 2]} />;
}

/** A short burst of gold motes when the last approval lands. */
function Burst({ fire }: { fire: number }) {
  const points = useRef<THREE.Points>(null);
  const born = useRef(-10);
  const seeds = useMemo(() => Array.from({ length: 70 }, (_, i) => new THREE.Vector3(Math.cos(i * 2.4), 0.4 + ((i * 37) % 10) / 10, Math.sin(i * 2.4)).normalize()), []);
  const geometry = useMemo(() => new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(seeds.length * 3), 3)), [seeds]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    if (fire) born.current = -1;
  }, [fire]);
  useFrame(({ clock }) => {
    if (born.current === -1) born.current = clock.elapsedTime;
    const age = clock.elapsedTime - born.current;
    const p = points.current;
    if (!p) return;
    p.visible = age < 1.8;
    if (!p.visible) return;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    seeds.forEach((d, i) => pos.setXYZ(i, d.x * age * 3.2, d.y * age * 3.2 - age * age * 0.9, d.z * age * 3.2));
    pos.needsUpdate = true;
    (p.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age / 1.8);
  });
  return (
    <points ref={points} geometry={geometry} visible={false}>
      <pointsMaterial color="#ffe3a0" size={0.22} transparent depthWrite={false} fog={false} />
    </points>
  );
}

export function PledgeRing({ pledge, animate }: { pledge: PledgeWorld; animate: boolean }) {
  const spin = useRef<THREE.Group>(null);
  const center = useMemo(() => new THREE.Vector3(GIFT_SPOT.x, platformTop() + 3.1, GIFT_SPOT.z), []);
  const [burst, setBurst] = useState(0);
  const was = useRef(pledge.allApproved);
  useEffect(() => {
    // The last yes: gold motes, and the friends on the island cheer.
    if (pledge.allApproved && !was.current) {
      setBurst((n) => n + 1);
      emitGiftPop();
    }
    was.current = pledge.allApproved;
  }, [pledge.allApproved]);
  useFrame((_, dt) => {
    if (spin.current && animate) spin.current.rotation.y += Math.min(dt, 0.1) * (pledge.allApproved ? 0.8 : 0.12);
  });
  let start = -Math.PI / 2;
  const arcs = pledge.segments.map((seg) => {
    const length = Math.max(0.12, seg.fraction * Math.PI * 2);
    const arc = { seg, start, length };
    start += length;
    return arc;
  });
  return (
    <group position={center}>
      <group ref={spin}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {arcs.map(({ seg, start: a, length }) => (
            <Arc key={seg.participantId} start={a} length={length} color={seg.color} lit={seg.status === "approved"} allApproved={pledge.allApproved} />
          ))}
        </group>
        {arcs.map(({ seg, start: a, length }) => {
          const mid = a + length / 2;
          return (
            <Html key={seg.participantId} position={[Math.cos(mid) * (RADIUS + 0.9), 0.2, -Math.sin(mid) * (RADIUS + 0.9)]} center zIndexRange={[40, 30]}>
              <span className={`${s.pledgeFace} ${seg.status === "approved" ? s.pledgeYes : ""}`} style={{ ["--who" as string]: seg.color }}>
                <img src={portraitUrl(seg.avatar)} alt="" />
                <b>{seg.amountLabel}</b>
                <i aria-label={seg.status}>{seg.status === "approved" ? "✓" : seg.status === "pending" ? "…" : "↺"}</i>
              </span>
            </Html>
          );
        })}
      </group>
      <Burst fire={burst} />
    </group>
  );
}
