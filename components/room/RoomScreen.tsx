"use client";

import { useAction, useConvex, useMutation, useQuery } from "convex/react";
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
import { RevealHarness } from "./RevealHarness";
import type { RoomActions, RoomData } from "./types";

export function RoomScreen({ roomId, surface = "stage" }: { roomId: string; surface?: RoomSurface }) {
  const convex = useConvex();
  const router = useRouter();
  // A phone opening the shared-stage URL is sent to its controller (and vice versa a laptop stays on the stage).
  useEffect(() => {
    if (surface === "stage" && guessSurface() === "phone") router.replace(phonePath(roomId));
  }, [surface, roomId, router]);
  if (process.env.NODE_ENV !== "production" && roomId === "dev-reveal") return <RevealHarness />;
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
  const trendsRes = useQuery(api.research.trendJobs.getDiscovery, args);

  const sendMessage = useMutation(api.messages.sendMessage);
  const requestTurn = useMutation(api.agents.buyer.requestTurn);
  const abandonQuestion = useMutation(api.agents.buyer.abandonQuestion);
  const retryJob = useMutation(api.agents.buyer.retryJob);
  const importEvidence = useMutation(api.clues.importEvidence);
  const extractClues = useMutation(api.agents.extract.extractClues);
  const genUploadUrl = useMutation(api.media.generateEvidenceUploadUrl);
  const importMedia = useMutation(api.media.importMediaEvidence);
  const sharePhotos = useMutation(api.photos.sharePhotos);
  const deletePhoto = useMutation(api.photos.deletePhoto);
  const deleteEvidence = useMutation(api.clues.deleteEvidence);
  const publishClue = useMutation(api.clues.publishClue);
  const rejectClue = useMutation(api.clues.rejectProposedClue);
  const editClue = useMutation(api.clues.editProposedClue);
  const withdrawClue = useMutation(api.clues.withdrawClue);
  const addManualClue = useMutation(api.clues.upsertManualPreference);
  const startResearch = useMutation(api.councilRoom.start);
  const resumeCouncil = useMutation(api.councilRoom.resume);
  const castVote = useMutation(api.votes.castVote);
  const setFeedback = useMutation(api.map.setFeedback);
  const clearVote = useMutation(api.votes.clearVote);
  const selectGift = useMutation(api.proposals.selectGift);
  const clearSelection = useMutation(api.proposals.clearSelection);
  const setLimit = useMutation(api.proposals.setContributionLimit);
  const approve = useMutation(api.proposals.approveRevision);
  const withdrawApproval = useMutation(api.proposals.withdrawApproval);
  const findTrends = useMutation(api.research.trendJobs.startDiscovery);
  const researchTrend = useMutation(api.research.research.startResearch);
  const passTrend = useMutation(api.research.trendJobs.setTrendPass);
  const setDirection = useMutation(api.mapSignals.setDirection);
  const suggestThemes = useAction(api.agents.themes.suggestThemes);
  const sharpen = useAction(api.agents.themes.sharpen);
  const answerSharpen = useMutation(api.agents.themes.answerSharpen);
  const dismissSharpen = useMutation(api.agents.themes.dismissSharpen);
  const moveCursor = useMutation(api.map.moveCursor);

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
      reactToGift: (listingId, kind) => setFeedback({ roomId, listingId: listingId as Id<"productListings">, kind }),
      clearVote: (listingId) => clearVote({ roomId, listingId: listingId as Id<"productListings"> }),
      selectGift: (listingId) => selectGift({ roomId, listingId: listingId as Id<"productListings"> }),
      clearSelection: () => clearSelection({ roomId }),
      setLimit: (amountMinor) => setLimit({ roomId, amountMinor }),
      approve: (revisionId) => approve({ revisionId: revisionId as Id<"proposalRevisions"> }),
      withdrawApproval: (revisionId) => withdrawApproval({ revisionId: revisionId as Id<"proposalRevisions"> }),
      findTrends: (clueId) => findTrends({ roomId, publishedClueId: clueId as Id<"publishedClues">, idempotencyKey: newRequestKey() }),
      researchTrend: (trendJobId, query, clueIds) => researchTrend({
        roomId, publishedClueIds: clueIds as Id<"publishedClues">[], trendJobId: trendJobId as Id<"trendJobs">,
        discoveryQuery: query, idempotencyKey: newRequestKey(),
      }),
      passTrend: (trendJobId, query, passed) => passTrend({ roomId, trendJobId: trendJobId as Id<"trendJobs">, query, passed }),
      setDirection: (targetKind, targetId, value) => setDirection({ roomId, targetKind, targetId, value }),
      suggestThemes: () => suggestThemes({ roomId }),
      sharpen: () => sharpen({ roomId }),
      answerSharpen: (sharpenId, option) => answerSharpen({ sharpenId: sharpenId as Id<"mapSharpens">, option }),
      dismissSharpen: (sharpenId) => dismissSharpen({ sharpenId: sharpenId as Id<"mapSharpens"> }),
      moveCursor: (x, z) => moveCursor({ roomId, x, y: z, space: "rings" }),
      // Two uploads per photo (D20): one shared with the room, one private copy that the extractor reads once and deletes.
      importPhotos: async (items) => {
        const send = async (blob: Blob) => {
          const url = await genUploadUrl({ roomId });
          if (!url.ok) return url;
          const res = await fetch(url.value.uploadUrl, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
          if (!res.ok) return { ok: false as const, error: { code: "provider_timeout" as const, message: `The photo didn’t upload (${res.status}). Try again.` } };
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          return { ok: true as const, value: storageId };
        };
        // Order matters: each claim binds to the caller's oldest unused upload grant, so the private
        // copies are uploaded and imported before the shared copies are uploaded and shared.
        const privateFiles: { storageId: Id<"_storage">; marker?: { x: number; y: number } }[] = [];
        for (const item of items) {
          const reading = await send(item.blob);
          if (!reading.ok) return reading;
          privateFiles.push({ storageId: reading.value, ...(item.marker ? { marker: item.marker } : {}) });
        }
        const imported = await importMedia({ roomId, kind: "photo", label: "Photos from the map", files: privateFiles });
        if (!imported.ok) return imported;
        const sharedFiles: { storageId: Id<"_storage"> }[] = [];
        for (const item of items) {
          const shared = await send(item.blob);
          if (!shared.ok) return shared;
          sharedFiles.push({ storageId: shared.value });
        }
        const posted = await sharePhotos({ roomId, files: sharedFiles, sourceId: imported.value.source._id });
        if (!posted.ok) return posted;
        const started = await extractClues({ sourceId: imported.value.source._id });
        if (!started.ok) return started;
        return { ok: true as const, value: { sourceId: imported.value.source._id as string } };
      },
      deletePhoto: (photoId) => deletePhoto({ photoId: photoId as Id<"roomPhotos"> }),
    }),
    [
      roomId, sendMessage, requestTurn, abandonQuestion, retryJob, importEvidence, extractClues, deleteEvidence,
      publishClue, rejectClue, editClue, withdrawClue, addManualClue, startResearch, resumeCouncil, castVote, setFeedback, clearVote,
      selectGift, clearSelection, setLimit, approve, withdrawApproval, setDirection, suggestThemes, sharpen, answerSharpen, dismissSharpen, moveCursor, genUploadUrl, importMedia, sharePhotos, deletePhoto, findTrends, researchTrend, passTrend,
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
    trends: trendsRes?.ok ? trendsRes.value : undefined,
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
  const withCouncil = { ...data, council: result?.ok ? result.value : undefined, councilUnavailable: result !== undefined && !result.ok };
  return (
    <ErrorBoundary fallback={<RoomSurfaceView surface={surface} data={withCouncil} actions={actions} />}>
      <RoomWithMap roomId={roomId} data={withCouncil} actions={actions} surface={surface} />
    </ErrorBoundary>
  );
}

/** Gift map extras: votes on memories and themes, council themes, the sharpen round, and live cursors. Optional by design. */
function RoomWithMap({ roomId, data, actions, surface }: { roomId: Id<"rooms">; data: RoomData; actions: RoomActions; surface: RoomSurface }) {
  const args = { roomId };
  const signals = useQuery(api.mapSignals.listSignals, args);
  const themes = useQuery(api.agents.themes.listThemes, args);
  const sharpen = useQuery(api.agents.themes.getSharpen, args);
  const cursors = useQuery(api.map.listCursors, args);
  const photos = useQuery(api.photos.listRoomPhotos, args);
  const extras: RoomData = {
    ...data,
    mapSignals: signals?.ok ? signals.value : undefined,
    mapThemes: themes?.ok ? themes.value : undefined,
    sharpen: sharpen?.ok ? sharpen.value : undefined,
    cursors: cursors?.ok ? cursors.value : undefined,
    roomPhotos: photos?.ok ? photos.value : undefined,
  };
  return <RoomSurfaceView surface={surface} data={extras} actions={actions} />;
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
