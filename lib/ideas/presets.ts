/**
 * Picture options for the memory game. Presets are instant and work with no
 * model configured; the agents replace them with options built from the room's
 * own clues and the friend's last pick. Pure data, shared by Convex and the UI.
 */
import type { ClueKind } from "../contracts";

export interface Idea {
  /** Short card label, shown under the picture. */
  label: string;
  /** One emoji, drawn large as the card's picture. */
  emoji: string;
  /** The memory saved when this card is picked; a full, room-readable sentence. */
  clue: string;
}

export const IDEA_KINDS: ClueKind[] = ["interest", "uncertain", "explicit_wish", "ownership", "exclusion"];

const PRESETS: Record<ClueKind, (name: string) => Idea[]> = {
  interest: (n) => [
    { label: "Hiking", emoji: "🥾", clue: `${n} loves hiking.` },
    { label: "Cooking", emoji: "🍝", clue: `${n} loves cooking.` },
    { label: "Reading", emoji: "📚", clue: `${n} loves reading.` },
    { label: "Music", emoji: "🎧", clue: `${n} loves music.` },
    { label: "Making things", emoji: "🧶", clue: `${n} loves making things by hand.` },
    { label: "Coffee", emoji: "☕", clue: `${n} loves good coffee.` },
  ],
  uncertain: (n) => [
    { label: "A trip together", emoji: "🧳", clue: `A trip we took with ${n} still comes up.` },
    { label: "A snow day", emoji: "❄️", clue: `${n} lit up on a snow day.` },
    { label: "A concert", emoji: "🎤", clue: `${n} had the best time at a concert.` },
    { label: "Late-night talks", emoji: "🌙", clue: `${n} loves long late-night talks.` },
    { label: "A beach day", emoji: "🏖️", clue: `${n} was happiest on a beach day.` },
    { label: "Game night", emoji: "🎲", clue: `${n} comes alive at game night.` },
  ],
  explicit_wish: (n) => [
    { label: "Try a class", emoji: "🎨", clue: `${n} has said they'd love to take a class.` },
    { label: "Travel somewhere", emoji: "✈️", clue: `${n} keeps talking about a trip they want to take.` },
    { label: "Learn an instrument", emoji: "🎸", clue: `${n} wants to learn an instrument.` },
    { label: "A cosy upgrade", emoji: "🛋️", clue: `${n} has wished for something cosy for home.` },
    { label: "A new hobby", emoji: "🪴", clue: `${n} wants to start a new hobby.` },
    { label: "Better gear", emoji: "🎒", clue: `${n} has wished for better gear for what they love.` },
  ],
  ownership: (n) => [
    { label: "A starter kit", emoji: "🧰", clue: `${n} already owns a starter kit.` },
    { label: "Lots of mugs", emoji: "☕", clue: `${n} already has plenty of mugs.` },
    { label: "Candles", emoji: "🕯️", clue: `${n} already has lots of candles.` },
    { label: "Headphones", emoji: "🎧", clue: `${n} already has good headphones.` },
    { label: "Books", emoji: "📚", clue: `${n} already has a big book collection.` },
    { label: "Plants", emoji: "🪴", clue: `${n} already has a lot of plants.` },
  ],
  exclusion: (n) => [
    { label: "Candles", emoji: "🕯️", clue: `Avoid candles for ${n}.` },
    { label: "Clutter", emoji: "📦", clue: `${n} doesn't want more clutter.` },
    { label: "Strong scents", emoji: "🌸", clue: `Avoid strong scents for ${n}.` },
    { label: "Clothing sizes", emoji: "👕", clue: `Avoid clothing; sizes are tricky for ${n}.` },
    { label: "Sweets", emoji: "🍫", clue: `Avoid sweets for ${n}.` },
    { label: "Alcohol", emoji: "🍷", clue: `Avoid alcohol for ${n}.` },
  ],
  timing: (n) => [
    { label: "Needs it soon", emoji: "⏰", clue: `The gift for ${n} needs to arrive soon.` },
    { label: "No rush", emoji: "🗓️", clue: `There's no rush on the gift for ${n}.` },
  ],
};

export function presetIdeas(kind: ClueKind, recipientName: string): Idea[] {
  return PRESETS[kind](recipientName.trim() || "They");
}
