/**
 * Shared contract types. Mirrors docs/CONTRACTS.md, which stays authoritative
 * for names and semantics. Change the doc first, then this file.
 *
 * IDs are opaque strings here so UI mocks and fixtures do not depend on Convex.
 * Convex functions use `Id<"table">` and are structurally compatible.
 */

export type Currency = "USD";

export interface FashionSampleContext {
  seedTerm: string;
  windowStart: number;
  windowEnd: number;
  retrievedAt: number;
}

export interface TikTokFashionPost {
  source: "tiktok";
  postId: string;
  sourceUrl: string;
  creatorKey: string;
  caption: string;
  hashtags: string[];
  publishedAt: number;
  retrievedAt: number;
  views?: number;
  likes?: number;
  shares?: number;
  advertising: "flagged" | "not_flagged" | "unknown";
}

export interface FashionDiscovery {
  kind: "sampled_style";
  garment: string;
  searchQuery: string;
  postUrls: string[];
  distinctCreators: number;
  label: string;
}

export interface FashionDiscoverySample {
  mode: "live_sample";
  label: string;
  actor: string;
  build: string;
  providerRunId: string;
  context: FashionSampleContext;
  supportingPublishedClueIds: string[];
  directions: FashionDiscovery[];
  evidenceSummary?: { returnedRows: number; validRecentPosts: number; excludedAdvertisingPosts: number };
}
export interface FashionDiscoveryJobView {
  id: string;
  status: JobStatus;
  createdAt: number;
  lastError?: string;
  canResume: boolean;
}
export interface FashionDiscoveryView {
  latestJob: FashionDiscoveryJobView | null;
  sample: (FashionDiscoverySample & { jobId: string }) | null;
}

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

/** Live Google Trends discovery (Dev 4). Search interest, not sales or product popularity. */
export interface TrendSignal {
  kind: "top_search" | "rising_search" | "breakout_search";
  popularityIndex?: number;
  growthPercent?: number;
}
export interface TrendSuggestion {
  query: string;
  sourceUrl: string;
  signals: TrendSignal[];
}
export interface TrendDiscoverySample {
  mode: "live_sample";
  label: string;
  actor: string;
  build: string;
  providerRunId: string;
  context: TrendContext;
  publishedClueId: string;
  suggestions: TrendSuggestion[];
  /** How suggestions were judged buyable: model classification (with news floor) or the word filter fallback. */
  screen?: "model" | "words";
  evidenceSummary: { returnedRows: number; observations: number };
}
/** latestJob reuses the discovery job view shape shared with fashion discovery. */
export interface TrendDiscoveryView {
  latestJob: FashionDiscoveryJobView | null;
  sample: (TrendDiscoverySample & { jobId: string }) | null;
  /** Newest usable sample per memory (at most 6), newest first; `sample` is the first. */
  samples?: (TrendDiscoverySample & { jobId: string })[];
  /** Shared "doesn't fit" counts. A pass fades an idea for everyone; it never hides or deletes it. */
  passes?: TrendPassSummary[];
  /** Active listings found by research that shopped one of the current sample's suggestions. */
  listingLinks?: TrendListingLink[];
}
/** Search context only: the listing was found while researching this trend query, not proven trending itself. */
/** Sourced trend ideas the buyer agent may mention or shop. Passed ideas are left out. */
export interface TrendAgentContext {
  mode: "live_sample";
  label: string;
  ideas: { publishedClueId: string; query: string; signal: string; retrievedAt: number }[];
}
export interface TrendPassSummary {
  trendJobId: string;
  query: string;
  count: number;
  mine: boolean;
  passerNames: string[];
}
export interface TrendListingLink {
  listingId: string;
  trendJobId: string;
  query: string;
  sourceUrl: string;
}
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
  /** Author deleted the message; body is "" and the row is a tombstone. */
  deletedAt?: number;
}

export interface AgentCitations {
  listingIds: string[];
  publishedClueIds: string[];
  researchJobId?: string;
}

// ---------- Evidence and clues ----------

export type EvidenceKind = "paste" | "text_export" | "photo" | "screenshot";

