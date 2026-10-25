import type { AgentCollaboratorFeed, AgentCollaboratorPostView } from "../agentCollaborators/contracts";

export interface TwinEvaluation {
  id: string;
  author: string;
  vote: "up" | "down";
  text: string;
}

/** Project screened posts only. Never infer agent authorship from a participant id or matching text. */
export function giftTwinMap(feed: AgentCollaboratorFeed | undefined, giftIdeaClueIds: ReadonlySet<string>) {
  const clueAuthors = new Map<string, string>();
  const evaluations: Record<string, TwinEvaluation[]> = {};
  const names = new Map(feed?.collaborators.map((c) => [c.id, c.displayName]));
  const author = (post: AgentCollaboratorPostView) => post.authorName ?? names.get(post.collaboratorId) ?? "Gift Twin";
  for (const post of feed?.posts ?? []) {
    if (post.status !== "added" && post.status !== "noted") continue;
    if (post.publishedClueId) clueAuthors.set(post.publishedClueId, author(post));
    if (post.kind !== "vote" || !post.vote || !post.ideaRef) continue;
    const key = post.ideaRef.startsWith("listing:") ? `gift:${post.ideaRef.slice(8)}`
      : post.ideaRef.startsWith("clue:") && giftIdeaClueIds.has(post.ideaRef.slice(5)) ? `idea:${post.ideaRef.slice(5)}` : post.ideaRef;
    (evaluations[key] ??= []).push({ id: post.id, author: author(post), vote: post.vote, text: post.text });
  }
  return { clueAuthors, evaluations };
}
