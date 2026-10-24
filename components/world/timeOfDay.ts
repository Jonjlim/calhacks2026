import * as THREE from "three";

/**
 * Time of day for the opening world. Night is the default; the header toggle
 * (or `?time=day|night`) switches it, and the choice is remembered.
 * Every colour that changes between the two lives here so sky, fog, light and
 * clouds can never disagree.
 */
export type TimeOfDay = "day" | "night";

export interface ScenePalette {
  time: TimeOfDay;
  clearColor: string;
  fog: { color: string; near: number; far: number };
  sky: {
    zenith: string;
    mid: string;
    horizon: string;
    below: string;
    /** Glow colour around the sun / moon. */
    glow: string;
    glowStrength: number;
    /** Direction of the visible sun / moon disc. */
    orbDirection: THREE.Vector3;
    /** 0 = no disc (day: the sun stays off-frame), 1 = crisp moon. */
    disc: number;
    stars: number;
  };
  light: {
    hemiSky: string;
    hemiGround: string;
    hemiIntensity: number;
    key: string;
    keyIntensity: number;
    bounce: string;
    bounceIntensity: number;
    rim: string;
    rimIntensity: number;
  };
  /** Multiplies cloud sprites / the cloud deck (moonlit clouds are blue-grey, not white). */
  cloudTint: string;
  deckTint: string;
  /** The far mountain ranges and the mist veils between them (both ignore fog, so they need their own night grade). */
  distant: { mountainTint: string; hazeTint: string | null; hazeOpacity: number };
}

export const DAY: ScenePalette = {
  time: "day",
  clearColor: "#cfe0f0",
  fog: { color: "#d9e4ef", near: 34, far: 190 },
  sky: {
    zenith: "#3f85d3",
    mid: "#a3cdef",
    horizon: "#f3f1f2",
    below: "#a6bce6",
    glow: "#ffe3b0",
    glowStrength: 1,
    orbDirection: new THREE.Vector3(0.55, 0.42, -0.72).normalize(),
    disc: 0,
    stars: 0,
  },
  light: {
    hemiSky: "#d4e3ff",
    hemiGround: "#9d8cc0",
    hemiIntensity: 0.95,
    key: "#ffe1ad",
    keyIntensity: 3.0,
    bounce: "#f6d8c4",
    bounceIntensity: 0.9,
    rim: "#c7d2ff",
    rimIntensity: 0.55,
  },
  cloudTint: "#ffffff",
  deckTint: "#f4f1f6",
  distant: { mountainTint: "#ffffff", hazeTint: null, hazeOpacity: 1 },
};

export const NIGHT: ScenePalette = {
  time: "night",
  clearColor: "#141a38",
  fog: { color: "#262e5a", near: 30, far: 175 },
  sky: {
    zenith: "#0c1233",
    mid: "#1f2a5c",
    horizon: "#57578f",
    below: "#1d2347",
    glow: "#c9d6ff",
    glowStrength: 0.75,
    // High on the right, above the castle, clear of the headline.
    orbDirection: new THREE.Vector3(0.36, 0.2, -0.91).normalize(),
    disc: 1,
    stars: 1,
  },
  light: {
    hemiSky: "#7a88c8",
    hemiGround: "#2c2648",
    hemiIntensity: 1.05,
    key: "#bccbff",
    keyIntensity: 1.7,
    bounce: "#4d5596",
    bounceIntensity: 0.4,
    rim: "#a8b8ff",
    rimIntensity: 0.8,
  },
  cloudTint: "#7c87bd",
  deckTint: "#4e5789",
  distant: { mountainTint: "#646ca4", hazeTint: "#3f4880", hazeOpacity: 0.7 },
};

/** `?time=day` / `?time=night` in the URL, or null when the URL does not say. */
export function readTimeOfDay(search: string): TimeOfDay | null {
  const value = new URLSearchParams(search).get("time");
  return value === "day" || value === "night" ? value : null;
}

export const paletteFor = (time: TimeOfDay): ScenePalette => (time === "day" ? DAY : NIGHT);
