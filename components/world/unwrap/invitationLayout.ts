import * as THREE from "three";
import { platformTop } from "../props/Stonework";
import { isWideLayout, WORLD_SHARE } from "@/components/unwrap/parchmentLayout";
import { type CameraPose, GIFT_SPOT } from "../sceneConfig";

/**
 * Gift box in the gift's local frame (see HeroGiftBox), and the gift's own
 * scale. The present is a base with a slightly wider lid of `lidHeight`.
 */
export const GIFT_BOX = { width: 1.7, height: 1.45, lidHeight: 0.3, lidOverhang: 1.035, scale: 1.22, rotationY: -0.38 } as const;

/** Top of the open base, in the gift's local frame. */
export const BASE_TOP = GIFT_BOX.height - GIFT_BOX.lidHeight;

/** Wall thickness of the hollow box (and lid) that open out; also the floor's thickness. */
export const BOX_SHELL = 0.035;

/** The satin ribbon: band width / thickness and how far each band stands off the box (inner, outer). */
export const RIBBON = { width: 0.3, thickness: 0.03, insetX: 0.022, insetZ: 0.022 + 0.03 + 0.004 } as const;


/** The tree's canopy top above the pedestal (world units), for framing the front view. */
const TREE_TOP = 4.0;

/**
 * The QR code the canopy becomes: a square grid of blocks on the floor of
 * the unfolded box, seen from above. Edge length in world units, sized to sit
 * just inside the box's top; the grid adds a light quiet zone round the code.
 */
export const QR_SIZE = 2.0;
/** Light modules of quiet zone on each side of the code. */
export const QR_QUIET = 4;

/** Centre of the code: the floor of the unfolded box, at rest on the pedestal. */
export function qrCentre(): THREE.Vector3 {
  return new THREE.Vector3(GIFT_SPOT.x, platformTop() + BOX_SHELL * GIFT_BOX.scale, GIFT_SPOT.z);
}

/**
 * Near top-down view of the finished code, centred in the world's share of
 * the screen (beside the parchment) and big enough to scan from a phone.
 * Nearly straight down (a slight lean keeps the look-at stable), turned with
 * the box so the code reads square.
 */
export function topPose(width: number, height: number): CameraPose {
  const aspect = width / Math.max(1, height);
  const wide = isWideLayout(width, height);
  const fov = 34;
  const visH = 2 * Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const share = wide ? WORLD_SHARE : 1;
  const dist = Math.max(QR_SIZE / (0.5 * visH), QR_SIZE / (0.75 * visH * aspect * share));
  const centre = qrCentre();
  const lean = new THREE.Vector3(0, dist * Math.cos(0.05), dist * Math.sin(0.05)).applyAxisAngle(new THREE.Vector3(0, 1, 0), GIFT_BOX.rotationY);
  const v = (p: THREE.Vector3) => p.toArray() as [number, number, number];
  return { position: v(centre.clone().add(lean)), target: v(centre), fov, shiftX: wide ? -(1 - share) / 2 : 0, shiftY: wide ? 0 : -0.17 };
}

/** World centre of the gift on its pedestal. */
export function giftBase(): THREE.Vector3 {
  return new THREE.Vector3(GIFT_SPOT.x, platformTop(), GIFT_SPOT.z);
}

/**
 * The lobby framing: the open present, its tree and the plaque centred in
 * the left part of the screen (the parchment takes the rest), seen from the
 * same side as the opening close-up so the move between them is a gentle
 * pull-back. The view offset moves the projection centre without changing
 * perspective, so raycasting and the QR's projected square stay exact.
 */
export function lobbyPose(width: number, height: number): CameraPose {
  const aspect = width / Math.max(1, height);
  const wide = isWideLayout(width, height);
  const base = giftBase();
  const fov = 34;
  const visH = 2 * Math.tan(THREE.MathUtils.degToRad(fov / 2));
  // Everything from the pedestal's foot to the canopy top, with a little air.
  const extent = TREE_TOP + 0.7;
  const target = base.clone().setY(base.y + TREE_TOP / 2 - 0.15);
  // Fit the height, and the ~4.4-unit-wide scene into the world's share of the width.
  const share = wide ? WORLD_SHARE : 1;
  const dist = Math.max(extent / (0.9 * visH), 4.6 / (0.92 * visH * aspect * share));
  const dir = new THREE.Vector3(2.2, 0.75, 6.2).normalize();
  const position = target.clone().addScaledVector(dir, dist);
  const v = (p: THREE.Vector3) => p.toArray() as [number, number, number];
  return { position: v(position), target: v(target), fov, shiftX: wide ? -(1 - share) / 2 : 0, shiftY: wide ? 0 : -0.2 };
}
