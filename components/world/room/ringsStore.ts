import { useSyncExternalStore } from "react";
import type { RingsWorld } from "./GiftRings";

/**
 * Hands the gift map's data from the room layout straight to the rings, so a
 * hover or a new memory re-renders only the rings, not the whole 3D world.
 */
type Listener = () => void;
let current: RingsWorld | null = null;
const listeners = new Set<Listener>();

export const ringsStore = {
  set(next: RingsWorld | null) {
    if (next === current) return;
    current = next;
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useRings(): RingsWorld | null {
  return useSyncExternalStore(ringsStore.subscribe, () => current, () => null);
}
