import { describe, expect, it } from "vitest";
import { renderRecommendation } from "./presentation";
import { decideBuyer, type BuyerSnapshot } from "./engine";

const snapshot: BuyerSnapshot = {
  roomId: "room",
  jobId: "job",
  recipientDisplayName: "Maya",
  occasion: "Birthday",
  knowledgeRevision: 1,
  mode: "auto",
  trigger: "research_completed",
  recipientAgentEnabled: false,
  researchRunning: false,
  askedSlots: [],
  recentMessages: [],
  publishedClues: [{ id: "clue", kind: "interest", text: "pottery" }],
  listings: [
    {
      id: "listing",
      title: "Pottery class",
      sourceUrl: "https://example.com",
      retrievedAt: 1,
      priceStatus: "unknown",
      availability: "unknown",
      shippingStatus: "unknown",
    },
  ],
  recommendations: [
    {
      listingId: "listing",
      publishedClueIds: ["clue"],
      explanation: "Fits pottery",
    },
  ],
  research: {
    jobId: "research",
    status: "succeeded",
    poolJobId: "research",
    poolKnowledgeRevision: 1,
  },
};
describe("grounded recommendation presentation", () => {
  it("never substitutes model prose for unknown purchasing facts", () => {
    const rendered = renderRecommendation(
      {
        intent: "recommend",
        rationale: "Fits",
        needsFollowup: false,
        chatMessage: "Free, in stock, ships tomorrow",
        citations: { listingIds: ["listing"], publishedClueIds: ["clue"] },
      },
      snapshot,
    );
    expect(rendered.body).toContain("Item price unknown");
    expect(rendered.body).toContain("Shipping is unconfirmed");
    expect(rendered.body).not.toContain("ships tomorrow");
    expect(rendered.citations).toEqual({
      listingIds: ["listing"],
      publishedClueIds: ["clue"],
      researchJobId: "research",
    });
  });
  it("asks for a new direction without a model call when all cached candidates lose support", async () => {
    const result = await decideBuyer(
      { ...snapshot, recommendations: [] },
      async () => {
        throw new Error("Model should not be called");
      },
    );
    expect(result).toMatchObject({
      intent: "clarify",
      clarifySlot: "direction",
    });
    const blocked = await decideBuyer(
      {
        ...snapshot,
        recommendations: [],
        askedSlots: [{ slot: "direction", status: "open" }],
      },
      async () => {
        throw new Error("Model should not be called");
      },
    );
    expect(blocked.intent).toBe("listen");
  });
});
