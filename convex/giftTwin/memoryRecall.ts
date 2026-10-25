/** Local-session operations only. Never accepts a cloud index or SDK-provided text. */
import type { SessionIndex } from "@moss-js/moss";
import { TWIN_LIMITS, type RoomIdea, type VaultMessage } from "../../lib/agentCollaborators/contracts";
import { searchMessages, searchTerms } from "./vote";

export async function recallIdeaEvidence(
  session: Pick<SessionIndex, "addDocs" | "query">,
  ideas: RoomIdea[],
  messages: VaultMessage[],
  recipientName: string,
) {
  // IDs are local to this invocation. No room, device, or recipient identifiers
  // are sent to Moss in the session name or document metadata.
  const byId = new Map(messages.map((message, index) => [`m${index}`, message]));
  const indexingStart = performance.now();
  // Bound native embedding work per batch even for a vault full of short texts.
  const docs = [...byId].map(([id, message]) => ({ id, text: message.text }));
  for (let start = 0; start < docs.length; start += 128) await session.addDocs(docs.slice(start, start + 128));
  const indexingMs = performance.now() - indexingStart;
  const evidence = new Map<string, VaultMessage[]>();
  const queryMs: number[] = [];
  let failedQueries = 0;
  for (const idea of ideas.slice(0, TWIN_LIMITS.contextIdeasMax)) {
    // Keep explicit keyword contradictions/ownership alongside semantic matches.
    const lexical = searchMessages(messages, searchTerms(idea.text, [recipientName]), 4);
    let semantic: VaultMessage[] = [];
    const start = performance.now();
    try {
      const result = await session.query(idea.text, { topK: 8, alpha: 0.8 });
      semantic = result.docs.slice(0, 8).flatMap((hit) => {
        const message = byId.get(hit.id);
        return message && Number.isFinite(hit.score) ? [message] : [];
      });
      queryMs.push(performance.now() - start);
    } catch {
      // Error objects may contain private text or credentials: never log them.
      failedQueries += 1;
    }
    evidence.set(idea.ref, [...new Set([...lexical, ...semantic])].slice(0, 12));
  }
  return { evidence, indexingMs, queryMs, failedQueries };
}
