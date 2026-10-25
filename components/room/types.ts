import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type {
  ChatMessage,
  ClueKind,
  EvidenceSource,
  GiftSelection,
  MapDirection,
  ProductListing,
  ProposalView,
  ProposedClue,
  PublishedClue,
  Recommendation,
  Result,
  RoomView,
  SearchPoolSummary,
  TrendDiscoveryView,
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
  /** Latest sourced Google Trends suggestions for one memory, and listings found from them. */
  trends?: TrendDiscoveryView;
  /** Gift map extras (D19). Optional: the room still works if the deployment lacks them. */
  mapSignals?: OkValue<FunctionReturnType<typeof api.mapSignals.listSignals>>;
  mapThemes?: OkValue<FunctionReturnType<typeof api.agents.themes.listThemes>>;
  sharpen?: OkValue<FunctionReturnType<typeof api.agents.themes.getSharpen>>;
  cursors?: OkValue<FunctionReturnType<typeof api.map.listCursors>>;
  /** Photos members added on the map, shared with the whole room (D20). */
  roomPhotos?: OkValue<FunctionReturnType<typeof api.photos.listRoomPhotos>>;
  /** Council gift directions that combine memories (D23 trial). */
  directions?: MapDirection[];
  /** What each search that fed the map did, for "Why this gift?" (D23 trial). */
  searchPools?: SearchPoolSummary[];
  /** The room's decision log, for "How we got here" (D23 trial). */
  trail?: TrailEntry[];
}

export type TrailEntry = OkValue<FunctionReturnType<typeof api.trail.list>>[number];

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
  /** “She has it” (shared, publishes an ownership clue) or “too pricey for me” (personal). */
  reactToGift: Run<[listingId: string, kind: "owned" | "price"]>;
  clearVote: Run<[listingId: string]>;
  selectGift: Run<[listingId: string]>;
  clearSelection: Run;
  setLimit: Run<[amountMinor: number]>;
  approve: Run<[revisionId: string]>;
  withdrawApproval: Run<[revisionId: string]>;
  /** Look up related Google Trends searches for one published interest or wish. */
  findTrends?: Run<[publishedClueId: string]>;
  /** Research one sourced trend suggestion; the server refuses any query the trend job did not return. */
  researchTrend?: Run<[trendJobId: string, query: string, publishedClueIds: string[]]>;
  /** Shared, attributed "doesn't fit" on a trend idea; `false` takes it back. */
  passTrend?: Run<[trendJobId: string, query: string, passed: boolean]>;
  /** Pull a memory, theme or direction toward the present (1), push it away (−1), or take it back (0). On a trend cloud, 1 catches it and −1 lets it drift. */
  setDirection: Run<[targetKind: "clue" | "theme" | "direction" | "trend", targetId: string, value: 1 | -1 | 0]>;
  /** Ask the council to combine memories into gift directions (D23 trial). */
  proposeDirections?: Run;
  /** Search real gifts for one direction (D23 trial). */
  researchDirection?: Run<[directionId: string, publishedClueIds: string[]]>;
  suggestThemes: Run;
  sharpen: Run;
  answerSharpen: Run<[sharpenId: string, option: number]>;
  dismissSharpen: Run<[sharpenId: string]>;
  /** Adds 1–3 photos: a copy shared with the room, and a private copy read once for clues (with the uploader's tap on the recipient). */
  importPhotos: Run<[items: { blob: Blob; marker?: { x: number; y: number } }[]]>;
  deletePhoto: Run<[photoId: string]>;
  /** Shares this viewer's pointer on the map plane; fire and forget. */
  moveCursor: Run<[x: number, z: number]>;
}
