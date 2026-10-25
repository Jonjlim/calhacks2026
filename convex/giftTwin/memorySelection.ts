import type { VaultMessage } from "../../lib/agentCollaborators/contracts";

export const MEMORY_INDEX_LIMIT = 256;
const PREFERENCE = /\b(?:want|wish|love|like|hate|dislike|avoid|own|bought|need|favorite|favourite|prefer|enjoy|learn|learning|playing|practicing|training|hobby|collect|obsessed|into|can't stand|already have)\b/i;

/** Keep old preferences as well as recent ones; never index a whole large vault. */
export function selectMemoryMessages(messages: VaultMessage[], limit = MEMORY_INDEX_LIMIT): VaultMessage[] {
  if (messages.length <= limit) return messages;
  const seen = new Set<string>();
  const salient: VaultMessage[] = [];
  const other: VaultMessage[] = [];
  for (const message of messages) {
    const key = message.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    (PREFERENCE.test(message.text) ? salient : other).push(message);
  }
  const sample = (items: VaultMessage[], count: number) => {
    if (count <= 0) return [];
    if (items.length <= count) return items;
    const recentCount = Math.ceil(count / 2);
    const older = items.slice(0, -recentCount);
    const historicCount = count - recentCount;
    return [...Array.from({ length: historicCount }, (_, i) => older[Math.floor(i * older.length / historicCount)]!), ...items.slice(-recentCount)];
  };
  const selected = sample(salient, limit);
  return [...selected, ...sample(other, limit - selected.length)].sort((a, b) => a.sentAt - b.sentAt);
}
