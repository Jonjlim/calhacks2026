import { describe, expect, it, vi } from "vitest";
import { agentDecisionSchema } from "../../lib/validation";
import {
  decideBuyer,
  extractEvidence,
  validateDecision,
  type BuyerSnapshot,
} from "./engine";
import { answerRecipientQuery } from "./recipientPolicy";
import { toolsFor } from "./policy";

function snapshot(overrides: Partial<BuyerSnapshot> = {}): BuyerSnapshot {
  return {
    roomId: "room",
    jobId: "job",
    recipientDisplayName: "Maya",
    occasion: "birthday",
    knowledgeRevision: 1,
    budgetMinor: 10000,
    mode: "auto",
    recipientAgentEnabled: false,
    recentMessages: [
      { id: "m1", author: "participant", text: "@unwrap find pottery gifts" },
    ],
    publishedClues: [
      { id: "c1", kind: "interest", text: "pottery" },
      { id: "c2", kind: "ownership", text: "owns starter kit" },
    ],
    askedSlots: [],
    listings: [],
    recommendations: [],
    researchRunning: false,
    ...overrides,
  };
}
const search = {
  intent: "search",
  rationale: "Research pottery",
  needsFollowup: false,
  searchBrief: {
    roomId: "injected",
    knowledgeRevision: 99,
    budgetMinor: 999999,
    mustExclude: [],
    queryTerms: ["pottery workshop"],
    listingLimit: 12,
  },
} as const;

