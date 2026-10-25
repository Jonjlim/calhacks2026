"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { isDarkSky, NIGHT, readTimeOfDay, SKIES, type ScenePalette, type TimeOfDay } from "./timeOfDay";

/** Provided inside the R3F Canvas so every scene component reads the same time-of-day palette. */
export const ScenePaletteContext = createContext<ScenePalette>(NIGHT);

export const useScenePalette = () => useContext(ScenePaletteContext);

// ---------------------------------------------------------------------------
// Time-of-day store: shared by the header toggle (DOM) and the 3D canvas, so
// neither needs props threaded through the landing page.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "unwrap:sky";
let current: TimeOfDay | null = null;
const listeners = new Set<() => void>();

/** Lets CSS (text wash, loading backdrop, chrome) follow the scene. */
function applyToDocument(time: TimeOfDay) {
  // Page chrome has a light and a dark look; the exact sky is also kept for anything that wants it.
  document.documentElement.dataset.time = isDarkSky(time) ? "night" : "day";
  document.documentElement.dataset.sky = time;
}

function initialTime(): TimeOfDay {
  const fromUrl = readTimeOfDay(window.location.search);
  if (fromUrl) return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (SKIES.some((k) => k.id === stored)) return stored as TimeOfDay;
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

/** Whether the person (or the URL) has chosen a sky, as opposed to the default. */
export function hasChosenSky(): boolean {
  if (readTimeOfDay(window.location.search)) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function setTimeOfDay(time: TimeOfDay, opts: { remember?: boolean } = {}) {
  if (time === getTime()) return;
  current = time;
  applyToDocument(time);
  try {
    if (opts.remember !== false) localStorage.setItem(STORAGE_KEY, time);
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
