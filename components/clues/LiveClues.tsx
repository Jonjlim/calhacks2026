"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Panel } from "@/components/ui/Panel";
import { errorText, unwrap } from "@/lib/live/result";

/** Private import → extract → review → publish. Only the contributor ever sees the proposed list. */
export function LiveClues({ roomId }: { roomId: Id<"rooms"> }) {
  const proposed = unwrap(useQuery(api.clues.listMyProposedClues, { roomId }));
  const published = unwrap(useQuery(api.clues.listPublishedClues, { roomId }));
  const importEvidence = useMutation(api.clues.importEvidence);
  const extractClues = useMutation(api.agents.extract.extractClues);
  const publishClue = useMutation(api.clues.publishClue);
  const rejectClue = useMutation(api.clues.rejectProposedClue);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function guard<T>(fn: () => Promise<{ ok: boolean; error?: { message: string } } & T>) {
    setError(undefined);
    try {
      const res = await fn();
      if (!res.ok) setError(res.error?.message ?? "Request failed.");
      return res;
    } catch (err) {
      setError(errorText(err));
      return undefined;
    }
  }

  async function onImport(e: FormEvent) {
    e.preventDefault();
    if (!raw.trim()) return;
    setBusy(true);
    setStatus(undefined);
    const imported = await guard(() =>
      importEvidence({ roomId, kind: "paste", label: "Pasted messages", rawText: raw }),
    );
    if (imported?.ok && "value" in imported && imported.value) {
      const res = await guard(() => extractClues({ sourceId: imported.value.source._id }));
      if (res?.ok) {
        setRaw("");
        setStatus("Reading your messages privately… proposed clues will appear below.");
      }
    }
    setBusy(false);
  }

  const pending = (proposed.value ?? []).filter((c) => c.status === "proposed" || c.status === "edited");

  return (
    <>
      <Panel title="Your proposed clues (private)">
        <form onSubmit={onImport} className="mb-3 flex flex-col gap-2">
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            maxLength={20000}
            placeholder="Paste messages or memories about the recipient. Only you can see them until you publish a clue."
            className="rounded border px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy || !raw.trim()} className="self-start rounded bg-plum px-4 py-2 text-ivory disabled:opacity-60">
            Find clues
          </button>
        </form>
        {status && <p className="mb-2 text-sm text-plum-soft">{status}</p>}
        {error && <p role="alert" className="mb-2 text-sm text-coral">{error}</p>}
        {proposed.loading && <p className="text-sm text-plum-soft">Loading…</p>}
        <ul className="flex flex-col gap-2">
          {pending.map((c) => (
            <li key={c._id} className="rounded border border-plum/10 p-2 text-sm">
              <p>
                <span className="font-medium">{c.kind}</span>: {c.text}{" "}
                <span className="text-plum-soft">({Math.round(c.confidence * 100)}%)</span>
              </p>
              <div className="mt-1 flex gap-2">
                <button type="button" className="rounded bg-coral px-2 py-1 text-white" onClick={() => guard(() => publishClue({ proposedClueId: c._id }))}>
                  Publish to room
                </button>
                <button type="button" className="rounded border px-2 py-1" onClick={() => guard(() => rejectClue({ proposedClueId: c._id }))}>
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="What the room knows">
        {published.loading && <p className="text-sm text-plum-soft">Loading…</p>}
        <ul className="flex flex-col gap-2">
          {(published.value ?? [])
            .filter((c) => c.status === "active")
            .map((c) => (
              <li key={c._id} className="text-sm">
                <span className="font-medium">{c.kind}</span>: {c.text}
              </li>
            ))}
          {published.value?.length === 0 && <li className="text-sm text-plum-soft">Nothing published yet.</li>}
        </ul>
      </Panel>
    </>
  );
}
