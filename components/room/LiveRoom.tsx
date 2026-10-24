"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ActivityFeed } from "@/components/agents/ActivityFeed";
import { RecipientDemo } from "@/components/agents/RecipientDemo";
import { StatsPanel } from "@/components/agents/StatsPanel";
import { LiveChat } from "@/components/chat/LiveChat";
import { LiveClues } from "@/components/clues/LiveClues";
import { LiveShortlist } from "@/components/products/LiveShortlist";
import { Panel } from "@/components/ui/Panel";
import { unwrap } from "@/lib/live/result";

export function LiveRoom({ roomId }: { roomId: string }) {
  const id = roomId as Id<"rooms">;
  const room = unwrap(useQuery(api.rooms.getRoom, { roomId: id }));

  if (room.loading) return <main className="px-6 py-8 text-plum-soft">Loading room…</main>;
  if (room.error || !room.value)
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <Panel title="Room unavailable">
          <p className="text-sm">{room.error?.message ?? "Room not found."}</p>
        </Panel>
      </main>
    );

  const { room: r, participants } = room.value;
  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[1fr_1.4fr_1fr]">
      <header className="lg:col-span-3">
        <h1 className="text-2xl font-semibold text-plum">{r.title}</h1>
        <p className="text-sm text-plum-soft">
          For {r.recipientDisplayName} · {r.occasion} · {participants.length} in the room
        </p>
      </header>
      <section className="flex flex-col gap-6">
        <LiveChat roomId={id} participants={participants} />
      </section>
      <section className="flex flex-col gap-6">
        <ActivityFeed roomId={id} />
        <StatsPanel roomId={id} />
        <LiveShortlist roomId={id} />
      </section>
      <section className="flex flex-col gap-6">
        <LiveClues roomId={id} />
        <RecipientDemo roomId={id} isOrganizer={room.value.me.role === "organizer"} />
      </section>
    </main>
  );
}
