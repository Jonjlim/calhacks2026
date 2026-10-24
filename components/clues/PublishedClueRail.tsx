"use client";

import { type FormEvent, useState } from "react";
import { CLUE_KIND_LABELS, CLUE_KINDS } from "@/components/clues/labels";
import type { RoomActions } from "@/components/room/types";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/ErrorText";
import { Panel } from "@/components/ui/Panel";
import type { ClueKind, Participant, PublishedClue } from "@/lib/contracts";
import { useResultAction } from "@/lib/useResultAction";
import { LIMITS } from "@/lib/validation";

// PX-005: room-visible knowledge.
export function PublishedClueRail({
  clues,
  participants,
  me,
  actions,
}: {
  clues: PublishedClue[];
  participants: Participant[];
  me?: Participant;
  actions?: Pick<RoomActions, "withdrawClue" | "addManualClue">;
}) {
  const [kind, setKind] = useState<ClueKind>("interest");
  const [text, setText] = useState("");
  const add = useResultAction(actions?.addManualClue);
  const withdraw = useResultAction(actions?.withdrawClue);
  const nameOf = (id: string) => (id === me?.id ? "you" : (participants.find((p) => p.id === id)?.displayName ?? "someone"));
  const visible = clues.filter((c) => c.status !== "withdrawn");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await add.run(kind, text);
    if (res.ok) setText("");
  }

  return (
    <Panel title="What the room knows">
      {visible.length === 0 && <p className="text-sm text-plum-soft">No clues yet. Publish one or add what you know.</p>}
      <ul className="flex flex-col gap-2">
        {visible.map((c) => (
          <li key={c.id} className={`text-sm ${c.status === "source_withdrawn" ? "text-plum-soft line-through" : ""}`}>
            <span className="font-medium">{CLUE_KIND_LABELS[c.kind]}</span>: {c.text}
            <span className="ml-1 text-[11px] text-plum-soft no-underline">
              — {c.status === "source_withdrawn" ? "source removed" : nameOf(c.publisherId)}
            </span>
            {c.excerpt && <p className="text-[12px] text-plum-soft italic">“{c.excerpt}”</p>}
            {actions && c.status === "active" && c.publisherId === me?.id && (
              <Button variant="ghost" className="ml-1" disabled={withdraw.pending} onClick={() => withdraw.run(c.id)}>
                Withdraw
              </Button>
            )}
          </li>
        ))}
      </ul>
      {actions && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2 border-t border-plum/10 pt-3">
          <span className="text-[12px] text-plum-soft">Add something you know (everyone in the room will see it)</span>
          <div className="flex gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ClueKind)}
              className="rounded-lg border border-plum/15 bg-white px-2 py-1.5 text-sm"
            >
              {CLUE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CLUE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={LIMITS.clueTextMaxChars}
              placeholder="Loves pottery"
              className="min-w-0 flex-1 rounded-lg border border-plum/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-plum/40"
            />
          </div>
          <Button type="submit" variant="primary" className="self-start" disabled={add.pending || !text.trim()}>
            Add clue
          </Button>
        </form>
      )}
      <ErrorText error={add.error ?? withdraw.error} />
    </Panel>
  );
}
