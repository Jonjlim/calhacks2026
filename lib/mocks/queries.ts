/**
 * In-memory stand-ins for the Convex queries listed under "Mock guidance" in
 * docs/CONTRACTS.md. Swap each for `useQuery(api....)` once the backend lands.
 */
import type {
  ChatMessage,
  ProposalView,
  ProposedClue,
  PublishedClue,
  RecommendationsView,
  RoomView,
} from "@/lib/contracts";
import {
  mockApprovals,
  mockListings,
  mockMessages,
  mockParticipants,
  mockProposedClues,
  mockPublishedClues,
  mockRecommendations,
  mockRevision,
  mockRoom,
} from "./fixtures";

export function roomQuery(roomId: string): RoomView {
  const me = mockParticipants[0]!;
  return { room: { ...mockRoom, id: roomId }, participants: mockParticipants, me };
}

export function chatQuery(_roomId: string): ChatMessage[] {
  return mockMessages;
}

export function myProposedCluesQuery(): ProposedClue[] {
  return mockProposedClues;
}

export function publishedCluesQuery(_roomId: string): PublishedClue[] {
  return mockPublishedClues;
}

export function recommendationsQuery(_roomId: string): RecommendationsView {
  return { recommendations: mockRecommendations, listings: mockListings };
}

export function proposalQuery(_roomId: string): ProposalView {
  return {
    revision: mockRevision,
    shares: mockRevision.shares,
    approvals: mockApprovals,
    feasible: true,
    myLimit: {
      participantId: "p_alex",
      roomId: mockRoom.id,
      amountMinor: 6_000,
      updatedAt: mockRevision.createdAt,
    },
  };
}
