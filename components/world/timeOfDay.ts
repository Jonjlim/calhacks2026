import * as THREE from "three";

/**
 * Time of day for the opening world. Night is the default; the header toggle
 * (or `?time=day|night`) switches it, and the choice is remembered.
 * Every colour that changes between the two lives here so sky, fog, light and
 * clouds can never disagree.
 */
export type TimeOfDay = "day" | "night" | "sunrise" | "sunset" | "bluehour";

/** The skies a person can pick, in the order the sky control cycles through them. */
export const SKIES: { id: TimeOfDay; label: string }[] = [
  { id: "sunrise", label: "Rose-gold sunrise" },
  { id: "sunset", label: "Lavender sunset" },
  { id: "bluehour", label: "Enchanted blue hour" },
  { id: "day", label: "Day" },
  { id: "night", label: "Night" },
];

/** Whether a sky is a dark one, for the page chrome that has only a light and a dark look. */
export const isDarkSky = (time: TimeOfDay) => time === "night" || time === "bluehour";

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

/**
 * Rose-gold sunrise: the welcoming default for exploring. Peach horizon, blush
 * cloud highlights, pale lavender shadows, soft golden key light with a warm
 * rim on the islands.
 */
export const SUNRISE: ScenePalette = {
  ...DAY,
  time: "sunrise",
  clearColor: "#f2d9cf",
  fog: { color: "#f3dccf", near: 30, far: 180 },
  sky: { zenith: "#8fb0e2", mid: "#f2d2cc", horizon: "#ffe0b4", below: "#e8c2c0", glow: "#ffca94", glowStrength: 1.3, orbDirection: new THREE.Vector3(0.38, 0.14, -0.91).normalize(), disc: 0, stars: 0 },
  light: { hemiSky: "#ffe3d2", hemiGround: "#b9a0c0", hemiIntensity: 0.92, key: "#ffcc92", keyIntensity: 3.1, bounce: "#f6c4b4", bounceIntensity: 1.0, rim: "#ffbfcb", rimIntensity: 0.7 },
  cloudTint: "#fff0e6",
  deckTint: "#f8e6e0",
  distant: { mountainTint: "#ecd0d6", hazeTint: "#f4dcd4", hazeOpacity: 1 },
};

/** Lavender sunset: for gift discovery. Dusty violet shadows, coral highlights, amber sun, deeper cloud valleys. */
export const SUNSET: ScenePalette = {
  ...DAY,
  time: "sunset",
  clearColor: "#b690b8",
  fog: { color: "#b78cbb", near: 28, far: 170 },
  sky: { zenith: "#5d4f9c", mid: "#b27fb8", horizon: "#ffb18a", below: "#8b6aa8", glow: "#ff9a6b", glowStrength: 1.45, orbDirection: new THREE.Vector3(0.52, 0.1, -0.85).normalize(), disc: 0, stars: 0 },
  light: { hemiSky: "#cdaaea", hemiGround: "#6c4e8e", hemiIntensity: 0.86, key: "#ffad77", keyIntensity: 3.3, bounce: "#c47aa8", bounceIntensity: 0.85, rim: "#ff9cb2", rimIntensity: 0.85 },
  cloudTint: "#f3c6d8",
  deckTint: "#b898c9",
  distant: { mountainTint: "#9d7ab6", hazeTint: "#c9a1c9", hazeOpacity: 0.95 },
};

/** Enchanted blue hour: special reveals. Periwinkle and indigo, a soft pink horizon, warm lantern light, a few stars. */
export const BLUEHOUR: ScenePalette = {
  ...NIGHT,
  time: "bluehour",
  clearColor: "#4c5aa0",
  fog: { color: "#5964ac", near: 30, far: 175 },
  sky: { zenith: "#2b3a8d", mid: "#5b6cc1", horizon: "#f2a9ba", below: "#3b4a90", glow: "#ffbacb", glowStrength: 0.95, orbDirection: new THREE.Vector3(0.4, 0.1, -0.91).normalize(), disc: 0, stars: 0.35 },
  light: { hemiSky: "#90a2e8", hemiGround: "#3b3571", hemiIntensity: 0.95, key: "#ffcaa2", keyIntensity: 1.9, bounce: "#6b65b2", bounceIntensity: 0.6, rim: "#b9c5ff", rimIntensity: 0.85 },
  cloudTint: "#aab4e8",
  deckTint: "#7581c5",
  distant: { mountainTint: "#8189c9", hazeTint: "#6b75b9", hazeOpacity: 0.8 },
};

/** `?time=day` / `?time=night` in the URL, or null when the URL does not say. */
export function readTimeOfDay(search: string): TimeOfDay | null {
  const value = new URLSearchParams(search).get("time");
  return SKIES.some((k) => k.id === value) ? (value as TimeOfDay) : null;
}

export const paletteFor = (time: TimeOfDay): ScenePalette => ({ day: DAY, night: NIGHT, sunrise: SUNRISE, sunset: SUNSET, bluehour: BLUEHOUR })[time];
