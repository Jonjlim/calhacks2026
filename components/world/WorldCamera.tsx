"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { introClock } from "@/components/intro/introTimeline";
import { CameraTour, TOUR_START } from "./cameraPath";
import { type CameraPose, landingPose, OPENING_CAMERA, storybookPose } from "./sceneConfig";

/**
 * The only camera controller. During the intro it follows the shared intro
 * clock (storybook framing → authored tour → landing); afterwards it holds the
 * responsive landing composition with a small, damped pointer parallax. The
 * view offset shifts the projection centre right so the island sits beside
 * the editorial column without changing the perspective.
 */
export function WorldCamera({ parallax }: { parallax: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const pointer = useRef({ x: 0, y: 0 });
  const smoothed = useRef({ x: 0, y: 0 });
  const rest = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  const poses = useRef<{ landing: CameraPose; story: CameraPose; tour: CameraTour } | null>(null);
  const live = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30, shiftX: 0, shiftY: 0 }), []);
  const applied = useRef({ fov: -1, shiftX: -1, shiftY: -1, w: 0, h: 0 });

  useEffect(() => {
    let landing = landingPose(size.width, size.height);
    // QA hook: `?cam=x,y,z,tx,ty,tz,fov` pins an arbitrary landing view for inspection.
    const cam = new URLSearchParams(window.location.search).get("cam")?.split(",").map(Number);
    if (cam && cam.length >= 7 && cam.every(Number.isFinite)) {
      landing = { position: [cam[0]!, cam[1]!, cam[2]!], target: [cam[3]!, cam[4]!, cam[5]!], fov: cam[6]!, shiftX: 0, shiftY: 0 };
    }
    const story = storybookPose(size.width, size.height);
    poses.current = { landing, story, tour: new CameraTour(story, landing) };
    rest.position.set(...landing.position);
    rest.target.set(...landing.target);
    applied.current.fov = -1;
  }, [size, rest]);

  useEffect(() => {
    if (!parallax) return;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [parallax]);

  const project = (fov: number, shiftX: number, shiftY: number) => {
    const a = applied.current;
    if (a.fov === fov && a.shiftX === shiftX && a.shiftY === shiftY && a.w === size.width && a.h === size.height) return;
    Object.assign(a, { fov, shiftX, shiftY, w: size.width, h: size.height });
    camera.fov = fov;
    camera.setViewOffset(size.width, size.height, -size.width * shiftX, -size.height * shiftY, size.width, size.height);
    camera.updateProjectionMatrix();
  };

  useFrame((_, dt) => {
    const p = poses.current;
    if (!p) return;

    if (introClock.active) {
      smoothed.current.x = smoothed.current.y = 0;
      if (introClock.t < TOUR_START) {
        camera.position.set(...p.story.position);
        live.target.set(...p.story.target);
        project(p.story.fov, p.story.shiftX, p.story.shiftY);
      } else {
        p.tour.sample(introClock.t, live);
        camera.position.copy(live.position);
        project(live.fov, live.shiftX, live.shiftY);
      }
      camera.lookAt(live.target);
      return;
    }

    project(p.landing.fov, p.landing.shiftX, p.landing.shiftY);
    if (parallax) {
      const k = 1 - Math.exp(-Math.min(dt, 0.1) * 2.2);
      smoothed.current.x += (pointer.current.x - smoothed.current.x) * k;
      smoothed.current.y += (pointer.current.y - smoothed.current.y) * k;
    }
    camera.position.copy(rest.position);
    camera.position.x += smoothed.current.x * OPENING_CAMERA.parallax.x;
    camera.position.y += -smoothed.current.y * OPENING_CAMERA.parallax.y;
    camera.lookAt(rest.target);
  });

  return null;
}
