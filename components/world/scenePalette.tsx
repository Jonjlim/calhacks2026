"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { NIGHT, readTimeOfDay, type ScenePalette, type TimeOfDay } from "./timeOfDay";

/** Provided inside the R3F Canvas so every scene component reads the same time-of-day palette. */
export const ScenePaletteContext = createContext<ScenePalette>(NIGHT);

export const useScenePalette = () => useContext(ScenePaletteContext);

// ---------------------------------------------------------------------------
// Time-of-day store: shared by the header toggle (DOM) and the 3D canvas, so
// neither needs props threaded through the landing page.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "unwrap:time";
let current: TimeOfDay | null = null;
const listeners = new Set<() => void>();

/** Lets CSS (text wash, loading backdrop, chrome) follow the scene. */
function applyToDocument(time: TimeOfDay) {
  document.documentElement.dataset.time = time;
}

function initialTime(): TimeOfDay {
  const fromUrl = readTimeOfDay(window.location.search);
  if (fromUrl) return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "day" || stored === "night") return stored;
  } catch {
    // Storage can be blocked; fall back to the default.
  }
  return "night";
}

function getTime(): TimeOfDay {
  if (current === null) {
    current = initialTime();
    applyToDocument(current);
  }
  return current;
}

export function setTimeOfDay(time: TimeOfDay) {
  if (time === getTime()) return;
  current = time;
  applyToDocument(time);
  try {
    localStorage.setItem(STORAGE_KEY, time);
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useTimeOfDay(): TimeOfDay {
  return useSyncExternalStore(subscribe, getTime, () => "night");
}
