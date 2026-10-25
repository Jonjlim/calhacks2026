import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalPanel } from "@/components/proposal/ProposalPanel";
import type { GiftSelection } from "@/lib/contracts";
import type { ResearchJobRow } from "@/components/room/types";
import { proposalQuery, roomQuery } from "@/lib/mocks/queries";
import { addToGiftBox, giftIsInBox } from "./giftBox";
import { relevantResearchJob } from "./researchActivity";
import { roomCouncilMembers } from "./councilActivity";

const snapshot = (title: string) => ({ title, sourceUrl: `https://example.com/${title}`, retrievedAt: 1, priceStatus: "observed" as const, priceMinor: 1000, currency: "USD" as const, shippingStatus: "unknown" as const });
const selection: GiftSelection = {
  id: "selection", roomId: "room", quantity: 1, listingId: "first", selectedBy: "organizer", selectedAt: 1, status: "active",
  listingSnapshot: snapshot("First gift"),
  items: ["first", "second"].map((listingId, i) => ({ listingId, quantity: 1 as const, listingSnapshot: snapshot(i ? "Second gift" : "First gift") })),
};
const job = (status: ResearchJobRow["status"], createdAt = 100): ResearchJobRow => ({
  _id: `job${createdAt}` as ResearchJobRow["_id"], status, createdAt, knowledgeRevision: 1, lastError: undefined, directionId: undefined,
});

describe("gift collection across user surfaces", () => {
  it("adds without calling the destructive replacement action", async () => {
    const actions = { addGiftToBox: vi.fn().mockResolvedValue({ ok: true, value: null }), selectGift: vi.fn() };
    await addToGiftBox(actions, selection, "third");
    expect(actions.addGiftToBox).toHaveBeenCalledWith("third");
    expect(actions.selectGift).not.toHaveBeenCalled();
    expect(giftIsInBox(selection, "second")).toBe(true);
  });
  it("preserves the existing box on older deployments", async () => {
    const actions = { selectGift: vi.fn() };
    expect((await addToGiftBox(actions, selection, "third")).ok).toBe(false);
    expect(actions.selectGift).not.toHaveBeenCalled();
  });
  it("recognizes all existing gifts and does not add them twice", async () => {
    const actions = { addGiftToBox: vi.fn(), selectGift: vi.fn() };
    expect((await addToGiftBox(actions, selection, "second")).ok).toBe(true);
    expect(actions.addGiftToBox).not.toHaveBeenCalled();
  });
  it("renders the frozen collection, including after everyone approves", () => {
    const view = roomQuery("room");
    const proposal = proposalQuery("room");
    if (!proposal.revision) throw new Error("Fixture must include a revision");
    proposal.revision = { ...proposal.revision, status: "approved_pledged", items: selection.items };
    const html = renderToStaticMarkup(createElement(ProposalPanel, { proposal, selection, participants: view.participants, me: view.me, isOrganizer: true }));
    expect(html).toContain("First gift");
    expect(html).toContain("Second gift");
    expect(html).toContain("Everyone approved");
    expect(html).toContain("Unwrap has not charged cards");
  });
});

describe("live research feedback", () => {
  it("keeps an older active search visible after the newest finishes", () => {
    const jobs = [job("succeeded", 200), job("running")];
    expect(relevantResearchJob(jobs)?.status).toBe("running");
    expect(roomCouncilMembers({ researchJobs: jobs }).scout).toMatchObject({ status: "started", summary: "Scouting…" });
  });
  it("distinguishes uncertain work from an active search", () => {
    const jobs = [job("succeeded", 200), job("uncertain")];
    expect(relevantResearchJob(jobs)?.status).toBe("uncertain");
    expect(roomCouncilMembers({ researchJobs: jobs }).scout).toMatchObject({ status: "failed", summary: "Waiting for confirmation…" });
  });
  it("updates the animation token when the same job completes", () => {
    const running = roomCouncilMembers({ latestResearch: job("running") }).scout;
    const completed = roomCouncilMembers({ latestResearch: job("succeeded") }).scout;
    expect(completed.status).toBe("completed");
    expect(completed.sequence).not.toBe(running.sequence);
    expect(roomCouncilMembers({}).scout.status).toBe("idle");
  });
});
