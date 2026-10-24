/**
 * Manual live checks, run on the deployment so the model key stays server-side:
 * `npx convex run agents/smoke:all`. Synthetic data only; a few small paid calls.
 */
import { internalAction } from "../_generated/server";
import { decideBuyer, extractEvidence, type BuyerSnapshot } from "./engine";
import { configuredModel } from "./model";
import { answerRecipientQuery } from "./recipientPolicy";

async function extraction() {
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
    configuredModel(),
  );
  return {
    clueCount: result.clues.length,
    grounded: result.clues.every((c) =>
      c.sourceMessageIds.includes("synthetic-message"),
    ),
  };
}

async function buyer() {
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
  const decision = await decideBuyer(snapshot, configuredModel());
  return {
    intent: decision.intent,
    citations: decision.intent === "recommend" ? decision.citations : null,
  };
}

async function recipient() {
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
    configuredModel(),
  );
  return {
    status: result.status,
    suitability: result.suitability,
    leaksRawText: (result.guidance ?? "").includes(
      "Would love a beginner pottery class",
    ),
  };
}

/** Direct request with published clues but no candidates yet: expect a search, not silence. */
async function buyerSearch() {
  const decision = await decideBuyer(
    {
      roomId: "synthetic-room",
      jobId: "synthetic-job",
      recipientDisplayName: "Maya",
      occasion: "Birthday",
      budgetMinor: 6000,
      knowledgeRevision: 2,
      mode: "quiet",
      trigger: "human",
      recipientAgentEnabled: false,
      researchRunning: false,
      askedSlots: [],
      recentMessages: [
        {
          id: "synthetic-message",
          author: "participant",
          text: "@unwrap she already owns a starter pottery kit, what do you suggest under $60?",
        },
      ],
      publishedClues: [
        { id: "c1", kind: "interest", text: "Wants to try a beginner pottery class." },
        { id: "c2", kind: "exclusion", text: "Does not want more candles." },
      ],
      listings: [],
      recommendations: [],
    } as unknown as BuyerSnapshot,
    configuredModel(),
  );
  return decision;
}

export const buyerSearchSynthetic = internalAction({ args: {}, handler: buyerSearch });
export const extractSynthetic = internalAction({ args: {}, handler: extraction });
export const buyerSynthetic = internalAction({ args: {}, handler: buyer });
export const recipientSynthetic = internalAction({ args: {}, handler: recipient });
export const all = internalAction({
  args: {},
  handler: async () => ({
    extraction: await extraction(),
    buyer: await buyer(),
    recipient: await recipient(),
  }),
});