describe("buyer role boundaries", () => {
  it("rejects model-suggested tools, payments, extra secrets and recursive followups", () => {
    expect(
      agentDecisionSchema.safeParse({
        intent: "capturePayment",
        needsFollowup: false,
      }).success,
    ).toBe(false);
    expect(
      agentDecisionSchema.safeParse({
        intent: "listen",
        rationale: "ok",
        needsFollowup: false,
        tool: "readAll",
      }).success,
    ).toBe(false);
    expect(
      agentDecisionSchema.safeParse({
        intent: "listen",
        rationale: "ok",
        needsFollowup: true,
      }).success,
    ).toBe(false);
    expect(toolsFor("buyer")).not.toContain("getOwnEvidence");
    expect(toolsFor("buyer")).not.toContain("queryRecipientAgent");
    expect(toolsFor("recipient")).toEqual(["getAuthorizedPreferences"]);
  });
  it("does not call the model for ordinary chat in quiet mode", async () => {
    const model = vi.fn();
    const result = await decideBuyer(
      snapshot({
        mode: "quiet",
        recentMessages: [
          { id: "m", author: "participant", text: "How was lunch?" },
        ],
      }),
      model,
    );
    expect(result.intent).toBe("listen");
    expect(model).not.toHaveBeenCalled();
  });
  it("retries malformed output once and accepts valid decisions", async () => {
    const model = vi
      .fn()
      .mockResolvedValueOnce({ tool: "readAll" })
      .mockResolvedValueOnce({
        intent: "listen",
        rationale: "No follow-up needed",
        needsFollowup: false,
      });
    expect((await decideBuyer(snapshot(), model)).intent).toBe("listen");
    expect(model).toHaveBeenCalledTimes(2);
  });
  it("retries once when a directly invited buyer stays silent", async () => {
    const model = vi
      .fn()
      .mockResolvedValueOnce({
        intent: "listen",
        rationale: "Nothing to do",
        needsFollowup: false,
      })
      .mockResolvedValueOnce(search);
    const result = await decideBuyer(snapshot({ trigger: "human" }), model);
    expect(result.intent).toBe("search");
    expect(model).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(model.mock.calls[1]![0])).toContain("directly invited");
  });
  it("does not push a silent buyer while research is already running", async () => {
    const model = vi.fn().mockResolvedValue({
      intent: "wait",
      rationale: "Research is running",
      needsFollowup: false,
    });
    const result = await decideBuyer(
      snapshot({ trigger: "human", researchRunning: true }),
      model,
    );
    expect(result.intent).toBe("wait");
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("fails after two malformed outputs", async () => {
    const model = vi.fn().mockResolvedValue({ intent: "execute" });
    await expect(decideBuyer(snapshot(), model)).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(model).toHaveBeenCalledTimes(2);
  });
  it("enforces server room, budget, revision and ownership exclusions", () => {
    const decision = validateDecision(
      agentDecisionSchema.parse(search),
      snapshot(),
    );
    expect(decision.intent).toBe("search");
    if (decision.intent === "search")
      expect(decision.searchBrief).toMatchObject({
        roomId: "room",
        knowledgeRevision: 1,
        budgetMinor: 10000,
        mustExclude: ["owns starter kit"],
      });
  });
  it("waits for existing research and requires confirmed interests", () => {
    expect(
      validateDecision(
        agentDecisionSchema.parse(search),
        snapshot({ researchRunning: true }),
      ).intent,
    ).toBe("wait");
    expect(
      validateDecision(
        agentDecisionSchema.parse(search),
        snapshot({ publishedClues: [] }),
      ).intent,
    ).toBe("listen");
  });
  it("does not repeat questions or interrupt an open question", () => {
    const decision = agentDecisionSchema.parse({
      intent: "clarify",
      rationale: "Need a budget",
      clarifySlot: "budget",
      chatMessage: "What is your budget?",
      needsFollowup: false,
    });
    expect(
      validateDecision(
        decision,
        snapshot({ askedSlots: [{ slot: "budget", status: "answered" }] }),
      ).intent,
    ).toBe("listen");
    expect(
      validateDecision(
        decision,
        snapshot({ askedSlots: [{ slot: "size", status: "open" }] }),
      ).intent,
    ).toBe("listen");
  });
  it("rejects nonexistent recommendation citations and mismatched evidence connections", () => {
    const decision = agentDecisionSchema.parse({
      intent: "recommend",
      rationale: "Matches",
      chatMessage: "Try this class",
      citations: { listingIds: ["fake"], publishedClueIds: ["c1"] },
      needsFollowup: false,
    });
    expect(() => validateDecision(decision, snapshot())).toThrow(
      "unavailable evidence",
    );
    expect(() =>
      validateDecision(
        decision,
        snapshot({
          listings: [
            {
              id: "fake",
              title: "Class",
              sourceUrl: "https://example.com",
              retrievedAt: 0,
            },
          ],
          recommendations: [],
        }),
      ),
    ).toThrow("no matching evidence");
  });
});

describe("private clue extraction", () => {
  const input = {
    sourceId: "source",
    messages: [{ id: "m1", body: "Do you want a pottery kit?" }],
    publishedClues: [],
  };
  const clue = {
    kind: "explicit_wish",
    text: "Wants pottery kit",
    confidence: 0.95,
    speakerAssumption: "recipient",
    sourceMessageIds: ["m1"],
    contradictsClueIds: [],
  };
  it("does not turn a question into a confirmed wish", async () => {
    const result = await extractEvidence(
      input,
      vi.fn().mockResolvedValue({ sourceId: "source", clues: [clue] }),
    );
    expect(result.clues[0]).toMatchObject({
      kind: "uncertain",
      confidence: 0.5,
    });
  });
  it("rejects another source or fabricated message references", async () => {
    await expect(
      extractEvidence(
        input,
        vi.fn().mockResolvedValue({ sourceId: "someone-else", clues: [clue] }),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      extractEvidence(
        input,
        vi
          .fn()
          .mockResolvedValue({
            sourceId: "source",
            clues: [{ ...clue, sourceMessageIds: ["other-person"] }],
          }),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("drops sensitive lines before model input and sensitive output before storage", async () => {
    const model = vi
      .fn()
      .mockResolvedValue({
        sourceId: "source",
        clues: [{ ...clue, text: "Has a medical diagnosis" }],
      });
    const result = await extractEvidence(
      {
        ...input,
        messages: [
          ...input.messages,
          { id: "secret", body: "My SSN is 123-45-6789" },
        ],
      },
      model,
    );
    expect(JSON.stringify(model.mock.calls[0])).not.toContain("123-45-6789");
    expect(result.clues).toEqual([]);
  });
});

describe("recipient-to-buyer permission boundary", () => {
  const query = {
    id: "q",
    roomId: "room",
    askedByJobId: "job",
    type: "suitability",
    subject: { kind: "category", label: "pottery" },
  };
  const context = {
    roomId: "room",
    jobId: "job",
    profileId: "profile",
    grants: [
      {
        recipientProfileId: "profile",
        category: "interest" as const,
        allowedQuestionTypes: ["suitability" as const],
      },
    ],
    preferences: [
      {
        id: "pref",
        recipientProfileId: "profile",
        category: "interest" as const,
        text: "pottery",
        authorized: true,
        disclosable: true,
        createdAt: 0,
      },
    ],
  };
  it("refuses unsupported question types and cross-room requests before a model call", async () => {
    const model = vi.fn();
    expect(
      (
        await answerRecipientQuery(
          { ...query, type: "share_recent_dms" },
          context,
          model,
        )
      ).status,
    ).toBe("refused");
    expect(
      (
        await answerRecipientQuery(
          { ...query, roomId: "other" },
          context,
          model,
        )
      ).status,
    ).toBe("refused");
    expect(model).not.toHaveBeenCalled();
  });
  it("returns unknown for non-disclosable records and refuses revoked grants", async () => {
    const model = vi.fn();
    expect(
      (
        await answerRecipientQuery(
          query,
          {
            ...context,
            preferences: [{ ...context.preferences[0]!, disclosable: false }],
          },
          model,
        )
      ).status,
    ).toBe("unknown");
    expect(
      (await answerRecipientQuery(query, { ...context, grants: [] }, model))
        .status,
    ).toBe("refused");
    expect(model).not.toHaveBeenCalled();
  });
  it("passes only granted records and returns fixed guidance rather than model prose", async () => {
    const model = vi
      .fn()
      .mockResolvedValue({ suitability: "yes", usedPreferenceIds: ["pref"] });
    const result = await answerRecipientQuery(
      query,
      {
        ...context,
        preferences: [
          ...context.preferences,
          {
            ...context.preferences[0]!,
            id: "hidden",
            category: "ownership",
            text: "private machine",
            disclosable: false,
          },
        ],
      },
      model,
    );
    expect(JSON.stringify(model.mock.calls[0])).not.toContain(
      "private machine",
    );
    expect(result).toMatchObject({
      status: "answered",
      suitability: "yes",
      policy: { allowed: true },
    });
    expect(result.guidance).not.toContain("pottery");
  });
  it("rejects fabricated preference citations", async () => {
    await expect(
      answerRecipientQuery(
        query,
        context,
        vi
          .fn()
          .mockResolvedValue({
            suitability: "yes",
            usedPreferenceIds: ["hidden"],
          }),
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
