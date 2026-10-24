"use client";

import { Panel } from "@/components/ui/Panel";

// TODO(PX-002): wire to api.rooms.joinRoom once BE-002 lands.
export function JoinRoomForm({ initialToken = "" }: { initialToken?: string }) {
  return (
    <Panel title="Join a room">
      <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
        <input
          name="inviteToken"
          defaultValue={initialToken}
          placeholder="Invite code"
          className="rounded border px-3 py-2"
        />
        <input name="displayName" placeholder="Your name" className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-coral px-4 py-2 text-white">
          Join
        </button>
      </form>
    </Panel>
  );
}
