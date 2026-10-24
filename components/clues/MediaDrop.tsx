"use client";

import { useMutation } from "convex/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { reencodeImage } from "@/lib/live/image";
import { errorText } from "@/lib/live/result";

type Item = { blob: Blob; preview: string; marker?: { x: number; y: number } };
type Phase = "idle" | "preparing" | "uploading" | "importing" | "started";

const PHASE_TEXT: Record<Phase, string> = {
  idle: "",
  preparing: "Preparing images…",
  uploading: "Uploading…",
  importing: "Saving privately…",
  started: "Reading privately… proposed clues will appear below.",
};

export function MediaDrop({ roomId, kind }: { roomId: Id<"rooms">; kind: "photo" | "screenshot" }) {
  const genUrl = useMutation(api.media.generateEvidenceUploadUrl);
  const importMedia = useMutation(api.media.importMediaEvidence);
  const extractClues = useMutation(api.agents.extract.extractClues);
  const [items, setItems] = useState<Item[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string>();
  const previews = useRef<string[]>([]);
  const isPhoto = kind === "photo";

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function reset() {
    previews.current.forEach((u) => URL.revokeObjectURL(u));
    previews.current = [];
    setItems([]);
  }

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setError(undefined);
    setPhase("preparing");
    try {
      const picked = Array.from(files).slice(0, 3);
      const next: Item[] = [];
      for (const file of picked) {
        const blob = await reencodeImage(file);
        const preview = URL.createObjectURL(blob);
        previews.current.push(preview);
        next.push({ blob, preview });
      }
      reset();
      previews.current = next.map((n) => n.preview);
      setItems(next);
      setPhase("idle");
    } catch (err) {
      setError(errorText(err));
      setPhase("idle");
    }
  }

  function onMark(index: number, e: MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const marker = {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, marker } : it)));
  }

  async function submit() {
    if (!items.length) return;
    setError(undefined);
    try {
      setPhase("uploading");
      const files: Array<{ storageId: Id<"_storage">; marker?: { x: number; y: number } }> = [];
      for (const item of items) {
        const url = await genUrl({ roomId });
        if (!url.ok) throw new Error(url.error.message);
        const res = await fetch(url.value.uploadUrl, {
          method: "POST",
          headers: { "Content-Type": item.blob.type },
          body: item.blob,
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        files.push({ storageId, ...(isPhoto && item.marker ? { marker: item.marker } : {}) });
      }
      setPhase("importing");
      const imported = await importMedia({
        roomId,
        kind,
        label: isPhoto ? "Photos" : "Screenshots",
        files,
      });
      if (!imported.ok) throw new Error(imported.error.message);
      const started = await extractClues({ sourceId: imported.value.source._id });
      if (!started.ok) throw new Error(started.error.message);
      reset();
      setPhase("started");
    } catch (err) {
      setError(errorText(err));
      setPhase("idle");
    }
  }

  const busy = phase === "preparing" || phase === "uploading" || phase === "importing";

  return (
    <div className="mb-3 flex flex-col gap-2 text-sm">
      <p className="text-plum-soft">
        {isPhoto
          ? "Read once, then deleted. Only you can see the result until you publish a clue."
          : "Chat text is transcribed privately, then the image is deleted. Only you can see the result until you publish a clue."}
      </p>
      {isPhoto && (
        <p className="text-plum-soft">
          Tap the person this gift is for. This is your mark, not face recognition.
        </p>
      )}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={busy}
        onChange={(e) => {
          void onPick(e.target.files);
          e.target.value = "";
        }}
        aria-label={isPhoto ? "Choose 1 to 3 photos" : "Choose 1 to 3 screenshots"}
      />
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {items.map((it, i) => (
            <li key={it.preview} className="flex flex-col gap-1">
              <span className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={it.preview}
                  alt={`Upload ${i + 1}`}
                  onClick={isPhoto ? (e) => onMark(i, e) : undefined}
                  className={`h-28 w-auto rounded border ${isPhoto ? "cursor-crosshair" : ""}`}
                />
                {isPhoto && it.marker && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-coral"
                    style={{ left: `${it.marker.x * 100}%`, top: `${it.marker.y * 100}%` }}
                  />
                )}
              </span>
              {isPhoto && (
                <span className="text-xs text-plum-soft">
                  {it.marker ? "Recipient marked" : "No mark — scene only"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={busy || items.length === 0}
        className="self-start rounded bg-plum px-4 py-2 text-ivory disabled:opacity-60"
      >
        Find clues
      </button>
      {PHASE_TEXT[phase] && <p className="text-plum-soft">{PHASE_TEXT[phase]}</p>}
      {error && (
        <p role="alert" className="text-coral">
          {error}
        </p>
      )}
    </div>
  );
}
