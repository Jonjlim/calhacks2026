"use client";

import { ActivityFeed } from "@/components/agents/ActivityFeed";
import { ChatModeToggle } from "@/components/agents/ChatModeToggle";
import { RecipientDemo } from "@/components/agents/RecipientDemo";
import { StatsPanel } from "@/components/agents/StatsPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { EvidenceImport } from "@/components/clues/EvidenceImport";
import { MediaIntake } from "@/components/clues/MediaIntake";
import { ProposedClueReview } from "@/components/clues/ProposedClueReview";
import { ShareWorldPanel } from "@/components/worlds/ShareWorldPanel";
import type { Id } from "@/convex/_generated/dataModel";
import type { RoomActions, RoomData } from "./types";

/** Same private-evidence/agent flow, reachable from stage tools and the phone. */
export function RoomAgentTools({ data, actions }: { data: RoomData; actions?: RoomActions }) {
  const { room, participants, me } = data.view;
  const roomId = room.id as Id<"rooms">;
  return <>
    <details className="paper-card rounded-[18px] p-4">
      <summary className="cursor-pointer font-display text-xl">Bring in a conversation or photo</summary>
      <div className="mt-3 flex flex-col gap-4">
        <EvidenceImport evidence={data.evidence} latestJob={data.activity?.jobs.find(job => job.kind === "extract")} modelConfigured={data.activity?.capabilities.modelConfigured} actions={actions} />
        {actions && <MediaIntake roomId={roomId} />}
        <ProposedClueReview clues={data.myProposedClues} actions={actions} />
      </div>
    </details>
    <ChatPanel messages={data.messages} participants={participants} me={me} activity={data.activity} actions={actions} />
    {actions && <>
      <ChatModeToggle roomId={roomId} />
      <ActivityFeed roomId={roomId} />
      <StatsPanel roomId={roomId} />
      <RecipientDemo roomId={roomId} isOrganizer={me.role === "organizer"} />
      {me.role === "organizer" && <ShareWorldPanel roomId={roomId} />}
    </>}
  </>;
}
