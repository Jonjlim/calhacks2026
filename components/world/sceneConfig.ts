/**
 * Fixed opening composition. The storybook sketch and watercolour are traced
 * from a frame rendered through `storybookPose`, and the landing view is
 * `landingPose`; treat both as part of the visual contract and change them
 * deliberately.
 */
export const OPENING_CAMERA = {
  fov: 30,
  position: [5.0, 6.6, 26.9] as const,
  target: [0.9, -0.9, -0.6] as const,
  /** Fraction of the viewport width the island centre is pushed right, leaving room for the editorial column. */
  frameShift: 0.25,
  /** Fraction of the viewport height the horizon is pushed down, opening up the sky. */
  skyShift: 0.08,
  /** Pointer parallax range in world units. */
  parallax: { x: 1.1, y: 0.55 },
};

/** Gift platform centre on the island (x, z). */
export const GIFT_SPOT = { x: 0.4, z: -0.6 } as const;

export type WorldQuality = "high" | "low";

export interface WorldSettings {
  reducedMotion: boolean;
  soundEnabled: boolean;
  quality: WorldQuality;
}

export type Vec3 = readonly [number, number, number];

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
  /** Projection-centre shift as a fraction of viewport width / height (see setViewOffset). */
  shiftX: number;
  shiftY: number;
}

function pullBack(position: Vec3, target: Vec3, k: number): Vec3 {
  return [target[0] + (position[0] - target[0]) * k, target[1] + (position[1] - target[1]) * k, target[2] + (position[2] - target[2]) * k];
}

/**
 * Responsive landing composition. Desktop keeps the island large on the right
 * beside the editorial column; narrow screens centre the island low and step
 * back so the gift stays readable beneath the headline.
 */
export function landingPose(width: number, height: number): CameraPose {
  const aspect = width / Math.max(1, height);
  const { position, target, fov, frameShift, skyShift } = OPENING_CAMERA;
  if (aspect < 0.8) {
    // Phone portrait: island centred under the copy.
    return { position: pullBack(position, target, 1.95), target, fov: 34, shiftX: 0, shiftY: 0.24 };
  }
  if (aspect < 1.25) {
    // Tablet / square: modest shift, a little further back.
    return { position: pullBack(position, target, 1.4), target, fov, shiftX: 0.12, shiftY: 0.16 };
  }
  // Widescreen windows have spare width, so the island can sit further right;
  // narrower desktop windows step back slightly so the rim never clips.
  const pull = Math.max(1, 1.6 / aspect);
  const shift = frameShift + Math.min(0.03, Math.max(0, (aspect - 1.6) * 0.15));
  return { position: pullBack(position, target, pull), target, fov, shiftX: shift, shiftY: skyShift };
}

/**
 * The centred "illustration" framing the storybook page is traced from. The
 * whole island sits in the middle of the page with nothing reserved for UI.
 */
export function storybookPose(width: number, height: number): CameraPose {
  const aspect = width / Math.max(1, height);
  const position: Vec3 = [4.6, 6.6, 27.5];
  const target: Vec3 = [0.6, -0.6, -0.6];
  const pull = Math.max(1, 1.5 / aspect);
  return { position: pullBack(position, target, pull), target, fov: 31, shiftX: 0, shiftY: 0.04 };
}
