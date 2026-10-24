"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSession } from "@/components/providers/ConvexClientProvider";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import type { AppError, Result } from "@/lib/contracts";
import { newRequestKey, withId } from "@/lib/client";
import {
  chatQuery,
  myProposedCluesQuery,
  proposalQuery,
  publishedCluesQuery,
  recommendationsQuery,
  roomQuery,
} from "@/lib/mocks/queries";
import { MobileParticipantExperience } from "@/components/participant/MobileParticipantExperience";
import { guessSurface, phonePath, type RoomSurface } from "@/lib/room/surface";
import { RoomLayout } from "./RoomLayout";
import type { RoomActions, RoomData } from "./types";

export function RoomScreen({ roomId, surface = "stage" }: { roomId: string; surface?: RoomSurface }) {
  const convex = useConvex();
  const router = useRouter();
  // A phone opening the shared-stage URL is sent to its controller (and vice versa a laptop stays on the stage).
  useEffect(() => {
    if (surface === "stage" && guessSurface() === "phone") router.replace(phonePath(roomId));
  }, [surface, roomId, router]);
  return convex ? <LiveRoomGate roomId={roomId} surface={surface} /> : <PreviewRoom roomId={roomId} />;
}

/** No backend configured: render fixtures read-only and say so. */
function PreviewRoom({ roomId }: { roomId: string }) {
  const { recommendations, listings } = recommendationsQuery(roomId);
  const data: RoomData = {
    view: roomQuery(roomId),
    messages: chatQuery(roomId),
    myProposedClues: myProposedCluesQuery(),
    publishedClues: publishedCluesQuery(roomId),
    recommendations,
    listings,
    proposal: proposalQuery(roomId),
    votes: {},
    selection: null,
    evidence: [],
  };
  return <RoomLayout data={data} preview />;
}

// Convex document IDs are lowercase base32 strings; anything else can't be a room.
const ROOM_ID_SHAPE = /^[a-z0-9]{20,40}$/;

const NOT_A_ROOM: AppError = { code: "not_found", message: "That link doesn't point to a gift room." };

function LiveRoomGate({ roomId, surface }: { roomId: string; surface: RoomSurface }) {
  const session = useSession();
  if (!ROOM_ID_SHAPE.test(roomId)) return <RoomAccessError error={NOT_A_ROOM} />;
  if (session.status === "error") {
    return (
      <RoomMessage title="We couldn't connect to Unwrap">
        <button type="button" onClick={session.retry} className="btn-primary self-start">
          Try again
        </button>
      </RoomMessage>
    );
  }
  if (session.status !== "ready") return <RoomMessage title="Opening the room…" />;
  return (
    <ErrorBoundary fallback={<RoomMessage title="The room could not load"><p>A backend request failed. Reload to try again; this does not mean the room was deleted.</p></RoomMessage>}>
      <LiveRoom roomId={roomId as Id<"rooms">} surface={surface} />
    </ErrorBoundary>
  );
}

function value<T>(res: Result<T> | undefined, fallback: T): T {
  return res && res.ok ? res.value : fallback;
}

