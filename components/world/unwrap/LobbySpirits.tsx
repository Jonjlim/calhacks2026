"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { type AvatarClip, AVATAR_WORLD_SCALE, StorybookAvatar } from "@/components/characters/StorybookAvatar";
import { type LobbyMember, lobby, useLobbyMembers } from "@/components/unwrap/lobbyStore";
import { unwrapClock } from "@/components/unwrap/unwrapTimeline";
import { sparkleTexture } from "../painterly/textures";
import { platformTop } from "../props/Stonework";
import { GIFT_SPOT } from "../sceneConfig";
import { GIFT_BOX, lobbyPose } from "./invitationLayout";

/**
 * One storybook spirit per confirmed participant of the lobby — never more,
 * never invented. Keyed by participant id, so a reconnect or a re-sent join
 * can't add a second spirit. A new arrival pops in with a hop and a sparkle,
 * celebrates, and shows its name for a few seconds; members that were already
 * there when a lobby was restored simply stand in their places.
 */

/**
 * Gathering spots on the pedestal: the four corners between the box's
 * folded-down walls (so nobody stands on a wall or the code), then a wider
 * ring further out. Front corners first.
 */
const SPOTS: [number, number][] = (() => {
  const yaw = GIFT_BOX.rotationY;
  const out: [number, number][] = [];
  const corners: [number, number][] = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (const [radius, spread] of [
    [1.78, 0],
    [2.45, 0.24],
    [2.45, -0.24],
  ] as const) {
    for (const [cx, cz] of corners) {
      const a = Math.atan2(cz, cx) + spread;
      const lx = Math.cos(a) * radius;
      const lz = Math.sin(a) * radius;
      out.push([GIFT_SPOT.x + lx * Math.cos(yaw) + lz * Math.sin(yaw), GIFT_SPOT.z - lx * Math.sin(yaw) + lz * Math.cos(yaw)]);
    }
  }
  return out;
})();
const NAME_SECONDS = 4.5;

function nameTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-cormorant").trim() || "Georgia";
  ctx.font = `600 64px ${family}`;
  const w = Math.min(500, ctx.measureText(name).width + 70);
  ctx.fillStyle = "rgba(251,243,227,0.94)";
  ctx.strokeStyle = "rgba(107,70,88,0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect((512 - w) / 2, 18, w, 92, 46);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#4e2f42";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 256, 66, 460);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Spirit({ member, spot, arrive, animate }: { member: LobbyMember; spot: [number, number]; arrive: boolean; animate: boolean }) {
  const root = useRef<THREE.Group>(null);
  const label = useRef<THREE.Sprite>(null);
  const puff = useRef<THREE.Sprite>(null);
  const size = useThree((s) => s.size);
  const [clip, setClip] = useState<AvatarClip>(arrive && animate ? "Celebrate" : "Idle");
  const born = useRef(-1);
  const [x, z] = spot;
  const y = platformTop() - 0.02;
  const facing = useMemo(() => {
    const cam = lobbyPose(size.width, size.height).position;
    return Math.atan2(cam[0] - x, cam[2] - z);
  }, [size.width, size.height, x, z]);
  const labelMat = useMemo(() => new THREE.SpriteMaterial({ map: nameTexture(member.displayName), transparent: true, depthWrite: false, depthTest: false }), [member.displayName]);
  const puffMat = useMemo(() => new THREE.SpriteMaterial({ map: sparkleTexture(), color: "#ffe6a3", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  useEffect(() => () => {
    labelMat.map?.dispose();
    labelMat.dispose();
    puffMat.dispose();
  }, [labelMat, puffMat]);

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g) return;
    if (born.current < 0) born.current = clock.elapsedTime;
    const age = clock.elapsedTime - born.current;
    const k = arrive && animate ? Math.min(1, age / 0.6) : 1;
    // Materialise: grow with an overshoot and a little hop.
    const s = k >= 1 ? 1 : 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
    g.scale.setScalar(Math.max(0.0001, s) * AVATAR_WORLD_SCALE);
    g.position.y = y + (arrive && animate ? Math.sin(Math.min(1, age / 0.7) * Math.PI) * 0.45 : 0);
    if (puff.current) {
      const p = arrive ? Math.min(1, age / 0.9) : 1;
      puff.current.visible = p < 1;
      puff.current.scale.setScalar(0.4 + p * 1.6);
      puffMat.opacity = 1 - p;
    }
    if (label.current) {
      const fade = arrive ? 1 - THREE.MathUtils.smoothstep(age, NAME_SECONDS - 0.8, NAME_SECONDS) : 0;
      label.current.visible = fade > 0.01;
      labelMat.opacity = fade * Math.min(1, age / 0.4);
    }
  });

  const finished = useCallback(() => setClip("Idle"), []);
  return (
    <group position={[x, y, z]}>
      <group ref={root} rotation={[0, facing, 0]} scale={AVATAR_WORLD_SCALE}>
        <StorybookAvatar avatar={member.avatar} clip={clip} onClipFinished={finished} scale={1} />
      </group>
      <sprite ref={puff} material={puffMat} position={[0, 0.5, 0]} visible={false} />
      <sprite ref={label} material={labelMat} position={[0, 1.55, 0]} scale={[1.6, 0.4, 1]} renderOrder={10} visible={false} />
    </group>
  );
}

export function LobbySpirits({ animate }: { animate: boolean }) {
  const members = useLobbyMembers();
  const active = useRef(false);
  const [, force] = useState(0);
  // Only while the lobby is on screen.
  useEffect(() => unwrapClock.subscribe(() => {
    const on = unwrapClock.active && !!unwrapClock.invite;
    if (on !== active.current) {
      active.current = on;
      force((n) => n + 1);
    }
  }), []);
  if (!unwrapClock.active || !unwrapClock.invite) return null;
  return (
    <group>
      {members
        .filter((m) => m.role !== "organizer")
        .map((m, i) => (
          <Suspense key={m.id} fallback={null}>
            <Spirit member={m} spot={SPOTS[i % SPOTS.length]!} arrive={!lobby.settled.has(m.id)} animate={animate} />
          </Suspense>
        ))}
    </group>
  );
}