export interface EvidenceSource {
  id: string;
  roomId: string;
  participantId: string;
  kind: EvidenceKind;
  label: string;
  sourceRevision: number;
  /** photo / screenshot only. The uploaded file is deleted once read. */
  media?: {
    count: number;
    recipientMarkers?: { x: number; y: number }[];
    status: "uploaded" | "read" | "failed" | "deleted";
  };
  createdAt: number;
}

export interface PrivateMessage {
  id: string;
  sourceId: string;
  participantId: string;
  body: string;
  saidAt?: number;
  speakerHint?: string;
  /** Which uploaded file (0-based) the row came from; photo and screenshot sources only. */
  mediaIndex?: number;
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

export type ClueSourceKind = "paste" | "import" | "chat" | "manual" | "photo" | "screenshot";

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
  | "wait"
  | "reply";

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
  /** The one search that found this listing. Provenance only: never a clue match or citation. */
  foundBy?: SearchOrigin;
}

/**
 * Where a research pool's single search came from. `memory`: a published clue's
 * search phrase. `trend`: a chosen Google Trends suggestion for that clue.
 * `discovery`: any other sourced direction (for example a public style sample).
 */
export interface SearchOrigin {
  query: string;
  source: "memory" | "trend" | "discovery" | "direction";
  publishedClueId?: string;
  /** Set when `source` is "direction" (D23 trial). */
  directionId?: string;
}

/** What one search did, for "Why this gift?" (D23 trial). Counts only; no listing data. */
export interface SearchPoolSummary {
  jobId: string;
  directionId?: string;
  query: string;
  found: number;
  removedByClues: number;
  foldedDuplicates: number;
  shown: number;
}

/** A council suggestion that combines memories into one gift direction (D23 trial). Never room knowledge. */
export interface MapDirection {
  id: string;
  label: string;
  query: string;
  why: string;
  clueIds: string[];
  trend?: { trendJobId: string; query: string };
  broad: boolean;
  source: "agent" | "preset";
  stale: boolean;
  researched: boolean;
}

// ---------- Selection, contributions, proposals ----------

/** One observed product in a bounded gift box; no merchant order is implied. */
export interface GiftBoxItem {
  listingId: string;
  quantity: 1;
  listingSnapshot: Pick<ProductListing,
    "title" | "sourceUrl" | "priceMinor" | "priceStatus" | "retrievedAt"
    | "currency" | "shippingMinor" | "shippingStatus" | "imageUrl">;
}

