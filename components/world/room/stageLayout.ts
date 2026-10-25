import * as THREE from "three";
import { platformTop } from "../props/Stonework";
import { type CameraPose, GIFT_SPOT } from "../sceneConfig";
import { groundAt } from "../terrain";

/**
 * Geometry for the room stages. The tower interior is its own small scene,
 * placed well below the island and enclosed by its walls, so the camera can
 * cut between outside and inside at the fade's darkest moment without the two
 * ever overlapping.
 */

/** The island's storybook tower (IslandEnvironment). */
export const TOWER = { x: -3.7, z: -2.7, rotationY: 0.35 } as const;

/** Where the interior scene lives in world space. */
export const INTERIOR_ORIGIN = new THREE.Vector3(0, -80, 0);
export const INTERIOR = { radius: 4.6, height: 4.4, tableRadius: 1.25, tableHeight: 0.52 } as const;

/** The tower's front door, in world space (door sits on the tower's local +z face). */
export function towerDoor(): THREE.Vector3 {
  const s = Math.sin(TOWER.rotationY);
  const c = Math.cos(TOWER.rotationY);
  const x = TOWER.x + 0.05 * c + 0.8 * s;
  const z = TOWER.z - 0.05 * s + 0.8 * c;
  return new THREE.Vector3(x, groundAt(TOWER.x, TOWER.z) + 0.45, z);
}

const outward = () => new THREE.Vector3(Math.sin(TOWER.rotationY), 0, Math.cos(TOWER.rotationY));
const v = (p: THREE.Vector3) => p.toArray() as [number, number, number];

/** Camera close on the doorway, the end of the approach glide. */
export function doorPose(): CameraPose {
  const door = towerDoor();
  const pos = door.clone().addScaledVector(outward(), 2.1).add(new THREE.Vector3(0.25, 0.45, 0));
  return { position: v(pos), target: v(door.clone().add(new THREE.Vector3(0, 0.15, 0))), fov: 34, shiftX: 0, shiftY: 0 };
}

/** Inside: looking across the council's table toward the window. */
export function towerPose(width: number): CameraPose {
  const mobile = width < 768;
  // The near wall is back-face culled, so the camera can sit just beyond it and frame the whole table.
  const target = INTERIOR_ORIGIN.clone().add(new THREE.Vector3(0, 0.75, -0.2));
  // Centred: the stage is full-bleed now, with only small floating controls around the edges.
  const pos = INTERIOR_ORIGIN.clone().add(new THREE.Vector3(0, 3.6, mobile ? 8.4 : 6.6));
  return { position: v(pos), target: v(target), fov: mobile ? 46 : 40, shiftX: 0, shiftY: mobile ? -0.18 : 0.04 };
}

/** Outside again: close on the island's present, where the friends decorate it. */
export function gardenPose(width: number): CameraPose {
  const mobile = width < 768;
  const gift = new THREE.Vector3(GIFT_SPOT.x, platformTop() + 1.0, GIFT_SPOT.z);
  const pos = gift.clone().add(new THREE.Vector3(2.6, 2.3, 6.4));
  return { position: v(pos), target: v(gift.clone().add(new THREE.Vector3(0, -0.1, 0))), fov: mobile ? 46 : 36, shiftX: 0, shiftY: mobile ? -0.12 : 0.02 };
}

/** Where friends gather around the present, and where they step out of the tower. */
export function gardenSpots(count: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    // An arc in front of the present, opening toward the camera.
    const a = Math.PI * 0.15 + (i / Math.max(1, count - 1)) * Math.PI * 0.7;
    const r = 2.45 + (i % 2) * 0.35;
    out.push([GIFT_SPOT.x + Math.cos(a) * r, GIFT_SPOT.z + Math.sin(a) * r * 0.9]);
  }
  return out;
}

/** Height of the ring islands: a little below the present so the main island stays the hero. */
export function ringBase(): number {
  return groundAt(GIFT_SPOT.x, GIFT_SPOT.z) - 1.4;
}

/**
 * The gift map (D19): pulled far back and up from the present so the rings of
 * memories, themes and gifts fit around it, still in the same sky.
 */
export function mapPose(width: number, height: number): CameraPose {
  const aspect = width / Math.max(1, height);
  const center = new THREE.Vector3(GIFT_SPOT.x, ringBase(), GIFT_SPOT.z);
  // Narrower screens step back further so the outer ring still fits side to side.
  const pull = aspect < 0.8 ? 1.9 : aspect < 1.4 ? 1.3 : 1;
  const pos = center.clone().add(new THREE.Vector3(0, 35.5 * pull, 27 * pull));
  const target = center.clone().add(new THREE.Vector3(0, -2, 1));
  return { position: v(pos), target: v(target), fov: aspect < 0.8 ? 52 : 42, shiftX: 0, shiftY: 0 };
}