function LiveRoom({ roomId, surface }: { roomId: Id<"rooms">; surface: RoomSurface }) {
  const args = { roomId };
  const roomRes = useQuery(api.rooms.getRoom, args);
  const messagesRes = useQuery(api.messages.listMessages, args);
  const proposedRes = useQuery(api.clues.listMyProposedClues, args);
  const publishedRes = useQuery(api.clues.listPublishedClues, args);
  const evidenceRes = useQuery(api.clues.listMyEvidence, args);
  const recsRes = useQuery(api.research.research.listRecommendations, args);
  const proposalRes = useQuery(api.proposals.getProposal, args);
  const selectionRes = useQuery(api.proposals.getSelection, args);
  const votesRes = useQuery(api.votes.listVotes, args);
  const inviteRes = useQuery(api.rooms.getInvite, args);
  const activityRes = useQuery(api.agents.buyer.listActivity, args);
  const jobsRes = useQuery(api.jobs.listRoomJobs, args);

  const sendMessage = useMutation(api.messages.sendMessage);
  const requestTurn = useMutation(api.agents.buyer.requestTurn);
  const abandonQuestion = useMutation(api.agents.buyer.abandonQuestion);
  const retryJob = useMutation(api.agents.buyer.retryJob);
  const importEvidence = useMutation(api.clues.importEvidence);
  const extractClues = useMutation(api.agents.extract.extractClues);
  const deleteEvidence = useMutation(api.clues.deleteEvidence);
  const publishClue = useMutation(api.clues.publishClue);
  const rejectClue = useMutation(api.clues.rejectProposedClue);
  const editClue = useMutation(api.clues.editProposedClue);
  const withdrawClue = useMutation(api.clues.withdrawClue);
  const addManualClue = useMutation(api.clues.upsertManualPreference);
  const startResearch = useMutation(api.councilRoom.start);
  const resumeCouncil = useMutation(api.councilRoom.resume);
  const castVote = useMutation(api.votes.castVote);
  const clearVote = useMutation(api.votes.clearVote);
  const selectGift = useMutation(api.proposals.selectGift);
  const clearSelection = useMutation(api.proposals.clearSelection);
  const setLimit = useMutation(api.proposals.setContributionLimit);
  const approve = useMutation(api.proposals.approveRevision);
  const withdrawApproval = useMutation(api.proposals.withdrawApproval);

  const actions = useMemo<RoomActions>(
    () => ({
      sendMessage: (body, replyToSlot) =>
        sendMessage({ roomId, body, clientIdempotencyKey: newRequestKey(), ...(replyToSlot ? { replyToSlot } : {}) }),
      requestTurn: () => requestTurn({ roomId, mode: "auto" }),
      abandonQuestion: (slot) => abandonQuestion({ roomId, slot }),
      retryJob: (jobId) => retryJob({ jobId: jobId as Id<"agentJobs"> }),
      importEvidence: async (label, rawText) => {
        const imported = await importEvidence({ roomId, kind: "paste", label, rawText });
        if (!imported.ok) return imported;
        return extractClues({ sourceId: imported.value.source._id });
      },
      deleteEvidence: (sourceId) => deleteEvidence({ sourceId: sourceId as Id<"evidenceSources"> }),
      publishClue: (id) => publishClue({ proposedClueId: id as Id<"proposedClues"> }),
      rejectClue: (id) => rejectClue({ proposedClueId: id as Id<"proposedClues"> }),
      editClue: (id, text) => editClue({ proposedClueId: id as Id<"proposedClues">, text }),
      withdrawClue: (id) => withdrawClue({ publishedClueId: id as Id<"publishedClues"> }),
      addManualClue: (kind, text) => addManualClue({ roomId, kind, text }),
      startResearch: (clueIds) =>
        startResearch({ roomId, publishedClueIds: clueIds as Id<"publishedClues">[], idempotencyKey: newRequestKey() }),
      resumeCouncil: (runId) => resumeCouncil({ roomId, runId }),
      castVote: (listingId, vote) => castVote({ roomId, listingId: listingId as Id<"productListings">, value: vote }),
      clearVote: (listingId) => clearVote({ roomId, listingId: listingId as Id<"productListings"> }),
      selectGift: (listingId) => selectGift({ roomId, listingId: listingId as Id<"productListings"> }),
      clearSelection: () => clearSelection({ roomId }),
      setLimit: (amountMinor) => setLimit({ roomId, amountMinor }),
      approve: (revisionId) => approve({ revisionId: revisionId as Id<"proposalRevisions"> }),
      withdrawApproval: (revisionId) => withdrawApproval({ revisionId: revisionId as Id<"proposalRevisions"> }),
    }),
    [
      roomId, sendMessage, requestTurn, abandonQuestion, retryJob, importEvidence, extractClues, deleteEvidence,
      publishClue, rejectClue, editClue, withdrawClue, addManualClue, startResearch, resumeCouncil, castVote, clearVote,
      selectGift, clearSelection, setLimit, approve, withdrawApproval,
    ],
  );

  if (roomRes === undefined) return <RoomMessage title="Opening the room…" />;
  if (!roomRes.ok) return <RoomAccessError error={roomRes.error} />;
  const core = [messagesRes, proposedRes, publishedRes, evidenceRes, recsRes, proposalRes, selectionRes, votesRes];
  if (core.some((res) => res === undefined)) return <RoomMessage title="Opening the room…" />;

  const recs = value(recsRes, { recommendations: [], listings: [] });
  const selection = value(selectionRes, null);
  const data: RoomData = {
    view: roomRes.value,
    messages: value(messagesRes, []).map(withId),
    myProposedClues: value(proposedRes, []).map(withId),
    publishedClues: value(publishedRes, []).map(withId),
    recommendations: recs.recommendations,
    listings: recs.listings,
    proposal: value(proposalRes, { revision: null, shares: [], approvals: [], feasible: false }),
    votes: Object.fromEntries(value(votesRes, []).map((row) => [row.listingId, { tally: row.tally, myVote: row.myVote }])),
    selection: selection ? withId(selection) : null,
    evidence: value(evidenceRes, []).map(withId),
    invitePath: inviteRes?.ok ? inviteRes.value.joinPath : undefined,
    activity: activityRes?.ok ? activityRes.value : undefined,
    latestResearch: jobsRes?.ok ? (jobsRes.value.researchJobs[0] ?? null) : undefined,
  };
  const unavailable = <RoomSurfaceView surface={surface} data={{ ...data, councilUnavailable: true }} actions={actions} />;
  return (
    <ErrorBoundary fallback={unavailable}>
      <RoomWithCouncil roomId={roomId} data={data} actions={actions} surface={surface} />
    </ErrorBoundary>
  );
}

/** An optional council query must not turn a valid gift room into “not found”. */
function RoomWithCouncil({ roomId, data, actions, surface }: { roomId: Id<"rooms">; data: RoomData; actions: RoomActions; surface: RoomSurface }) {
  const result = useQuery(api.councilRoom.state, { roomId });
  return <RoomSurfaceView surface={surface} data={{ ...data, council: result?.ok ? result.value : undefined, councilUnavailable: result !== undefined && !result.ok }} actions={actions} />;
}

function RoomSurfaceView({ surface, data, actions }: { surface: RoomSurface; data: RoomData; actions: RoomActions }) {
  return surface === "phone" ? <MobileParticipantExperience data={data} actions={actions} /> : <RoomLayout data={data} actions={actions} />;
}

function RoomAccessError({ error }: { error: AppError }) {
  const notMember = error.code === "unauthorized";
  return (
    <RoomMessage title={notMember ? "You're not in this room yet" : "Room not found"}>
      <p className="text-[15px] text-dusk/70">
        {notMember ? "Ask a friend in the room for the invite link, then open it here." : error.message}
      </p>
      <Link href="/" className="btn-primary self-start">
        Back to Unwrap
      </Link>
    </RoomMessage>
  );
}

function RoomMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="min-h-dvh bg-paper px-6 py-16">
      <div className="paper-card mx-auto flex max-w-md flex-col gap-4 rounded-[22px] p-6">
        <h1 className="font-display text-[28px] leading-tight text-dusk" role="status">
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}
