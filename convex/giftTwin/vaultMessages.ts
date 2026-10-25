import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { VaultMessage } from "../../lib/agentCollaborators/contracts";

/** Four bounded reads at a time; every chunk read independently checks consent. */
export async function loadVaultMessages(ctx: ActionCtx, args: { collaboratorId: Id<"agentCollaborators">; uploadId: string }, ids: Id<"twinVaultChunks">[]) {
  const messages: VaultMessage[] = [];
  for (let start = 0; start < ids.length; start += 4) {
    const batches = await Promise.all(ids.slice(start, start + 4).map((chunkId) => ctx.runQuery(internal.giftTwin.agent.chunk, { ...args, chunkId })));
    for (const batch of batches) messages.push(...batch);
  }
  return messages.sort((a, b) => a.sentAt - b.sentAt);
}
