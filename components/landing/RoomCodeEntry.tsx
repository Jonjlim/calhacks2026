"use client";

import { useState } from "react";
import { extractInviteToken } from "@/lib/invite";

/** A small way in for a friend who was given a room code (or a pasted link) instead of a QR. */
export function RoomCodeEntry() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const token = extractInviteToken(value);

  function go(event: React.FormEvent) {
    event.preventDefault();
    if (token) window.location.assign(`/join/${encodeURIComponent(token)}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        data-sfx="silent"
        onClick={() => setOpen(true)}
        className="pointer-events-auto absolute bottom-5 left-6 z-10 rounded-full px-3 py-1.5 text-[12.5px] font-medium text-dusk/65 transition hover:bg-paper/60 hover:text-dusk"
      >
        Have a room code?
      </button>
    );
  }

  return (
    <form
      onSubmit={go}
      onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
      className="pointer-events-auto absolute bottom-5 left-6 z-10 flex items-center gap-2 rounded-full border border-dusk/10 bg-paper/85 py-1.5 pr-1.5 pl-4 shadow-sm backdrop-blur-md"
    >
      <input
        autoFocus
        aria-label="Room code or invite link"
        placeholder="Room code"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        className="w-28 bg-transparent text-[14px] font-semibold tracking-[0.18em] text-dusk uppercase outline-none placeholder:font-medium placeholder:tracking-normal placeholder:text-dusk/45 placeholder:normal-case"
      />
      <button type="submit" disabled={!token} className="btn-primary h-8 px-4 text-[13px]">Join</button>
      <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="px-2 text-[16px] leading-none text-dusk/55 hover:text-dusk">×</button>
    </form>
  );
}
