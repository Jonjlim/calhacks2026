"use client";

import { useState } from "react";
import { CLUE_KIND_LABELS } from "@/components/clues/labels";
import type { RoomActions } from "@/components/room/types";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/ErrorText";
import { Panel } from "@/components/ui/Panel";
import type { ProposedClue } from "@/lib/contracts";
import { useResultAction } from "@/lib/useResultAction";
import { LIMITS } from "@/lib/validation";

const SPEAKER_LABELS = { recipient: "they said it", other: "someone else said it", unknown: "speaker unclear" } as const;

// PX-004: only the owning contributor sees this.
export function ProposedClueReview({
  clues,
  actions,
}: {
  clues: ProposedClue[];
  actions?: Pick<RoomActions, "publishClue" | "rejectClue" | "editClue">;
}) {
  const reviewable = clues.filter((c) => c.status === "proposed" || c.status === "edited");
  return (
    <Panel title="Your proposed clues (private)">
      {reviewable.length === 0 ? (
        <p className="text-sm text-plum-soft">Paste messages to propose clues.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reviewable.map((c) => (
            <ProposedClueRow key={c.id} clue={c} actions={actions} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ProposedClueRow({ clue, actions }: { clue: ProposedClue; actions?: Pick<RoomActions, "publishClue" | "rejectClue" | "editClue"> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(clue.text);
  const publish = useResultAction(actions?.publishClue);
  const reject = useResultAction(actions?.rejectClue);
  const edit = useResultAction(actions?.editClue);
  const busy = publish.pending || reject.pending || edit.pending;

  async function save() {
    const res = await edit.run(clue.id, text);
    if (res.ok) setEditing(false);
  }

  return (
    <li className="text-sm">
      <span className="font-medium">{CLUE_KIND_LABELS[clue.kind]}</span>{" "}
      {editing ? (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={LIMITS.clueTextMaxChars}
          className="mt-1 w-full rounded-lg border border-plum/15 bg-white px-2 py-1 text-sm"
        />
      ) : (
        clue.text
      )}
      <p className="text-[12px] text-plum-soft">
        {Math.round(clue.confidence * 100)}% sure · {SPEAKER_LABELS[clue.speakerAssumption]}
        {clue.status === "edited" && " · edited"}
      </p>
      {actions && (
        <div className="mt-1 flex gap-2">
          {editing ? (
            <>
              <Button variant="primary" disabled={busy || !text.trim()} onClick={save}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" disabled={busy} onClick={() => publish.run(clue.id)}>
                Publish to room
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => reject.run(clue.id)}>
                Discard
              </Button>
            </>
          )}
        </div>
      )}
      <ErrorText error={publish.error ?? reject.error ?? edit.error} />
    </li>
  );
}
