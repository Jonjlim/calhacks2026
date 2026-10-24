"use client";

import { Panel } from "@/components/ui/Panel";

// TODO(PX-002): wire to api.rooms.createRoom once BE-002 lands.
export function CreateRoomForm() {
  return (
    <Panel title="Start a gift room">
      <form className="flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
        <input name="title" placeholder="Room title" className="rounded border px-3 py-2" />
        <input
          name="recipientDisplayName"
          placeholder="Who is it for?"
          className="rounded border px-3 py-2"
        />
        <input name="occasion" placeholder="Occasion" className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-plum px-4 py-2 text-ivory">
          Create room
        </button>
      </form>
    </Panel>
  );
}
