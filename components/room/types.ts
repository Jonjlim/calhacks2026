import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type {
  ChatMessage,
  ClueKind,
  EvidenceSource,
  GiftSelection,
  ProductListing,
  ProposalView,
  ProposedClue,
  PublishedClue,
  Recommendation,
  Result,
  RoomView,
  VoteValue,
} from "@/lib/contracts";

type OkValue<R> = Extract<R, { ok: true }> extends { value: infer V } ? V : never;

export type ActivityView = OkValue<FunctionReturnType<typeof api.agents.buyer.listActivity>>;
export type AgentJobRow = ActivityView["jobs"][number];
export type ResearchJobRow = OkValue<FunctionReturnType<typeof api.jobs.listRoomJobs>>["researchJobs"][number];

export interface VoteSummary {
  tally: Record<VoteValue, number>;
  myVote?: VoteValue;
}

/** Everything the room screen renders. Live mode fills it from Convex; preview mode from lib/mocks. */
export interface RoomData {
  view: RoomView;
  messages: ChatMessage[];
  myProposedClues: ProposedClue[];
  publishedClues: PublishedClue[];
  recommendations: Recommendation[];
  listings: ProductListing[];
  proposal: ProposalView;
  votes: Record<string, VoteSummary>;
  selection: GiftSelection | null;
  evidence: EvidenceSource[];
  invitePath?: string;
  activity?: ActivityView;
  latestResearch?: ResearchJobRow | null;
  councilUnavailable?: boolean;
  council?: OkValue<FunctionReturnType<typeof api.councilRoom.state>>;
}

type Run<A extends unknown[] = []> = (...args: A) => Promise<Result<unknown>>;

/** Backend calls available in live mode. Absent in preview mode, where controls are hidden. */
export interface RoomActions {
  sendMessage: Run<[body: string, replyToSlot?: string]>;
  requestTurn: Run;
  abandonQuestion: Run<[slot: string]>;
  retryJob: Run<[jobId: string]>;
  importEvidence: Run<[label: string, rawText: string]>;
  deleteEvidence: Run<[sourceId: string]>;
  publishClue: Run<[proposedClueId: string]>;
  rejectClue: Run<[proposedClueId: string]>;
  editClue: Run<[proposedClueId: string, text: string]>;
  withdrawClue: Run<[publishedClueId: string]>;
  addManualClue: Run<[kind: ClueKind, text: string]>;
  startResearch: Run<[publishedClueIds: string[]]>;
  resumeCouncil: Run<[runId: string]>;
  castVote: Run<[listingId: string, value: VoteValue]>;
  clearVote: Run<[listingId: string]>;
  selectGift: Run<[listingId: string]>;
  clearSelection: Run;
  setLimit: Run<[amountMinor: number]>;
  approve: Run<[revisionId: string]>;
  withdrawApproval: Run<[revisionId: string]>;
}
