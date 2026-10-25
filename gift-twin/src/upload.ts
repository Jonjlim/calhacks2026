/**
 * Prepares the one-time upload: only messages the recipient sent, never
 * other people's, with no handles, chat ids, or attachments.
 */
import { splitIntoUploadBatches, TWIN_LIMITS, type VaultMessage } from "../../lib/agentCollaborators/contracts.ts";
import type { LocalMessage } from "./types.ts";

export function toVaultMessages(messages: LocalMessage[]): VaultMessage[] {
  const out: VaultMessage[] = [];
  for (const message of messages) {
    if (!message.fromMe) continue;
    const text = message.text.trim().slice(0, TWIN_LIMITS.messageMaxChars);
    if (text) out.push({ text, sentAt: message.sentAt });
  }
  return out;
}

export interface UploadPlan {
  messages: VaultMessage[];
  batches: VaultMessage[][];
  chars: number;
}

export function planUpload(messages: LocalMessage[]): UploadPlan {
  const vault = toVaultMessages(messages);
  return { messages: vault, batches: splitIntoUploadBatches(vault), chars: vault.reduce((sum, m) => sum + m.text.length, 0) };
}
