"use client";

import Link from "next/link";
import { useState } from "react";
import type { Participant, Room } from "@/lib/contracts";
import { inviteUrl } from "@/lib/invite";

export function RoomHeader({
  room,
  participants,
  me,
  invitePath,
}: {
  room: Room;
  participants: Participant[];
  me: Participant;
  invitePath?: string;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function copyInvite() {
    if (!invitePath) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(invitePath, window.location.origin));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2000);
  }

  return (
    <header className="flex flex-col gap-3 lg:col-span-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <Link href="/" className="font-display text-[22px] leading-none font-semibold text-dusk">
          unwrap<span className="text-coral-soft">.</span>
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-plum">{room.title}</h1>
        <p className="text-sm text-plum-soft">
          For {room.recipientDisplayName} · {room.occasion} · {participants.length} in the room
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {participants.map((p) => (
            <li key={p.id} className="rounded-full bg-plum/5 px-2.5 py-0.5 text-[12px] text-plum">
              {p.displayName}
              {p.id === me.id && " (you)"}
              {p.role === "organizer" && " · organizer"}
            </li>
          ))}
        </ul>
      </div>
      {invitePath && (
        <div className="flex items-center gap-2">
          <code className="max-w-[260px] truncate rounded-lg bg-plum/5 px-2.5 py-1.5 text-[12px] text-plum-soft">{invitePath}</code>
          <button type="button" onClick={copyInvite} className="rounded-full bg-plum px-3 py-1.5 text-[13px] font-medium text-ivory">
            {copied === "copied" ? "Copied!" : copied === "failed" ? "Copy failed" : "Copy invite link"}
          </button>
        </div>
      )}
    </header>
  );
}
