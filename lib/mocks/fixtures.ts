/**
 * Synthetic fixtures for UI work before Convex is wired. Shapes follow
 * lib/contracts. Listings are `manual_fixture` and must be labeled as such in
 * the UI; never promote them to a live source.
 */
import type {
  Approval,
  ChatMessage,
  Participant,
  ProductListing,
  ProposalRevision,
  ProposedClue,
  PublishedClue,
  Recommendation,
  Room,
} from "@/lib/contracts";

const T0 = Date.UTC(2026, 9, 24, 18, 0, 0);

export const mockRoom: Room = {
  id: "room_demo",
  title: "Maya's birthday",
  recipientDisplayName: "Maya",
  occasion: "birthday",
  deadlineAt: Date.UTC(2026, 10, 2),
  currency: "USD",
  budgetMinor: 12_000,
  knowledgeRevision: 2,
  currentRevisionId: "rev_1",
  currentSelectionId: "sel_1",
  inviteToken: "demo-invite-token",
  createdBy: "user_alex",
  createdAt: T0,
};

export const mockParticipants: Participant[] = [
  {
    id: "p_alex",
    roomId: mockRoom.id,
    userId: "user_alex",
    displayName: "Alex",
    role: "organizer",
    joinedAt: T0,
  },
  {
    id: "p_jordan",
    roomId: mockRoom.id,
    userId: "user_jordan",
    displayName: "Jordan",
    role: "contributor",
    joinedAt: T0 + 60_000,
  },
];

export const mockMessages: ChatMessage[] = [
  {
    id: "m1",
    roomId: mockRoom.id,
    authorKind: "participant",
    participantId: "p_alex",
    body: "Maya keeps talking about pottery lately.",
    createdAt: T0 + 120_000,
    clientIdempotencyKey: "k1",
  },
  {
    id: "m2",
    roomId: mockRoom.id,
    authorKind: "participant",
    participantId: "p_jordan",
    body: "She already bought a starter kit though.",
    createdAt: T0 + 180_000,
    clientIdempotencyKey: "k2",
  },
  {
    id: "m3",
    roomId: mockRoom.id,
    authorKind: "buyer_agent",
    body: "Should we look for a class or upgraded tools rather than another kit?",
    createdAt: T0 + 200_000,
    clientIdempotencyKey: "k3",
  },
];

export const mockProposedClues: ProposedClue[] = [
  {
    id: "pc1",
    roomId: mockRoom.id,
    participantId: "p_alex",
    sourceId: "src1",
    sourceMessageIds: ["pm1"],
    kind: "explicit_wish",
    text: "Wants to take a wheel-throwing class this year",
    confidence: 0.82,
    speakerAssumption: "recipient",
    contradictsClueIds: [],
    status: "proposed",
    createdAt: T0 + 240_000,
  },
];

export const mockPublishedClues: PublishedClue[] = [
  {
    id: "c1",
    roomId: mockRoom.id,
    publisherId: "p_alex",
    kind: "interest",
    text: "Interested in pottery",
    sourceKind: "paste",
    sourceMessageIds: ["pm0"],
    status: "active",
    publishedAt: T0 + 150_000,
  },
  {
    id: "c2",
    roomId: mockRoom.id,
    publisherId: "p_jordan",
    kind: "ownership",
    text: "Already owns a pottery starter kit",
    sourceKind: "manual",
    sourceMessageIds: [],
    status: "active",
    publishedAt: T0 + 190_000,
  },
];

export const mockListings: ProductListing[] = [
  {
    id: "l1",
    roomId: mockRoom.id,
    jobId: "rj1",
    source: "manual_fixture",
    sourceUrl: "https://example.com/fixture/wheel-class",
    title: "Intro wheel-throwing class (4 sessions)",
    currency: "USD",
    priceMinor: 9_500,
    priceStatus: "observed",
    availability: "in_stock",
    shippingStatus: "unknown",
    retrievedAt: T0 + 300_000,
    status: "active",
  },
  {
    id: "l2",
    roomId: mockRoom.id,
    jobId: "rj1",
    source: "manual_fixture",
    sourceUrl: "https://example.com/fixture/trimming-tools",
    title: "Pro trimming tool set",
    currency: "USD",
    priceMinor: 3_800,
    priceStatus: "observed",
    availability: "limited",
    shippingMinor: 599,
    shippingStatus: "observed",
    retrievedAt: T0 + 300_000,
    status: "active",
  },
  {
    id: "l3",
    roomId: mockRoom.id,
    jobId: "rj1",
    source: "manual_fixture",
    sourceUrl: "https://example.com/fixture/glaze-sampler",
    title: "Glaze sampler pack",
    currency: "USD",
    priceStatus: "unknown",
    availability: "unknown",
    shippingStatus: "unresolved",
    retrievedAt: T0 + 300_000,
    status: "active",
  },
];

export const mockRecommendations: Recommendation[] = [
  {
    id: "r1",
    roomId: mockRoom.id,
    listingId: "l1",
    publishedClueIds: ["c1", "c2"],
    score: 0.86,
    personalRelevance: 0.95,
    budgetFit: 0.8,
    trendSignal: 0,
    explanation: "Builds on her pottery interest without duplicating the kit she owns.",
    createdAt: T0 + 310_000,
  },
  {
    id: "r2",
    roomId: mockRoom.id,
    listingId: "l2",
    publishedClueIds: ["c1"],
    score: 0.71,
    personalRelevance: 0.7,
    budgetFit: 1,
    trendSignal: 0,
    explanation: "An upgrade from starter-kit tools.",
    createdAt: T0 + 310_000,
  },
];

export const mockRevision: ProposalRevision = {
  id: "rev_1",
  roomId: mockRoom.id,
  selectionId: "sel_1",
  listingId: "l1",
  quantity: 1,
  payableTotalMinor: 9_500,
  currency: "USD",
  shares: [
    { participantId: "p_alex", amountMinor: 4_750 },
    { participantId: "p_jordan", amountMinor: 4_750 },
  ],
  conditions: ["Shipping unknown"],
  status: "awaiting_approval",
  createdAt: T0 + 400_000,
};

export const mockApprovals: Approval[] = [
  {
    id: "a1",
    roomId: mockRoom.id,
    revisionId: "rev_1",
    participantId: "p_alex",
    status: "approved",
    updatedAt: T0 + 410_000,
  },
  {
    id: "a2",
    roomId: mockRoom.id,
    revisionId: "rev_1",
    participantId: "p_jordan",
    status: "pending",
    updatedAt: T0 + 400_000,
  },
];
