"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { Panel } from "@/components/ui/Panel";
import { errorText } from "@/lib/live/result";

export function CreateRoomForm() {
  const createRoom = useMutation(api.rooms.createRoom);
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const budget = Number(form.get("budget"));
    setBusy(true);
    setError(undefined);
    try {
      const res = await createRoom({
        title: String(form.get("title") ?? ""),
        recipientDisplayName: String(form.get("recipientDisplayName") ?? ""),
        occasion: String(form.get("occasion") ?? ""),
        displayName: String(form.get("displayName") ?? "") || undefined,
        ...(budget > 0 ? { budgetMinor: Math.round(budget * 100) } : {}),
      });
      if (!res.ok) setError(res.error.message);
      else router.push(`/room/${res.value.room._id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Start a gift room">
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <input name="title" required placeholder="Room title" className="rounded border px-3 py-2" />
        <input
          name="recipientDisplayName"
          required
          placeholder="Who is it for?"
          className="rounded border px-3 py-2"
        />
        <input name="occasion" required placeholder="Occasion" className="rounded border px-3 py-2" />
        <input name="displayName" placeholder="Your name" className="rounded border px-3 py-2" />
        <input
          name="budget"
          type="number"
          min="1"
          step="1"
          placeholder="Budget in USD (optional)"
          className="rounded border px-3 py-2"
        />
        <button type="submit" disabled={busy} className="rounded bg-plum px-4 py-2 text-ivory disabled:opacity-60">
          {busy ? "Creating…" : "Create room"}
        </button>
        {error && <p role="alert" className="text-sm text-coral">{error}</p>}
      </form>
    </Panel>
  );
}
