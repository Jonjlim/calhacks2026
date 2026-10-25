"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { introClock } from "@/components/intro/introTimeline";
import { span, UNWRAP_TIMES, unwrapClock } from "@/components/unwrap/unwrapTimeline";
import { convergence } from "@/components/convergence/convergenceClock";
import { boomAmount, cameraPush as pushProgress, cameraShake, CONVERGENCE_TIMES, EXIT_TIME, smoother, span as tspan } from "@/lib/convergence/timeline";
import { boomPose, CameraTour, convergencePose, giftClosePose, TOUR_START } from "./cameraPath";
import { giftTag } from "./giftTag/giftTagStore";
import { type CameraPose, landingPose, OPENING_CAMERA, storybookPose } from "./sceneConfig";
import { lobbyPose, topPose } from "./unwrap/invitationLayout";
import { roomStage } from "@/components/room/roomStage";
import { doorPose, gardenPose, mapPose, towerPose } from "./room/stageLayout";
import { mapView } from "./room/mapView";

/** The same view, pulled back along its line of sight. */
function pullBack(pose: CameraPose, k: number): CameraPose {
  const [px, py, pz] = pose.position;
  const [tx, ty, tz] = pose.target;
  return { ...pose, position: [tx + (px - tx) * k, ty + (py - ty) * k, tz + (pz - tz) * k] };
}

/**
 * The only camera controller. During the intro it follows the shared intro
 * clock (storybook framing → authored approach → close on the present). On the
 * title screen it then holds that close-up perfectly still while the "Begin"
 * tag is in play. Elsewhere (classic landing, rooms) it holds the responsive
 * landing composition with a small, damped pointer parallax; the view offset
 * shifts the projection centre right so the island sits beside the editorial
 * column without changing the perspective.
 */
