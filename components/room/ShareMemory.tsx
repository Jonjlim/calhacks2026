"use client";

import { useMutation } from "convex/react";
import { type FormEvent, useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ClueKind } from "@/lib/contracts";
import { Panel } from "@/components/ui/Panel";
import { errorFromThrown } from "@/lib/client";
import { LIMITS } from "@/lib/validation";

/**
 * Friendly memory categories mapped onto the existing clue kinds, so a memory is
 * stored as a room-visible manual clue (clues.upsertManualPreference) rather than
 * in a parallel table. Shared memories are visible to everyone in the room.
 */
const KINDS: { value: ClueKind; label: string }[] = [
  { value: "uncertain", label: "A memory or moment" },
  { value: "interest", label: "Something they love doing" },
  { value: "explicit_wish", label: "Something they've wished for" },
  { value: "ownership", label: "Something they already have" },
  { value: "exclusion", label: "Something to avoid" },
];

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; text: string } | { kind: "error"; message: string };

/** Short chip labels for the phone composer. */
const CHIPS: Record<string, string> = {
  uncertain: "A moment",
  interest: "They love",
  explicit_wish: "They wish for",
  ownership: "They already have",
  exclusion: "Avoid",
};

export function ShareMemory({ roomId, recipientName, variant = "panel" }: { roomId: Id<"rooms">; recipientName: string; variant?: "panel" | "phone" }) {
  const upsert = useMutation(api.clues.upsertManualPreference);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ClueKind>("interest");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const ids = { text: useId(), kind: useId(), hint: useId() };
  const trimmed = text.trim();
  const tooLong = trimmed.length > LIMITS.clueTextMaxChars;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "saving") return;
    if (!trimmed) return setStatus({ kind: "error", message: `Write a few words about ${recipientName} first.` });
    if (tooLong) return setStatus({ kind: "error", message: `Keep it under ${LIMITS.clueTextMaxChars} characters.` });
    setStatus({ kind: "saving" });
    try {
      const res = await upsert({ roomId, kind, text: trimmed });
      if (!res.ok) return setStatus({ kind: "error", message: res.error.message });
      setStatus({ kind: "saved", text: res.value.text });
      setText("");
    } catch (err) {
      // Keep what they typed so nothing is lost on a network hiccup.
      setStatus({ kind: "error", message: errorFromThrown(err).message });
    }
  }

  if (variant === "phone") {
    return (
      <form onSubmit={onSubmit} noValidate className="paper-card flex flex-col gap-3 rounded-[22px] p-4" aria-label={`Share a memory of ${recipientName}`}>
        <h2 className="font-display text-[26px] leading-tight text-dusk">A memory of {recipientName}</h2>
        <div role="radiogroup" aria-label="What kind of note is it?" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`min-h-11 shrink-0 rounded-full border px-4 text-[15px] font-medium transition ${kind === k.value ? "border-dusk bg-dusk text-paper" : "border-dusk/20 bg-paper/80 text-dusk"}`}
            >
              {CHIPS[k.value] ?? k.label}
            </button>
          ))}
        </div>
        <label htmlFor={ids.text} className="sr-only">
          Your memory
        </label>
        <textarea
          id={ids.text}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (status.kind === "error" || status.kind === "saved") setStatus({ kind: "idle" });
          }}
          rows={3}
          enterKeyHint="send"
          aria-describedby={ids.hint}
          aria-invalid={tooLong || undefined}
          placeholder={`e.g. ${recipientName} keeps talking about a pottery class`}
          // 16px+ text stops iOS zooming into the field.
          className="rounded-2xl border border-dusk/15 bg-white/85 px-4 py-3 text-[17px] leading-relaxed text-dusk outline-none focus:border-dusk/40 focus:ring-4 focus:ring-lilac/70"
        />
        <div className="flex items-center justify-between gap-3">
          <p id={ids.hint} className={`text-xs ${tooLong ? "text-coral" : "text-dusk/55"}`}>
            Everyone in the room sees this · {trimmed.length}/{LIMITS.clueTextMaxChars}
          </p>
          <button type="submit" disabled={status.kind === "saving" || !trimmed} className="btn-primary h-12 shrink-0 px-6 text-[16px] disabled:opacity-50">
            {status.kind === "saving" ? "Saving…" : "Add"}
          </button>
        </div>
        {status.kind === "saved" && (
          <p role="status" className="rounded-xl bg-[#e4ebdd] px-3 py-2 text-sm text-[#3f5a3d]">
            Dropped into the jar: “{status.text}”
          </p>
        )}
        {status.kind === "error" && (
          <p role="alert" className="text-sm text-coral">
            {status.message}
          </p>
        )}
      </form>
    );
  }

  return (
    <Panel title={`Share a memory of ${recipientName}`}>
      {status.kind === "saved" && (
        <div role="status" className="mb-3 rounded-xl bg-[#e4ebdd] px-3 py-2 text-sm text-[#3f5a3d]">
          Saved to the room: “{status.text}”
        </div>
      )}
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <label htmlFor={ids.kind} className="text-xs font-semibold tracking-wide text-plum/70">
          What kind of note is it?
        </label>
        <select id={ids.kind} value={kind} onChange={(e) => setKind(e.target.value as ClueKind)} className="min-h-11 rounded-lg border bg-white px-3 text-base">
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <label htmlFor={ids.text} className="text-xs font-semibold tracking-wide text-plum/70">
          Your memory
        </label>
        <textarea
          id={ids.text}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (status.kind === "error" || status.kind === "saved") setStatus({ kind: "idle" });
          }}
          rows={4}
          aria-describedby={ids.hint}
          aria-invalid={tooLong || undefined}
          placeholder={`e.g. ${recipientName} has been talking about trying a pottery class`}
          className="rounded-lg border bg-white px-3 py-2 text-base leading-relaxed"
        />
        <p id={ids.hint} className={`text-xs ${tooLong ? "text-coral" : "text-plum-soft"}`}>
          {trimmed.length}/{LIMITS.clueTextMaxChars} · Everyone in this room can read what you share.
        </p>
        <button type="submit" disabled={status.kind === "saving"} className="min-h-11 rounded-lg bg-plum px-4 py-2 text-base text-ivory disabled:opacity-60">
          {status.kind === "saving" ? "Saving…" : status.kind === "saved" ? "Share another memory" : "Share memory"}
        </button>
        {status.kind === "error" && (
          <p role="alert" className="text-sm text-coral">
            {status.message}
          </p>
        )}
      </form>
    </Panel>
  );
}
