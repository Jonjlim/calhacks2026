"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type * as THREE from "three";
import { introClock, SNAPSHOT_AT } from "@/components/intro/introTimeline";
import { extractSketch } from "./sketchExtract";

/**
 * Lives inside the Canvas and does the intro's WebGL-side work:
 *  - while the closed book rests on the desk (loading), traces the scene
 *    from the storybook camera into pencil strokes;
 *  - just before the watercolour begins, captures the live frame that the
 *    paint reveals, so the painting and the 3D world are the same image.
 * The camera itself is positioned by WorldCamera from the same clock.
 */
export function IntroBridge() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const settle = useRef(0);
  const traced = useRef({ w: 0, h: 0 });

  // A resize mid-intro invalidates both tracing and snapshot: land cleanly instead.
  useEffect(() => {
    const t = traced.current;
    if (t.w && (t.w !== size.width || t.h !== size.height)) {
      introClock.invalidateSketch();
      if (introClock.active && introClock.phase !== "loading") introClock.finish();
    }
  }, [size]);

  useFrame(() => {
    if (!introClock.active) return;
    if (introClock.phase === "loading" && introClock.gates.world && !introClock.gates.sketch) {
      // Let the storybook camera and freshly mounted meshes settle for a few frames.
      if (++settle.current < 4) return;
      try {
        introClock.sketch = extractSketch(gl, scene, camera, size.width, size.height);
        traced.current = { w: size.width, h: size.height };
      } catch (err) {
        console.warn("Storybook sketch tracing failed; skipping intro.", err);
        introClock.finish();
        return;
      }
      introClock.gates.sketch = true;
      settle.current = 0;
      return;
    }
    if (!introClock.gates.snapshot && introClock.t >= SNAPSHOT_AT) {
      try {
        // Render now and copy before the browser clears the drawing buffer.
        gl.render(scene, camera);
        const src = gl.domElement;
        const shot = document.createElement("canvas");
        shot.width = src.width;
        shot.height = src.height;
        shot.getContext("2d")?.drawImage(src, 0, 0);
        introClock.snapshot = shot;
      } catch (err) {
        console.warn("Storybook snapshot failed; the watercolour will fade straight to the world.", err);
      }
      introClock.gates.snapshot = true;
    }
  });

  return null;
}
