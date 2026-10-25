/** Sample messages for demos on machines without Full Disk Access. */
import { sampleChat } from "../../lib/agentCollaborators/fixture.ts";
import type { LocalMessage } from "./types.ts";

export function fixtureMessages(now: number = Date.now()): LocalMessage[] {
  return sampleChat(now).map((m, i) => ({ id: i + 1, text: m.text, fromMe: m.fromMe, sentAt: m.sentAt, chatId: (i % 3) + 1 }));
}
