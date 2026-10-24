"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { CLUE_KIND_LABELS } from "@/components/clues/labels";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/ErrorText";
import { Panel } from "@/components/ui/Panel";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ClueKind } from "@/lib/contracts";
import { useResultAction } from "@/lib/useResultAction";

const MAX_LINES = 3;

/** Organizer-only opt-in: choose what other Unwrap users may see about this gift. Nothing is public until Share. */
export function ShareWorldPanel({ roomId }: { roomId: Id<"rooms"> }) {
  const current = useQuery(api.worlds.getMyWorldShare, { roomId });
  const cluesRes = useQuery(api.clues.listPublishedClues, { roomId });
  const share = useMutation(api.worlds.shareWorld);
  const unshare = useMutation(api.worlds.unshareWorld);
  const [alias, setAlias] = useState("");
  const [picked, setPicked] = useState<Id<"publishedClues">[]>([]);

  const sharer = useResultAction((aliasText: string, ids: Id<"publishedClues">[]) =>
    share({ roomId, ...(aliasText.trim() ? { recipientAlias: aliasText.trim() } : {}), highlightClueIds: ids }),
  );
  const stopper = useResultAction(() => unshare({ roomId }));

  const shared = current?.ok ? current.value : null;
  const clues = cluesRes?.ok ? cluesRes.value.filter((c) => c.status === "active") : [];
  const shownAlias = alias.trim() || "Someone special";
  const previewLines = clues.filter((c) => picked.includes(c._id));

  function toggle(id: Id<"publishedClues">) {
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : now.length < MAX_LINES ? [...now, id] : now));
  }

  return (
    <Panel title="Share this gift as a world">
      {current === undefined && <p className="text-sm text-plum-soft">Loading…</p>}
      {current && !current.ok && <p className="text-sm text-coral">{current.error.message}</p>}
      {current?.ok && (
        <div className="flex flex-col gap-3">
          <p className="text-[12px] text-plum-soft">
            {shared
              ? `Currently shared as “${shared.recipientAlias}”. Updating replaces what others see.`
              : "Not shared. Nothing about this room is visible to other Unwrap users."}
          </p>
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            maxLength={40}
            placeholder="Describe them without a name (default: Someone special)"
            className="rounded-lg border border-plum/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-plum/40"
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[12px] text-plum-soft">Show up to {MAX_LINES} clue lines (optional)</legend>
            {clues.length === 0 && <p className="text-sm text-plum-soft">No published clues to show yet.</p>}
            {clues.map((clue) => {
              const checked = picked.includes(clue._id);
              return (
                <label key={clue._id} className="flex items-start gap-2 text-sm text-plum-soft">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked}
                    disabled={!checked && picked.length >= MAX_LINES}
                    onChange={() => toggle(clue._id)}
                  />
                  <span>
                    <span className="font-medium text-plum">{CLUE_KIND_LABELS[clue.kind as ClueKind] ?? clue.kind}:</span> {clue.text}
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div className="rounded-lg bg-plum/5 p-3 text-sm">
            <p className="text-[11px] uppercase tracking-wide text-plum-soft">What others will see</p>
            <p className="font-medium text-plum">For {shownAlias}</p>
            {previewLines.length > 0 ? (
              <ul className="mt-1 italic text-plum-soft">
                {previewLines.map((c) => (
                  <li key={c._id}>“{c.text}”</li>
                ))}
              </ul>
            ) : (
              <p className="text-plum-soft">No clue lines, only coarse counts, the occasion and the final pick.</p>
            )}
            <p className="mt-2 text-[12px] text-plum-soft">
              The server replaces names in these lines before sharing. Clue lines become visible to every Unwrap user.
              Never shown: names, chats, imports, budgets or limits.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={sharer.pending} onClick={() => sharer.run(alias, picked)}>
              {sharer.pending ? "Saving…" : shared ? "Update" : "Share"}
            </Button>
            {shared && (
              <Button variant="danger" disabled={stopper.pending} onClick={() => stopper.run()}>
                Stop sharing
              </Button>
            )}
          </div>
          <ErrorText error={sharer.error ?? stopper.error} />
        </div>
      )}
    </Panel>
  );
}
