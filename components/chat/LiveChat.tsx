"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Participant } from "@/lib/contracts";
import { Panel } from "@/components/ui/Panel";
import { errorText, unwrap } from "@/lib/live/result";

/** Human chat plus open agent questions. Agent messages are visually distinct and never styled as success by default. */
export function LiveChat({ roomId, participants }: { roomId: Id<"rooms">; participants: Participant[] }) {
  const messages = unwrap(useQuery(api.messages.listMessages, { roomId }));
  const activity = unwrap(useQuery(api.agents.buyer.listActivity, { roomId }));
  const send = useMutation(api.messages.sendMessage);
  const requestTurn = useMutation(api.agents.buyer.requestTurn);
  const [text, setText] = useState("");
  const [replySlot, setReplySlot] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const nameOf = (id?: string) => participants.find((p) => p.id === id)?.displayName ?? "Someone";
  const openQuestions = activity.value?.questions ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await send({
        roomId,
        body,
        clientIdempotencyKey: crypto.randomUUID(),
        ...(replySlot ? { replyToSlot: replySlot } : {}),
      });
      if (!res.ok) setError(res.error.message);
      else {
        setText("");
        setReplySlot(undefined);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function askUnwrap() {
    setError(undefined);
    try {
      const res = await requestTurn({ roomId, mode: "auto" });
      if (!res.ok) setError(res.error.message);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Panel title="Room chat">
      <ul className="mb-3 flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
        {messages.loading && <li className="text-sm text-plum-soft">Loading…</li>}
        {messages.error && <li className="text-sm text-coral">{messages.error.message}</li>}
        {messages.value?.map((m) => (
          <li
            key={m._id}
            className={m.authorKind === "buyer_agent" ? "rounded bg-plum/5 p-2 italic" : "p-2"}
          >
            <span className="font-medium">
              {m.authorKind === "buyer_agent" ? "Unwrap" : nameOf(m.participantId)}:
            </span>{" "}
            {m.body}
          </li>
        ))}
      </ul>

      {openQuestions.length > 0 && (
        <div className="mb-3 rounded border border-coral/40 p-2 text-sm">
          <p className="font-medium">Unwrap is waiting on an answer</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {openQuestions.map((q) => (
              <button
                key={q.slot}
                type="button"
                onClick={() => setReplySlot(replySlot === q.slot ? undefined : q.slot)}
                className={`rounded px-2 py-1 ${replySlot === q.slot ? "bg-coral text-white" : "border"}`}
              >
                Answer “{q.slot}”
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={replySlot ? `Answering “${replySlot}”…` : "Say something, or @unwrap to ask the agent"}
          className="rounded border px-3 py-2"
        />
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !text.trim()} className="rounded bg-plum px-4 py-2 text-ivory disabled:opacity-60">
            Send
          </button>
          <button type="button" onClick={askUnwrap} className="rounded border px-4 py-2">
            Ask Unwrap
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-coral">{error}</p>}
      </form>
    </Panel>
  );
}