export function WorldCamera({ parallax, roomActive = false, reducedMotion = false }: { parallax: boolean; roomActive?: boolean; reducedMotion?: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const pointer = useRef({ x: 0, y: 0 });
  const smoothed = useRef({ x: 0, y: 0 });
  const rest = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  const poses = useRef<{ landing: CameraPose; close: CameraPose; story: CameraPose; tour: CameraTour; lobby: CameraPose; top: CameraPose } | null>(null);
  const live = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30, shiftX: 0, shiftY: 0 }), []);
  const applied = useRef({ fov: -1, shiftX: -1, shiftY: -1, w: 0, h: 0 });
  const tmpPos = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    let landing = landingPose(size.width, size.height);
    // QA hook: `?cam=x,y,z,tx,ty,tz,fov` pins an arbitrary landing view for inspection.
    const cam = new URLSearchParams(window.location.search).get("cam")?.split(",").map(Number);
    if (cam && cam.length >= 7 && cam.every(Number.isFinite)) {
      landing = { position: [cam[0]!, cam[1]!, cam[2]!], target: [cam[3]!, cam[4]!, cam[5]!], fov: cam[6]!, shiftX: 0, shiftY: 0 };
    }
    const story = storybookPose(size.width, size.height);
    const close = giftClosePose(size.width, size.height);
    poses.current = { landing, close, story, tour: new CameraTour(story, close), lobby: lobbyPose(size.width, size.height), top: topPose(size.width, size.height) };
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

  const applyPose = (a: CameraPose, b: CameraPose, k: number) => {
    live.position.set(...a.position).lerp(tmpPos.set(...b.position), k);
    live.target.set(...a.target).lerp(tmpPos.set(...b.target), k);
    project(THREE.MathUtils.lerp(a.fov, b.fov, k), THREE.MathUtils.lerp(a.shiftX, b.shiftX, k), THREE.MathUtils.lerp(a.shiftY, b.shiftY, k));
    camera.position.copy(live.position);
    camera.lookAt(live.target);
  };

  useEffect(() => {
    // QA hook (dev only): inspect the live camera from the browser console.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __camera?: THREE.PerspectiveCamera }).__camera = camera;
  }, [camera]);

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

    // The title screen rests on the close-up; everywhere else rests on the landing view.
    const home = giftTag.enabled ? p.close : p.landing;

    // Chapter 2: while the Begin tag flies to the right, glide back from the
    // close-up to the lobby framing (the present in the left part of the
    // screen); once the tree has grown, rise to look down into the box, where
    // the canopy becomes the QR code.
    if (unwrapClock.active) {
      smoothed.current.x = smoothed.current.y = 0;
      const t = unwrapClock.t;
      const still = unwrapClock.staticPreview;
      const up = still ? 1 : span(t, UNWRAP_TIMES.topView[0], UNWRAP_TIMES.topView[1]);
      if (up > 0) applyPose(p.lobby, p.top, up);
      else applyPose(home, p.lobby, span(t, UNWRAP_TIMES.reframe[0], UNWRAP_TIMES.reframe[1]));
      return;
    }

    // Gift rooms: the stage clock owns the camera (doorway glide, tower, garden).
    if (roomActive && (roomStage.shown || roomStage.target)) {
      smoothed.current.x = smoothed.current.y = 0;
      const w = size.width;
      const shown = roomStage.shown;
      const view = mapView.step(dt, reducedMotion);
      const poseOf = (stage: typeof shown): CameraPose => {
        if (stage !== "map") return stage === "tower" ? towerPose(w) : stage === "garden" ? gardenPose(w) : p.landing;
        // The map can be dragged and zoomed: slide both ends of the view, and pull the camera along its line of sight.
        const base = pullBack(mapPose(w, size.height), view.zoom);
        const [px, py, pz] = base.position;
        const [tx, ty, tz] = base.target;
        return { ...base, position: [px + view.x, py, pz + view.z], target: [tx + view.x, ty, tz + view.z] };
      };
      const scenePose = poseOf(shown);
      if (convergence.active) {
        // The Great Gift Convergence owns the camera: it starts exactly where the map was, glides in to the present, and glides back when the reveal is closed.
        const end = convergencePose(w, size.height);
        const began = convergence.startPose;
        if (!began) {
          convergence.startPose = {
            position: camera.position.toArray() as [number, number, number],
            target: live.target.toArray() as [number, number, number],
            fov: camera.fov,
            shiftX: applied.current.shiftX < 0 ? scenePose.shiftX : applied.current.shiftX,
            shiftY: applied.current.shiftY < 0 ? scenePose.shiftY : applied.current.shiftY,
          };
        }
        if (convergence.instant && !convergence.leaving) applyPose(end, end, 1);
        else if (convergence.leaving) applyPose(end, scenePose, smoother(tspan(convergence.exit, 0, EXIT_TIME)));
        else {
          const t = convergence.t;
          const boom = boomAmount(t);
          if (t < CONVERGENCE_TIMES.boom[0]) applyPose(convergence.startPose ?? scenePose, end, pushProgress(t));
          else applyPose(end, boomPose(w, size.height), boom);
          // The charge and the explosion shake the whole screen.
          if (!convergence.instant && !reducedMotion && !convergence.leaving) {
            const sh = cameraShake(t);
            camera.translateX(sh.x);
            camera.translateY(sh.y);
            camera.rotateZ(sh.roll);
          }
        }
        return;
      }
      if (roomStage.glide && !reducedMotion) {
        // Garden ↔ map: one continuous pull-back (or push-in) in the same sky.
        const k = roomStage.glideProgress;
        applyPose(poseOf(roomStage.from), scenePose, k * k * k * (k * (k * 6 - 15) + 10));
      } else if (!shown && roomStage.target === "tower" && roomStage.transitioning && !reducedMotion) {
        // Outside, gliding up to the tower door before the fade.
        const k = roomStage.approachProgress;
        applyPose(p.landing, doorPose(), k * k * (3 - 2 * k));
      } else if (shown && roomStage.transitioning && roomStage.target === shown && !reducedMotion) {
        // Just arrived: settle in from a little further back as the fade lifts.
        const k = 1 - roomStage.fade;
        applyPose(pullBack(scenePose, 1.18), scenePose, k * k * (3 - 2 * k));
      } else {
        applyPose(scenePose, scenePose, 1);
      }
      return;
    }

    if (giftTag.enabled) {
      // Title screen: locked on the close-up. No parallax, no drift.
      smoothed.current.x = smoothed.current.y = 0;
      applyPose(p.close, p.close, 1);
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