export interface GiftSelection {
  /** Complete box when present. Legacy fields describe the first item only. */
  items?: GiftBoxItem[];
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
  /** Frozen full box. Legacy rows without this field contain one gift. */
  items?: GiftBoxItem[];
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

export type PaymentAttemptStatus =
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

export interface PaymentAttempt {
  id: string;
  roomId: string;
  revisionId: string;
  participantId: string;
  provider: "stripe_test";
  providerObjectId?: string;
  idempotencyKey: string;
  /** Frozen share from the revision, integer cents. */
  amountMinor: number;
  currency: Currency;
  status: PaymentAttemptStatus;
  /** UI-safe message from the adapter; never raw provider payloads. */
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

/** Owner view of their own attempt. Provider IDs and idempotency keys stay server-side. */
export type MyPaymentAttemptView = Pick<
  PaymentAttempt,
  "id" | "revisionId" | "status" | "amountMinor" | "currency" | "lastError" | "createdAt" | "updatedAt"
>;

/** Merchant fulfillment is not implemented; never derive it from payment status. */
export type MerchantOrderStatus = "not_implemented";

export interface PaymentStatusView {
  enabled: boolean;
  mode: "stripe_test";
  revisionId: string | null;
  /** The current revision's status (group payment status during P1-B). */
  groupStatus: ProposalStatus | null;
  /** True once capture has started; gift/cap/selection edits are refused. */
  frozen: boolean;
  payerCount: number;
  authorizedCount: number;
  capturedCount: number;
  /** Payers whose latest attempt failed, needs action, or is uncertain. */
  attentionCount: number;
  myAttempt: MyPaymentAttemptView | null;
  merchantOrder: { status: MerchantOrderStatus };
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
  /** One row per search that fed the map (D23 trial). */
  searchPools?: SearchPoolSummary[];
}

export interface ProposalView {
  revision: ProposalRevision | null;
  shares: AllocationShare[];
  approvals: Approval[];
  feasible: boolean;
  myLimit?: ContributionLimit;
}

/** Bounded source context for the buyer; never a published recipient preference. */
export interface FashionAgentContext {
  mode: "recorded_sample";
  label: string;
  context: FashionSampleContext;
  supportingPublishedClueIds: string[];
  directions: FashionDiscovery[];
}

// Server-only Stripe transport DTOs; never payment authorization or browser success signals.
export interface StripeCheckoutInput {
  roomId: string;
  revisionId: string;
  participantId: string;
  attemptId: string;
  amountMinor: number;
  currency: "USD";
  mode: "authorize" | "collect";
  idempotencyKey: string;
}
export type StripePaymentBinding = Pick<StripeCheckoutInput, "roomId" | "revisionId" | "participantId" | "attemptId">;
export interface StripeTestSession {
  id: string;
  binding: StripePaymentBinding;
  checkoutUrl?: string;
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  paymentIntentId?: string;
  amountMinor: number;
  currency: "USD";
}
export interface StripeTestIntent {
  id: string;
  binding: StripePaymentBinding;
  status: "requires_payment_method" | "requires_confirmation" | "requires_action" | "processing" | "requires_capture" | "canceled" | "succeeded";
  amountMinor: number;
  amountCapturableMinor: number;
  amountReceivedMinor: number;
  currency: "USD";
  captureMethod: "automatic" | "automatic_async" | "manual";
}
export interface StripeTestRefund {
  id: string;
  paymentIntentId: string;
  amountMinor: number;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
}
export interface StripeTestEvent {
  id: string;
  type: string;
  objectId: string;
  objectType: string;
}
export type StripeAdapterResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "failed" | "uncertain"; message: string };

/** Server-only durable worker port. Implementations enforce human/revision policy in Convex. */
export interface OrganizerCheckoutClaim {
  claimId: string;
  input: StripeCheckoutInput;
  checkoutSessionId?: string;
}
export interface OrganizerCheckoutStore {
  claim(): Promise<StripeAdapterResult<OrganizerCheckoutClaim | null>>;
  settle(claimId: string, result: StripeAdapterResult<StripeTestSession>): Promise<boolean>;
}

/** Server-only RC-011: the store authorizes exactly one contributor's frozen share. */
export type ContributorCheckoutClaim = OrganizerCheckoutClaim & {
  input: StripeCheckoutInput & { mode: "authorize" };
};
export interface ContributorCheckoutStore {
  claim(): Promise<StripeAdapterResult<ContributorCheckoutClaim | null>>;
  settle(claimId: string, result: StripeAdapterResult<StripeTestSession>): Promise<boolean>;
}

export interface StripePaymentExpectation {
  binding: StripePaymentBinding;
  amountMinor: number;
  mode: "authorize" | "collect";
  paymentIntentId?: string;
}
export interface StripePaymentObservation {
  status: PaymentAttempt["status"];
  paymentIntentId?: string;
  checkoutSessionId?: string;
  capturedMinor: number;
  refundedMinor: number;
  reason: string;
}

export interface StripePaymentReadInput {
  expected: StripePaymentExpectation;
  checkoutSessionId?: string;
  paymentIntentId?: string;
  refundIds?: string[];
}


/** Explicit demo-only progress; never actual payment or merchant-order state. */
export interface ContributionSimulationView {
  mode: "simulation";
  revisionId: string | null;
  status: "no_proposal" | "waiting_for_approvals" | "ready" | "collecting" | "complete" | "wrapped" | "unavailable";
  payerCount: number;
  completedCount: number;
  myShareMinor: number;
  myCompleted: boolean;
  canSimulate: boolean;
  canWrap: boolean;
}


/** MAP-011 consumes the proposed ring contract; theme persistence remains Dev 2/3. */
export interface MapTheme {
  id: string;
  roomId: string;
  label: string;
  clueIds: string[];
  status: "suggested" | "accepted" | "dismissed";
  source: "agent" | "member";
  createdBy?: string;
  knowledgeRevision: number;
  updatedAt: number;
}


/** Room-visible group steering; no ballot publishes a recipient preference. */
export interface QuestionPollView {
  questionId: string;
  counts: number[];
  votedCount: number;
  memberCount: number;
  myOption: number | null;
  leader: number | null;
  tied: boolean;
  stale: boolean;
  open: boolean;
  canFinish: boolean;
}
