"use client";

import { MapIcon } from "@/components/world/room/MapIcon";
import type { AgentCollaboratorFeed as Feed, AgentCollaboratorPostView } from "@/lib/agentCollaborators/contracts";

const VOTE = {
  up: { label: "Supports", tone: "bg-[#dcebdf] text-[#2f5e3d]" },
  down: { label: "Doesn’t fit", tone: "bg-[#f3dcd5] text-[#8c3b2c]" },
} as const;

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Read-only, room-visible timeline of agent collaborator posts, written as if
 * a friend were speaking. Self-contained so the map can mount it later.
 */
export function AgentCollaboratorFeed({ feed }: { feed: Feed }) {
  const names = new Map(feed.collaborators.map((c) => [c.id, c.displayName]));
  const posts = [...feed.posts].sort((a, b) => b.createdAt - a.createdAt);
  if (posts.length === 0) return <p className="text-[14px] text-dusk/60">Nothing yet. The twin posts once the recipient shares their messages.</p>;
  const votes = posts.filter((p) => p.kind === "vote");
  const insights = posts.filter((p) => p.kind === "insight");
  return (
    <div className="flex flex-col gap-5">
      {votes.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-[12.5px] font-semibold uppercase tracking-wide text-dusk/60">Votes on the room&apos;s ideas</h3>
          <ol className="flex flex-col gap-3">
            {votes.map((post) => (
              <li key={post.id}>
                <PostBubble author={post.authorName ?? names.get(post.collaboratorId) ?? "Gift Twin"} post={post} />
              </li>
            ))}
          </ol>
        </section>
      )}
      {insights.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-[12.5px] font-semibold uppercase tracking-wide text-dusk/60">Found in their messages</h3>
          <ol className="flex flex-col gap-3">
            {insights.map((post) => (
              <li key={post.id}>
                <PostBubble author={post.authorName ?? names.get(post.collaboratorId) ?? "Gift Twin"} post={post} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function PostBubble({ author, post }: { author: string; post: AgentCollaboratorPostView }) {
  return (
    <div className={`max-w-[95%] rounded-2xl rounded-bl-sm border-2 px-4 py-3 ${post.vote === "up" ? "border-[#94bda3] bg-[#e9f5ed]" : post.vote === "down" ? "border-[#d9a198] bg-[#fbece8]" : "border-[#b29bce] bg-[#f3edfc]"}`}>
      <p className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-dusk/60">
        <MapIcon name="twin" size={18} />
        {author}
        <span className="rounded-full bg-[#e5d9f4] px-2 py-0.5 font-medium text-[#73549d]">AI collaborator</span>
        {post.kind === "insight" && <span className="text-[#73549d]">Gift insight</span>}
        {post.vote && <span className={`rounded-full px-2 py-0.5 font-medium ${VOTE[post.vote].tone}`}>{VOTE[post.vote].label}</span>}
        <span className="font-normal">
          {post.confidence} confidence{post.evidenceCount ? ` · ${post.evidenceCount} message${post.evidenceCount === 1 ? "" : "s"}` : ""}
        </span>
      </p>
      {post.ideaText && <p className="mt-1 text-[13px] text-dusk/60">Room idea: {post.ideaText}</p>}
      <p className="mt-1 text-[15px] text-dusk">
        {post.kind === "insight" ? "I learned that " : ""}
        {sentence(post.text)}
      </p>
      {post.status === "added" && <p className="mt-2 text-[13px] font-medium text-[#3f7a52]">Added to the room by Unwrap</p>}
      {post.status === "suggested" && <p className="mt-2 text-[13px] text-dusk/55">Unwrap is reviewing this…</p>}
    </div>
  );
}
