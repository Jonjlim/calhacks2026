/** Remove emoji sequences without treating ordinary digits, # or * as emoji. */
export function withoutEmoji(text: string): string {
  return text
    .replace(/[#*0-9]\uFE0F?\u20E3/gu, "")
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200D\uFE0E\uFE0F\u{E0020}-\u{E007F}]/gu, "")
    .trim();
}
