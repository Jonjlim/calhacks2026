"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ActivityView, RoomActions } from "@/components/room/types";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/ErrorText";
import { Panel } from "@/components/ui/Panel";
import type { ChatMessage, Participant } from "@/lib/contracts";
import { useResultAction } from "@/lib/useResultAction";
import { LIMITS } from "@/lib/validation";

const SLOT_LABELS: Record<string, string> = {
  budget: "the budget",
  exclusions: "things to avoid",
  occasion: "the occasion",
  already_owns: "what they already own",
  size: "sizing",
  timing: "timing",
  direction: "which direction to go",
};

// PX-003: transcript + composer. Agent and human messages must look distinct.
export function ChatPanel({
  messages,
  participants,
  me,
  activity,
  actions,
}: {
  messages: ChatMessage[];
  participants: Participant[];
  me?: Participant;
  activity?: ActivityView;
  actions?: Pick<RoomActions, "sendMessage" | "requestTurn" | "abandonQuestion" | "retryJob">;
}) {
  const nameOf = (id?: string) =>
    id && id === me?.id ? "You" : (participants.find((p) => p.id === id)?.displayName ?? "Someone");
  const [draft, setDraft] = useState("");
  const [replySlot, setReplySlot] = useState<string | undefined>();
  const send = useResultAction(actions?.sendMessage);
  const ask = useResultAction(actions?.requestTurn);
  const skip = useResultAction(actions?.abandonQuestion);
  const retry = useResultAction(actions?.retryJob);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const latestTurn = activity?.jobs.find((job) => job.kind === "evaluate_thread");
  const thinking = latestTurn?.status === "pending" || latestTurn?.status === "running";
  const turnFailed = latestTurn?.status === "failed" || latestTurn?.status === "uncertain";
  const openQuestions = activity?.questions ?? [];
  const activeReply = replySlot && openQuestions.some((q) => q.slot === replySlot) ? replySlot : undefined;
  const recentEvents = (activity?.events ?? []).slice(-3);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const res = await send.run(body, activeReply);
    if (res.ok) {
      setDraft("");
      setReplySlot(undefined);
    }
  }

  return (
    <Panel title="Room chat">
      <ul ref={listRef} className="flex max-h-[460px] min-h-[120px] flex-col gap-2 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <li className="text-sm text-plum-soft">Say hi, and share what you remember about them.</li>
        )}
        {messages.map((m) => (
          <li
            key={m.id}
            className={
              m.authorKind === "buyer_agent"
                ? "rounded-lg border border-plum/10 bg-plum/5 p-2 text-sm italic"
                : m.participantId === me?.id
                  ? "rounded-lg bg-coral/10 p-2 text-sm"
                  : "p-2 text-sm"
            }
          >
            <span className="font-medium not-italic">{m.authorKind === "buyer_agent" ? "Unwrap" : nameOf(m.participantId)}</span>
            <span className="ml-1.5 text-[11px] text-plum-soft not-italic">
              {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
        {thinking && <li className="p-2 text-sm text-plum-soft italic">Unwrap is thinking…</li>}
      </ul>

      {actions && (
        <div className="mt-3 flex flex-col gap-2">
          {turnFailed && latestTurn && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-coral/10 px-3 py-2 text-[13px] text-[#8c3b2c]">
              <span>{latestTurn.status === "uncertain" ? "Unwrap's last reply is still unresolved." : "Unwrap couldn't respond."}</span>
              {latestTurn.canRetry && (
                <Button variant="danger" disabled={retry.pending} onClick={() => retry.run(latestTurn.id)}>
                  Retry
                </Button>
              )}
            </div>
          )}

          {openQuestions.map((q) => (
            <div key={q.slot} className="flex items-center justify-between gap-2 rounded-lg bg-gold/20 px-3 py-2 text-[13px] text-dusk">
              <span>Unwrap asked about {SLOT_LABELS[q.slot] ?? q.slot}.</span>
              <span className="flex gap-1">
                <Button variant="ghost" onClick={() => setReplySlot(q.slot)} disabled={activeReply === q.slot}>
                  {activeReply === q.slot ? "Replying" : "Answer"}
                </Button>
                <Button variant="ghost" disabled={skip.pending} onClick={() => skip.run(q.slot)}>
                  Skip
                </Button>
              </span>
            </div>
          ))}

          <form onSubmit={submit} className="flex flex-col gap-2">
            {activeReply && (
              <p className="text-[12px] text-plum-soft">
                Replying to Unwrap about {SLOT_LABELS[activeReply] ?? activeReply} ·{" "}
                <button type="button" className="underline" onClick={() => setReplySlot(undefined)}>
                  cancel
                </button>
              </p>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              maxLength={LIMITS.chatBodyMaxChars}
              rows={2}
              placeholder="Share a memory or ask the room…"
              className="resize-none rounded-lg border border-plum/15 bg-white px-3 py-2 text-sm outline-none focus:border-plum/40"
            />
            <div className="flex items-center justify-between">
              <Button variant="ghost" disabled={ask.pending || thinking} onClick={() => ask.run()}>
                Ask Unwrap for help
              </Button>
              <Button type="submit" variant="primary" disabled={send.pending || !draft.trim()}>
                {send.pending ? "Sending…" : "Send"}
              </Button>
            </div>
            <ErrorText error={send.error ?? ask.error ?? skip.error ?? retry.error} />
          </form>

          {activity && !activity.capabilities.modelConfigured && (
            <p className="text-[12px] text-plum-soft">The AI facilitator is offline (no model configured). Chat still works.</p>
          )}
          {recentEvents.length > 0 && (
            <ul className="border-t border-plum/10 pt-2 text-[12px] text-plum-soft">
              {recentEvents.map((event) => (
                <li key={event.id}>· {event.summary}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}
