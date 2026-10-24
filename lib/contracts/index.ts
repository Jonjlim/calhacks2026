/**
 * Shared contract types. Mirrors docs/CONTRACTS.md, which stays authoritative
 * for names and semantics. Change the doc first, then this file.
 *
 * IDs are opaque strings here so UI mocks and fixtures do not depend on Convex.
 * Convex functions use `Id<"table">` and are structurally compatible.
 */

export type Currency = "USD";

/** RC-014 local experiment; term-level evidence, not product popularity. */
export interface TrendContext {
  seedTerm: string;
  geo: "US";
  timeRange: "today 3-m";
  retrievedAt: number;
}

export type TrendObservation = TrendContext & {
  source: "google_trends";
  sourceUrl: string;
  query: string;
} & (
  | { kind: "top_search"; popularityIndex: number }
  | { kind: "rising_search"; growthPercent: number }
  | { kind: "breakout_search" }
);

// ---------- Errors / results ----------

export type AppErrorCode =
  | "unauthorized"
  | "not_found"
  | "invalid_revision"
  | "infeasible"
  | "stale_job"
  | "provider_timeout"
  | "validation_failed"
  | "refused"
  | "unknown";

export interface AppError {
  code: AppErrorCode;
  message: string; // safe for UI
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

// ---------- Rooms ----------

export interface Room {
  id: string;
  title: string;
  recipientDisplayName: string;
  occasion: string;
  deadlineAt?: number;
  currency: Currency;
  budgetMinor?: number;
  knowledgeRevision: number;
  currentRevisionId?: string;
  currentSelectionId?: string;
  latestMessageId?: string; // latest human chat message; part of the evaluate_thread inputHash
  inviteToken: string; // do not leak in agent snapshots
  createdBy: string;
  createdAt: number;
}

export type ParticipantRole = "organizer" | "contributor";

export interface Participant {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  role: ParticipantRole;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  authorKind: "participant" | "buyer_agent";
  participantId?: string;
  body: string;
  createdAt: number;
  clientIdempotencyKey: string;
  agentJobId?: string;
  responseAgentJobId?: string;
  replyToSlot?: string;
  citations?: AgentCitations;
}

export interface AgentCitations {
  listingIds: string[];
  publishedClueIds: string[];
  researchJobId?: string;
}

// ---------- Evidence and clues ----------

export type EvidenceKind = "paste" | "text_export";

export interface EvidenceSource {
  id: string;
  roomId: string;
  participantId: string;
  kind: EvidenceKind;
  label: string;
  sourceRevision: number;
  createdAt: number;
}

export interface PrivateMessage {
  id: string;
  sourceId: string;
  participantId: string;
  body: string;
  saidAt?: number;
  speakerHint?: string;
}

export type ClueKind =
  | "interest"
  | "explicit_wish"
  | "exclusion"
  | "ownership"
  | "timing"
  | "uncertain";

export type SpeakerAssumption = "recipient" | "other" | "unknown";

export type ProposedClueStatus =
  | "proposed"
  | "edited"
  | "rejected"
  | "published"
  | "source_withdrawn";

export interface ProposedClue {
  id: string;
  roomId: string;
  participantId: string;
  sourceId: string;
  sourceMessageIds: string[];
  kind: ClueKind;
  text: string;
  confidence: number;
  speakerAssumption: SpeakerAssumption;
  contradictsClueIds: string[];
  status: ProposedClueStatus;
  createdAt: number;
}

export type ClueSourceKind = "paste" | "import" | "chat" | "manual";

export interface PublishedClue {
  id: string;
  roomId: string;
  proposedClueId?: string;
  publisherId: string;
  kind: ClueKind;
  text: string;
  sourceKind: ClueSourceKind;
  sourceMessageIds: string[];
  excerpt?: string;
  status: "active" | "withdrawn" | "source_withdrawn";
  publishedAt: number;
}

// ---------- Recipient agent (P1-A) ----------

export type RecipientPreferenceCategory =
  | "interest"
  | "dislike"
  | "ownership"
  | "size"
  | "constraint";

export type RecipientQuestionType = "suitability" | "ownership" | "constraint";

export interface RecipientPreference {
  id: string;
  recipientProfileId: string;
  roomId?: string;
  category: RecipientPreferenceCategory;
  text: string;
  disclosable: boolean;
  authorized: boolean;
  createdAt: number;
}

export interface RecipientGrant {
  recipientProfileId: string;
  category: RecipientPreferenceCategory;
  allowedQuestionTypes: RecipientQuestionType[];
}

export interface AgentQuery {
  id: string;
  roomId: string;
  type: RecipientQuestionType;
  subject: {
    kind: "category" | "product";
    label: string;
    listingId?: string;
  };
  askedByJobId: string;
}

export interface AgentReply {
  queryId: string;
  status: "answered" | "unknown" | "refused";
  suitability?: "yes" | "no" | "mixed";
  guidance?: string;
  usedPreferenceIds: string[];
  policy: { allowed: boolean; reason?: string };
}

// ---------- Agent decisions ----------

export type AgentIntent =
  | "listen"
  | "clarify"
  | "extract"
  | "search"
  | "recommend"
  | "query_recipient"
  | "wait";

export interface AgentDecision {
  jobId: string;
  roomId: string;
  intent: AgentIntent;
  rationale: string;
  chatMessage?: string;
  clarifySlot?: string;
  extractSourceId?: string;
  needsFollowup: boolean;
  createdAt: number;
  searchBrief?: SearchBrief;
  recipientQuery?: Pick<AgentQuery, "type" | "subject">;
  citations?: { listingIds: string[]; publishedClueIds: string[] };
}

export interface AgentEvent {
  id: string;
  roomId: string;
  jobId: string;
  actor: "buyer" | "extractor" | "research_planner" | "recipient";
  kind: "started" | "question" | "handoff" | "completed" | "failed" | "stale";
  summary: string;
  createdAt: number;
  citations?: AgentCitations;
}

// ---------- Products ----------

export type ListingSource = "apify" | "shopping_api" | "manual_fixture";

export interface ProductListing {
  id: string;
  roomId: string;
  jobId: string;
  source: ListingSource;
  sourceUrl: string;
  title: string;
  variant?: string;
  currency: Currency;
  priceMinor?: number;
  priceStatus: "observed" | "unknown";
  availability: "in_stock" | "limited" | "unavailable" | "unknown";
  shippingMinor?: number;
  shippingStatus: "observed" | "unresolved" | "unknown";
  imageUrl?: string;
  sellerName?: string;
  retrievedAt: number;
  status: "active" | "invalid" | "stale";
}

/** Derived client presentation; not persisted in Convex. */
export interface PriceFreshness {
  kind: "recent" | "aging" | "stale" | "unknown" | "unavailable";
  label: string;
  needsRefresh: boolean;
  observedAt?: number;
  ageMs?: number;
  nextChangeAt?: number;
}

export interface Recommendation {
  id: string;
  roomId: string;
  listingId: string;
  publishedClueIds: string[];
  score: number;
  personalRelevance: number;
  budgetFit: number;
  trendSignal: number; // 0 unless sourced
  explanation: string;
  createdAt: number;
}

// ---------- Selection, contributions, proposals ----------

export interface GiftSelection {
  id: string;
  roomId: string;
  listingId: string;
  quantity: 1;
  listingSnapshot: Pick<
    ProductListing,
    "title" | "sourceUrl" | "priceMinor" | "priceStatus" | "retrievedAt"
  >;
  status: "active" | "cleared";
  selectedBy: string;
  selectedAt: number;
}

export interface ContributionLimit {
  participantId: string;
  roomId: string;
  amountMinor: number;
  updatedAt: number;
}

export interface AllocationShare {
  participantId: string;
  amountMinor: number;
}

export type ProposalStatus =
  | "draft"
  | "awaiting_approval"
  | "approved_pledged"
  | "infeasible"
  | "superseded"
  // P1-B only:
  | "authorizing"
  | "ready_to_capture"
  | "capturing"
  | "test_funded"
  | "blocked"
  | "recovery_pending"
  | "canceled";

export interface ProposalRevision {
  id: string;
  roomId: string;
  selectionId: string;
  listingId: string;
  quantity: 1;
  payableTotalMinor: number;
  currency: Currency;
  shares: AllocationShare[];
  conditions: string[];
  status: ProposalStatus;
  createdAt: number;
  expiresAt?: number;
}

export interface Approval {
  id: string;
  roomId: string;
  revisionId: string;
  participantId: string;
  status: "pending" | "approved" | "invalidated" | "withdrawn";
  updatedAt: number;
}

export type VoteValue = "up" | "down" | "flag_duplicate";

// ---------- Payments (P1-B) ----------

export interface PaymentAttempt {
  id: string;
  roomId: string;
  revisionId: string;
  participantId: string;
  provider: "stripe_test";
  providerObjectId?: string;
  idempotencyKey: string;
  status:
    | "not_started"
    | "authorization_pending"
    | "authorized"
    | "authorization_failed"
    | "capture_pending"
    | "captured"
    | "cancellation_pending"
    | "canceled"
    | "refund_pending"
    | "refunded"
    | "action_required"
    | "uncertain";
  createdAt: number;
}

// ---------- Jobs ----------

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "stale"
  | "canceled"
  | "uncertain";

export interface SearchBrief {
  roomId: string;
  knowledgeRevision: number;
  queryTerms: string[];
  mustExclude: string[];
  budgetMinor?: number;
  occasion?: string;
  listingLimit: number;
}

export interface AgentJob {
  id: string;
  roomId: string;
  kind: "evaluate_thread" | "extract" | "recipient_query";
  status: JobStatus;
  inputHash: string;
  inputVersion?: string;
  idempotencyKey: string;
  attempt: number;
  lastError?: string;
  createdAt: number;
  actingParticipantId?: string;
  sourceId?: string;
  sourceRevision?: number;
  latestMessageId?: string;
  knowledgeRevision?: number;
  mode?: "quiet" | "auto";
  trigger?: "human" | "research_completed" | "knowledge_changed";
  researchJobId?: string;
  startedAt?: number;
  finishedAt?: number;
  modelUsage?: AgentModelUsage;
}

export interface AgentModelUsage {
  calls: number;
  reportedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

export interface ResearchJob {
  id: string;
  roomId: string;
  knowledgeRevision: number;
  actingParticipantId?: string;
  originatingAgentJobId?: string;
  latestMessageId?: string;
  continuationAgentJobId?: string;
  brief: SearchBrief;
  status: JobStatus;
  inputHash: string;
  idempotencyKey: string;
  attempt: number;
  lastError?: string;
  createdAt: number;
}

export interface AskedSlot {
  id: string;
  roomId: string;
  slot: string;
  messageId?: string;
  status: "open" | "answered" | "abandoned";
  askedAt: number;
}

// ---------- Query view shapes (see "Mock guidance" in CONTRACTS.md) ----------

export interface RoomView {
  room: Room;
  participants: Participant[];
  me: Participant;
}

export interface RecommendationsView {
  recommendations: Recommendation[];
  listings: ProductListing[];
}

export interface ProposalView {
  revision: ProposalRevision | null;
  shares: AllocationShare[];
  approvals: Approval[];
  feasible: boolean;
  myLimit?: ContributionLimit;
}
