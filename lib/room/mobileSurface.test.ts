import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileParticipantExperience } from "@/components/participant/MobileParticipantExperience";
import type { RoomActions, RoomData } from "@/components/room/types";
import { proposalQuery, roomQuery } from "@/lib/mocks/queries";
import { mockGiftBoxRevision } from "@/lib/mocks/fixtures";

vi.mock("convex/react", () => ({ useConvexConnectionState: () => ({ isWebSocketConnected: true }) }));
vi.mock("@/components/room/RoomAgentTools", () => ({ RoomAgentTools: () => null }));
vi.mock("@/components/giftTwin/GiftTwinInviteButton", () => ({ GiftTwinInviteButton: () => null }));

describe("phone and no-WebGL room surface", () => {
  it("retains the full box and withdrawal controls after everyone pledges", () => {
    const view = roomQuery("room");
    const revision = { ...mockGiftBoxRevision, status: "approved_pledged" as const };
    const proposal = proposalQuery("room");
    const data: RoomData = {
      view, proposal: { ...proposal, revision, approvals: proposal.approvals.map((a) => ({ ...a, revisionId: revision.id, status: "approved" })) },
      selection: { id: "selection", roomId: "room", quantity: 1, status: "active", selectedBy: view.me.id, selectedAt: 1,
        listingId: revision.items![0]!.listingId, listingSnapshot: revision.items![0]!.listingSnapshot, items: revision.items },
      messages: [], myProposedClues: [], publishedClues: [], recommendations: [], listings: [], votes: {}, evidence: [],
    };
    // Render-only fixture: no action is executed or backend contacted.
    const action = vi.fn();
    const actions = { setLimit: action, approve: action, withdrawApproval: action, clearSelection: action, removeGiftFromBox: action } as unknown as RoomActions;
    const html = renderToStaticMarkup(createElement(MobileParticipantExperience, { data, actions }));
    for (const item of revision.items!) expect(html).toContain(item.listingSnapshot.title);
    expect(html).toContain("Withdraw approval");
    expect(html).toContain("Your private limit");
    expect(html).toContain("Room sections");
    expect(html).toContain("Gift box");
    expect(html).toContain("Unwrap has not charged cards");
  });
});
