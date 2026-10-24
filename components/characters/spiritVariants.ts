/**
 * The five selectable storybook spirits. Shared body; variants differ only in
 * colour, headwear and accessory. The future avatar selector and recipient
 * throne should read from this list rather than redefining looks.
 */
export type SpiritVariant = "explorer" | "dreamer" | "kind" | "calm" | "curious";

export interface SpiritLook {
  label: string;
  personality: string;
  cloak: string;
  cloakShade: string;
  accent: string;
  headwear: "hood" | "wizard-hat";
  accessory: "scarf" | "star" | "flower" | "leaf" | "goggles";
  /** Resting eyelid openness; Dreamer is a little sleepy. */
  eyeOpen: number;
}

export const SPIRIT_LOOKS: Record<SpiritVariant, SpiritLook> = {
  explorer: { label: "Explorer", personality: "Curious and cheerful", cloak: "#c8604a", cloakShade: "#9e4536", accent: "#e8b25c", headwear: "hood", accessory: "scarf", eyeOpen: 1 },
  dreamer: { label: "Dreamer", personality: "Sleepy, imaginative, gentle", cloak: "#7e88cf", cloakShade: "#5e67a8", accent: "#f2d27a", headwear: "wizard-hat", accessory: "star", eyeOpen: 0.55 },
  kind: { label: "Kind", personality: "Sweet and friendly", cloak: "#e2a4b0", cloakShade: "#c07e8d", accent: "#fff4f0", headwear: "hood", accessory: "flower", eyeOpen: 1 },
  calm: { label: "Calm", personality: "Peaceful, thoughtful", cloak: "#9ab68a", cloakShade: "#73905f", accent: "#6f9a4a", headwear: "hood", accessory: "leaf", eyeOpen: 0.8 },
  curious: { label: "Curious", personality: "Playful and adventurous", cloak: "#e3b24f", cloakShade: "#b98933", accent: "#9cd2e6", headwear: "hood", accessory: "goggles", eyeOpen: 1 },
};
