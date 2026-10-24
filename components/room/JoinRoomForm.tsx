"use client";

import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { Panel } from "@/components/ui/Panel";
import { errorText } from "@/lib/live/result";

export function JoinRoomForm({ initialToken = "" }: { initialToken?: string }) {
  const joinRoom = useMutation(api.rooms.joinRoom);
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const res = await joinRoom({
        inviteToken: String(form.get("inviteToken") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
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
    <Panel title="Join a room">
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <input
          name="inviteToken"
          required
          defaultValue={initialToken}
          placeholder="Invite code"
          className="rounded border px-3 py-2"
        />
        <input name="displayName" required placeholder="Your name" className="rounded border px-3 py-2" />
        <button type="submit" disabled={busy} className="rounded bg-coral px-4 py-2 text-white disabled:opacity-60">
          {busy ? "Joining…" : "Join"}
        </button>
        {error && <p role="alert" className="text-sm text-coral">{error}</p>}
      </form>
    </Panel>
  );
}
