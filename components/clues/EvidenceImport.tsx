"use client";

import { type FormEvent, useState } from "react";
import type { AgentJobRow, RoomActions } from "@/components/room/types";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/ErrorText";
import { Panel } from "@/components/ui/Panel";
import type { EvidenceSource } from "@/lib/contracts";
import { useResultAction } from "@/lib/useResultAction";
import { LIMITS } from "@/lib/validation";

// PX-004: contributor-private paste → AI extraction → proposed clues.
export function EvidenceImport({
  evidence,
  latestJob,
  modelConfigured,
  actions,
}: {
  evidence: EvidenceSource[];
  latestJob?: AgentJobRow;
  modelConfigured?: boolean;
  actions?: Pick<RoomActions, "importEvidence" | "deleteEvidence" | "retryJob">;
}) {
  const [label, setLabel] = useState("");
  const [rawText, setRawText] = useState("");
  const importer = useResultAction(actions?.importEvidence);
  const remover = useResultAction(actions?.deleteEvidence);
  const retry = useResultAction(actions?.retryJob);

  if (!actions) {
    return (
      <Panel title="Paste messages (private)">
        <p className="text-sm text-plum-soft">Connect the backend to paste messages and extract clues.</p>
      </Panel>
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await importer.run(label.trim() || "Pasted messages", rawText);
    if (res.ok) {
      setLabel("");
      setRawText("");
    }
  }

  const reading = latestJob?.status === "pending" || latestJob?.status === "running";
  const failed = latestJob?.status === "failed" || latestJob?.status === "uncertain";

  return (
    <Panel title="Paste messages (private)">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <p className="text-[12px] text-plum-soft">
          Only you can see what you paste. Unwrap suggests clues from it, and nothing reaches the room until you publish.
        </p>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          placeholder="Label (e.g. Group chat, June)"
          className="rounded-lg border border-plum/15 bg-white px-3 py-1.5 text-sm outline-none focus:border-plum/40"
        />
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          maxLength={LIMITS.importRawTextMaxChars}
          rows={4}
          placeholder={"Maya: I keep meaning to try a pottery class\nMe: you'd love it"}
          className="rounded-lg border border-plum/15 bg-white px-3 py-2 font-mono text-[12.5px] outline-none focus:border-plum/40"
        />
        <Button type="submit" variant="primary" className="self-start" disabled={importer.pending || !rawText.trim()}>
          {importer.pending ? "Saving…" : "Find clues"}
        </Button>
        <ErrorText error={importer.error ?? remover.error ?? retry.error} />
      </form>

      {modelConfigured === false && (
        <p className="mt-2 text-[12px] text-plum-soft">AI extraction isn&apos;t configured, so add clues by hand below instead.</p>
      )}
      {reading && <p className="mt-2 text-[13px] text-plum-soft italic">Reading your messages…</p>}
      {failed && latestJob && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-coral/10 px-3 py-2 text-[13px] text-[#8c3b2c]">
          <span>{latestJob.status === "uncertain" ? "Clue extraction is still unresolved." : "Clue extraction failed."}</span>
          {latestJob.canRetry && (
            <Button variant="danger" disabled={retry.pending} onClick={() => retry.run(latestJob.id)}>
              Retry
            </Button>
          )}
        </div>
      )}

      {evidence.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-plum/10 pt-2">
          {evidence.map((source) => (
            <li key={source.id} className="flex items-center justify-between text-[13px]">
              <span>{source.label}</span>
              <Button variant="danger" disabled={remover.pending} onClick={() => remover.run(source.id)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
