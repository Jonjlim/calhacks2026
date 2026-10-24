"use client";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { EvidenceImport } from "@/components/clues/EvidenceImport";
import { ProposedClueReview } from "@/components/clues/ProposedClueReview";
import { PublishedClueRail } from "@/components/clues/PublishedClueRail";
import { GiftMap } from "@/components/map/GiftMap";
import { ProductShortlist } from "@/components/products/ProductShortlist";
import { ProposalPanel } from "@/components/proposal/ProposalPanel";
import { ActivityFeed } from "@/components/agents/ActivityFeed";
import { ChatModeToggle } from "@/components/agents/ChatModeToggle";
import { RecipientDemo } from "@/components/agents/RecipientDemo";
import { StatsPanel } from "@/components/agents/StatsPanel";
import { MediaIntake } from "@/components/clues/MediaIntake";
import type { Id } from "@/convex/_generated/dataModel";
import { RoomHeader } from "./RoomHeader";
import type { RoomActions, RoomData } from "./types";

export function RoomLayout({ data, actions, preview = false }: { data: RoomData; actions?: RoomActions; preview?: boolean }) {
  const { room, participants, me } = data.view;
  const isOrganizer = me.role === "organizer";
  const latestExtract = data.activity?.jobs.find((job) => job.kind === "extract");
  // Agent panels query Convex directly, so they only render with a live backend.
  const liveRoomId = actions ? (room.id as Id<"rooms">) : null;

  return (
    <main className="min-h-dvh bg-ivory">
      {preview && (
        <p className="bg-gold/25 px-6 py-2 text-center text-[13px] text-dusk/80">
          Preview mode: the backend isn&apos;t connected, so this is sample data and nothing is saved.
        </p>
      )}
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[1fr_1.4fr_1fr]">
        <RoomHeader room={room} participants={participants} me={me} invitePath={data.invitePath} />

        <section className="flex flex-col gap-6">
          <ChatPanel messages={data.messages} participants={participants} me={me} activity={data.activity} actions={actions} />
          {liveRoomId && <ChatModeToggle roomId={liveRoomId} />}
        </section>

        <section className="flex flex-col gap-6">
          <ProductShortlist
            recommendations={data.recommendations}
            listings={data.listings}
            publishedClues={data.publishedClues}
            votes={data.votes}
            selection={data.selection}
            isOrganizer={isOrganizer}
            latestResearch={data.latestResearch}
            actions={actions}
          />
          <GiftMap recommendations={data.recommendations} listings={data.listings} publishedClues={data.publishedClues} />
          {liveRoomId && <ActivityFeed roomId={liveRoomId} />}
          {liveRoomId && <StatsPanel roomId={liveRoomId} />}
        </section>

        <section className="flex flex-col gap-6">
          <EvidenceImport
            evidence={data.evidence}
            latestJob={latestExtract}
            modelConfigured={data.activity?.capabilities.modelConfigured}
            actions={actions}
          />
          {liveRoomId && <MediaIntake roomId={liveRoomId} />}
          <ProposedClueReview clues={data.myProposedClues} actions={actions} />
          <PublishedClueRail clues={data.publishedClues} participants={participants} me={me} actions={actions} />
          {liveRoomId && <RecipientDemo roomId={liveRoomId} isOrganizer={isOrganizer} />}
          <ProposalPanel
            proposal={data.proposal}
            participants={participants}
            me={me}
            selection={data.selection}
            isOrganizer={isOrganizer}
            actions={actions}
          />
        </section>
      </div>
    </main>
  );
}
