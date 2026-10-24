"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Panel } from "@/components/ui/Panel";
import { errorText, unwrap } from "@/lib/live/result";

/** Organizer-only switch: lets Unwrap answer questions without an @mention. Everyone sees the current mode. */
export function ChatModeToggle({ roomId }: { roomId: Id<"rooms"> }) {
  const activity = unwrap(useQuery(api.agents.buyer.listActivity, { roomId }));
  const setChatMode = useMutation(api.agents.buyer.setChatMode);
  const [error, setError] = useState<string>();
  const caps = activity.value?.capabilities;
  if (!caps) return null;

  async function toggle(on: boolean) {
    setError(undefined);
    try {
      const res = await setChatMode({ roomId, mode: on ? "chatty" : "quiet" });
      if (!res.ok) setError(res.error.message);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Panel title="How Unwrap joins in">
      {caps.canSetChatMode ? (
        <label className="flex items-start gap-2 text-sm text-plum-soft">
          <input type="checkbox" className="mt-1" checked={caps.chatMode === "chatty"} onChange={(e) => toggle(e.target.checked)} />
          <span>Let Unwrap join the conversation. It answers questions from the room&apos;s clues and options without an @mention, and never starts a search on its own.</span>
        </label>
      ) : (
        <p className="text-sm text-plum-soft">
          {caps.chatMode === "chatty" ? "Unwrap is joining the conversation." : "Unwrap speaks when you @mention it or press Ask Unwrap."}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-coral">{error}</p>}
    </Panel>
  );
}
