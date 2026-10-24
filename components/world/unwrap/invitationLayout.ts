import * as THREE from "three";
import { MOCK_QR_SIZE } from "@/lib/invitation/mockQr";
import { platformTop } from "../props/Stonework";
import { type CameraPose, GIFT_SPOT, landingPose } from "../sceneConfig";

/**
 * Where the present turns into its QR: a square grid of blocks filling the
 * open box to its brim, seen from above. One light module of quiet zone
 * surrounds the code. Sized to sit just inside the box's top face.
 */
export const QR_GRID = {
  modules: MOCK_QR_SIZE,
  /** Grid cells including the quiet-zone border. */
  cells: MOCK_QR_SIZE + 2,
  size: 2.0,
} as const;

/**
 * Gift box in the gift's local frame (see HeroGiftBox), and the gift's own
 * scale. The present is a base with a slightly wider lid of `lidHeight`.
 */
export const GIFT_BOX = { width: 1.7, height: 1.45, lidHeight: 0.3, lidOverhang: 1.035, scale: 1.22, rotationY: -0.38 } as const;

/** Top of the open base, in the gift's local frame: where the tree grows from and the code forms. */
export const BASE_TOP = GIFT_BOX.height - GIFT_BOX.lidHeight;

/** Centre of the code: the open base's top face, at rest on the pedestal. */
export function qrCentre(): THREE.Vector3 {
  return new THREE.Vector3(GIFT_SPOT.x, platformTop() + (GIFT_BOX.height - GIFT_BOX.lidHeight) * GIFT_BOX.scale, GIFT_SPOT.z);
}

export interface InvitationFrame {
  /** Close, front-on view of the present while it unties. */
  close: CameraPose;
  /** Near top-down view of the finished QR. */
  top: CameraPose;
}

/**
 * Camera framing for the sequence. The top view leaves room beside the code
 * (desktop: to the right; narrow screens: below) for the invitation note.
 */
export function invitationFrame(width: number, height: number): InvitationFrame {
  const aspect = width / Math.max(1, height);
  const centre = qrCentre();
  // Frame the box and the tree that grows out of it.
  const giftMid = centre.clone().setY(centre.y + 0.9);
  const landing = landingPose(width, height);
  const dir = new THREE.Vector3(...landing.position).sub(giftMid);
  dir.y *= 0.45;
  dir.normalize();
  const fov = 30;
  const visH = 2 * Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const closeDist = Math.max(5.6 / (0.8 * visH), 3.6 / (0.7 * visH * aspect));
  const closePos = giftMid.clone().addScaledVector(dir, closeDist);

  const wide = aspect >= 1.05;
  // Fit the code to ~56% of the height (or most of a narrow screen's width).
  const fit = wide ? QR_GRID.size / (0.56 * visH) : QR_GRID.size / (0.7 * visH * aspect);
  const dist = Math.max(fit, QR_GRID.size / (0.6 * visH));
  // A few degrees off vertical keeps a little depth in the blocks (and avoids a degenerate look-at).
  // Turned with the box, so its code reads square on screen.
  const lean = new THREE.Vector3(0, dist * Math.cos(0.14), dist * Math.sin(0.14)).applyAxisAngle(new THREE.Vector3(0, 1, 0), GIFT_BOX.rotationY);
  const topPos = centre.clone().add(lean);
  const v = (p: THREE.Vector3) => p.toArray() as [number, number, number];
  return {
    close: { position: v(closePos), target: v(giftMid), fov, shiftX: 0, shiftY: 0 },
    top: { position: v(topPos), target: v(centre), fov, shiftX: wide ? -0.16 : 0, shiftY: wide ? 0 : -0.17 },
  };
}
