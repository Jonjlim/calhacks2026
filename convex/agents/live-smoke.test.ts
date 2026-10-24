/** Explicit opt-in only. Runs synthetic text through the configured real model; incurs API usage. */
import { describe, expect, it } from "vitest";
import { decideBuyer, extractEvidence, type BuyerSnapshot } from "./engine";
import { configuredModel } from "./model";
import { answerRecipientQuery } from "./recipientPolicy";

const enabled = process.env.UNWRAP_LIVE_AGENT_SMOKE === "1";
function liveModel() {
  if (
    !process.env.LLM_BASE_URL ||
    !process.env.LLM_MODEL ||
    !process.env.LLM_API_KEY
  )
    throw new Error(
      "Set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY in the server environment before running the live smoke test. Never paste the key into chat.",
    );
  return configuredModel();
}
describe.skipIf(!enabled)(
  "LIVE configured-model verification (synthetic data; paid API calls)",
  () => {
    it("extracts a reviewable clue with a real source reference", async () => {
      const result = await extractEvidence(
        {
          sourceId: "synthetic-source",
          messages: [
            {
              id: "synthetic-message",
              speakerHint: "recipient",
              body: "I would love to take a beginner pottery class this year.",
            },
          ],
          publishedClues: [],
        },
        liveModel(),
      );
      expect(result.clues.length).toBeGreaterThan(0);
      expect(
        result.clues.every((clue) =>
          clue.sourceMessageIds.includes("synthetic-message"),
        ),
      ).toBe(true);
    }, 60_000);

    it("chooses a supplied product and grounds its recommendation in the supplied clue", async () => {
      const snapshot: BuyerSnapshot = {
        roomId: "synthetic-room",
        jobId: "synthetic-job",
        recipientDisplayName: "Maya",
        occasion: "Birthday",
        knowledgeRevision: 1,
        mode: "auto",
        trigger: "human",
        recipientAgentEnabled: false,
        researchRunning: false,
        askedSlots: [],
        recentMessages: [
          {
            id: "synthetic-message",
            author: "participant",
            text: "@unwrap recommend the supplied pottery class using the confirmed pottery clue. We have already chosen the direction; no more questions or research needed.",
          },
        ],
        publishedClues: [
          { id: "synthetic-clue", kind: "interest", text: "Enjoys pottery" },
        ],
        listings: [
          {
            id: "synthetic-listing",
            title: "Beginner pottery class",
            priceStatus: "unknown",
            sourceUrl: "https://example.com/synthetic-fixture",
            retrievedAt: Date.now(),
          },
        ],
        recommendations: [
          {
            listingId: "synthetic-listing",
            publishedClueIds: ["synthetic-clue"],
            explanation: "Matches pottery interest",
          },
        ],
      };
      const decision = await decideBuyer(snapshot, liveModel());
      expect(decision.intent).toBe("recommend");
      if (decision.intent === "recommend")
        expect(decision.citations).toEqual({
          listingIds: ["synthetic-listing"],
          publishedClueIds: ["synthetic-clue"],
        });
    }, 60_000);

    it("answers a permitted recipient question without returning raw profile text", async () => {
      const result = await answerRecipientQuery(
        {
          id: "synthetic-query",
          roomId: "synthetic-room",
          askedByJobId: "synthetic-job",
          type: "suitability",
          subject: { kind: "category", label: "pottery class" },
        },
        {
          roomId: "synthetic-room",
          jobId: "synthetic-job",
          profileId: "synthetic-profile",
          preferences: [
            {
              id: "synthetic-preference",
              recipientProfileId: "synthetic-profile",
              category: "interest",
              text: "Would love a beginner pottery class",
              authorized: true,
              disclosable: true,
              createdAt: Date.now(),
            },
          ],
          grants: [
            {
              recipientProfileId: "synthetic-profile",
              category: "interest",
              allowedQuestionTypes: ["suitability"],
            },
          ],
        },
        liveModel(),
      );
      expect(result.status).toBe("answered");
      expect(result.suitability).toBe("yes");
      expect(result.guidance).not.toContain(
        "Would love a beginner pottery class",
      );
    }, 60_000);
  },
);
