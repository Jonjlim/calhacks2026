import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      title: "Maya",
      recipientDisplayName: "Maya",
      occasion: "birthday",
      currency: "USD",
      budgetMinor: 10000,
      knowledgeRevision: 1,
      inviteToken: "private-token",
      createdBy: "alice",
      createdAt: 0,
    });
    const alice = await ctx.db.insert("participants", {
      roomId,
      userId: "alice",
      displayName: "Alice",
      role: "organizer",
      joinedAt: 0,
    });
    const bob = await ctx.db.insert("participants", {
      roomId,
      userId: "bob",
      displayName: "Bob",
      role: "contributor",
      joinedAt: 0,
    });
    await ctx.db.insert("chatMessages", {
      roomId,
      participantId: alice,
      authorKind: "participant",
      body: "@unwrap help find a pottery gift",
      createdAt: 1,
      clientIdempotencyKey: "initial",
    });
    const clueId = await ctx.db.insert("publishedClues", {
      roomId,
      publisherId: alice,
      kind: "interest",
      text: "pottery",
      sourceKind: "manual",
      sourceMessageIds: [],
      status: "active",
      publishedAt: 0,
    });
    const sourceId = await ctx.db.insert("evidenceSources", {
      roomId,
      participantId: alice,
      kind: "paste",
      label: "selected",
      sourceRevision: 1,
      createdAt: 0,
    });
    const privateMessageId = await ctx.db.insert("privateMessages", {
      sourceId,
      participantId: alice,
      body: "I want to try pottery",
      speakerHint: "Maya",
    });
    await ctx.db.insert("contributionLimits", {
      roomId,
      participantId: bob,
      amountMinor: 4321,
      updatedAt: 0,
    });
    return { roomId, alice, bob, clueId, sourceId, privateMessageId };
  });
  return {
    t,
    ids,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
  };
}
function value<T>(
  result: { ok: true; value: T } | { ok: false; error: unknown },
): T {
  if (!result.ok)
    throw new Error(`Unexpected error ${JSON.stringify(result.error)}`);
  return result.value;
}
const question = {
  intent: "clarify",
  rationale: "Need direction",
  clarifySlot: "direction",
  chatMessage: "Would she enjoy a class with friends?",
  needsFollowup: false,
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("durable agent jobs", () => {
  it("requires membership, deduplicates turns, and allows one claim", async () => {
    const { t, ids, alice } = await setup();
    expect(
      await t.mutation(api.agents.buyer.requestTurn, { roomId: ids.roomId }),
    ).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    const first = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    expect(
      value(
        await alice.mutation(api.agents.buyer.requestTurn, {
          roomId: ids.roomId,
        }),
      ).jobId,
    ).toBe(first.jobId);
    const work = await t.mutation(internal.agents.runtime.claimJob, {
      jobId: first.jobId,
      kind: "evaluate_thread",
    });
    expect(work?.attempt).toBe(1);
    expect(
      await t.mutation(internal.agents.runtime.claimJob, {
        jobId: first.jobId,
        kind: "evaluate_thread",
      }),
    ).toBeNull();
    const serialized = JSON.stringify(work?.snapshot);
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("4321");
    expect(serialized).not.toContain("I want to try pottery");
  });
  it("commits a question once, records an answer, and refuses repeating the answered slot", async () => {
    const { t, ids, alice, bob } = await setup();
    const { jobId } = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    const work = (await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "evaluate_thread",
    }))!;
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId,
      attempt: work.attempt,
      decision: question,
    });
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId,
      attempt: work.attempt,
      decision: question,
    });
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("chatMessages").collect()).filter(
          (m) => m.authorKind === "buyer_agent",
        ),
      ),
    ).toHaveLength(1);
    const answer = value(
      await bob.mutation(api.agents.buyer.answerQuestion, {
        roomId: ids.roomId,
        slot: "direction",
        body: "Yes, let's go together",
        clientIdempotencyKey: "answer1",
      }),
    );
    const next = (await t.mutation(internal.agents.runtime.claimJob, {
      jobId: answer.jobId,
      kind: "evaluate_thread",
    }))!;
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId: answer.jobId,
      attempt: next.attempt,
      decision: question,
    });
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("chatMessages").collect()).filter(
          (m) => m.authorKind === "buyer_agent",
        ),
      ),
    ).toHaveLength(1);
    const slots = await t.run((ctx) => ctx.db.query("askedSlots").collect());
    expect(slots[0]).toMatchObject({
      status: "answered",
      answeredByMessageId: answer.messageId,
    });
  });
  it("applies nothing when newer knowledge arrives during a model call", async () => {
    const { t, ids, alice } = await setup();
    const { jobId } = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "evaluate_thread",
    });
    await t.run((ctx) => ctx.db.patch(ids.roomId, { knowledgeRevision: 2 }));
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId,
      attempt: 1,
      decision: question,
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "stale",
    });
    expect(
      await t.run((ctx) => ctx.db.query("askedSlots").collect()),
    ).toHaveLength(0);
  });
  it("fences timed-out attempts and limits retries", async () => {
    const { t, ids, alice, bob } = await setup();
    const { jobId } = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "evaluate_thread",
    });
    await t.mutation(internal.agents.runtime.expireJob, { jobId, attempt: 1 });
    expect(
      await bob.mutation(api.agents.buyer.retryJob, { jobId }),
    ).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    value(await alice.mutation(api.agents.buyer.retryJob, { jobId }));
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "evaluate_thread",
    });
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId,
      attempt: 1,
      decision: question,
    });
    expect(
      await t.run((ctx) => ctx.db.query("askedSlots").collect()),
    ).toHaveLength(0);
    await t.mutation(internal.agents.runtime.expireJob, { jobId, attempt: 2 });
    expect(
      await alice.mutation(api.agents.buyer.retryJob, { jobId }),
    ).toMatchObject({ ok: false, error: { code: "invalid_revision" } });
  });
  it("hands a bounded, server-corrected brief to member 4 once", async () => {
    const { t, ids, alice } = await setup();
    const { jobId } = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "evaluate_thread",
    });
    const decision = {
      intent: "search",
      rationale: "Find classes",
      needsFollowup: false,
      searchBrief: {
        roomId: "wrong-room",
        knowledgeRevision: 99,
        queryTerms: ["pottery class"],
        mustExclude: [],
        budgetMinor: 999999,
        listingLimit: 6,
      },
    };
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId,
      attempt: 1,
      decision,
    });
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId,
      attempt: 1,
      decision,
    });
    const jobs = await t.run((ctx) => ctx.db.query("researchJobs").collect());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      roomId: ids.roomId,
      knowledgeRevision: 1,
      status: "pending",
      brief: { budgetMinor: 10000, listingLimit: 6 },
    });
    expect(jobs[0]?.publishedClueIds).toEqual([ids.clueId]);
  });
  it("runs the scheduled buyer action through a mocked provider and persists the question", async () => {
    const { t, ids, alice } = await setup();
    vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
    vi.stubEnv("LLM_API_KEY", "test");
    vi.stubEnv("LLM_MODEL", "test");
    const fetcher = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(question) },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { jobId } = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "succeeded",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      value(
        await alice.query(api.agents.buyer.listActivity, {
          roomId: ids.roomId,
        }),
      ).questions,
    ).toHaveLength(1);
  });
});

describe("private extraction persistence", () => {
  it("denies another contributor, deduplicates a source revision, and stores only proposed clues", async () => {
    const { t, ids, alice, bob } = await setup();
    expect(
      await bob.mutation(api.agents.extract.extractClues, {
        sourceId: ids.sourceId,
      }),
    ).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    const { jobId } = value(
      await alice.mutation(api.agents.extract.extractClues, {
        sourceId: ids.sourceId,
      }),
    );
    expect(
      value(
        await alice.mutation(api.agents.extract.extractClues, {
          sourceId: ids.sourceId,
        }),
      ).jobId,
    ).toBe(jobId);
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "extract",
    });
    const result = {
      sourceId: ids.sourceId,
      clues: [
        {
          kind: "interest",
          text: "pottery",
          confidence: 0.9,
          sourceMessageIds: [ids.privateMessageId],
          speakerAssumption: "recipient",
          contradictsClueIds: [],
        },
      ],
    };
    await t.mutation(internal.agents.runtime.completeExtraction, {
      jobId,
      attempt: 1,
      result,
    });
    await t.mutation(internal.agents.runtime.completeExtraction, {
      jobId,
      attempt: 1,
      result,
    });
    expect(
      await t.run((ctx) => ctx.db.query("proposedClues").collect()),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("publishedClues").collect()),
    ).toHaveLength(1);
    const aliceActivity = value(
      await alice.query(api.agents.buyer.listActivity, { roomId: ids.roomId }),
    );
    const bobActivity = value(
      await bob.query(api.agents.buyer.listActivity, { roomId: ids.roomId }),
    );
    expect(aliceActivity.events).toHaveLength(2);
    expect(bobActivity.events).toEqual([]);
  });
  it("rejects a deleted source during completion", async () => {
    const { t, ids, alice } = await setup();
    const { jobId } = value(
      await alice.mutation(api.agents.extract.extractClues, {
        sourceId: ids.sourceId,
      }),
    );
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "extract",
    });
    await t.run((ctx) => ctx.db.patch(ids.sourceId, { deletedAt: 2 }));
    await t.mutation(internal.agents.runtime.completeExtraction, {
      jobId,
      attempt: 1,
      result: { sourceId: ids.sourceId, clues: [] },
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "stale",
    });
    expect(
      await t.run((ctx) => ctx.db.query("proposedClues").collect()),
    ).toEqual([]);
  });
});

describe("recipient agent integration", () => {
  it("executes buyer → recipient → room with separate model contexts and a visible verdict", async () => {
    const { t, ids, alice } = await setup();
    vi.stubEnv("RECIPIENT_AGENT_DEMO_ENABLED", "true");
    vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
    vi.stubEnv("LLM_API_KEY", "test");
    vi.stubEnv("LLM_MODEL", "test");
    const { recipientProfileId } = value(
      await alice.mutation(api.agents.recipient.createProfile, {
        roomId: ids.roomId,
      }),
    );
    value(
      await alice.mutation(api.agents.recipient.updateRecipientPreferences, {
        recipientProfileId,
        preferences: [
          {
            category: "interest",
            text: "Enjoys ceramics workshops",
            authorized: true,
            disclosable: true,
          },
        ],
        grants: [
          { category: "interest", allowedQuestionTypes: ["suitability"] },
        ],
      }),
    );
    const calls: Array<{ messages: Array<{ content: string }> }> = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async (_url: unknown, options: RequestInit) => {
          const body = JSON.parse(String(options.body)) as {
            messages: Array<{ content: string }>;
          };
          calls.push(body);
          const input = JSON.parse(body.messages[1]!.content) as {
            preferences?: Array<{ id: string }>;
          };
          const output = input.preferences
            ? {
                suitability: "yes",
                usedPreferenceIds: [input.preferences[0]!.id],
              }
            : {
                intent: "query_recipient",
                rationale: "Check a class direction",
                needsFollowup: false,
                recipientQuery: {
                  type: "suitability",
                  subject: { kind: "category", label: "pottery workshop" },
                },
              };
          return Response.json({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify(output) },
              },
            ],
          });
        }),
    );
    const { jobId } = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "succeeded",
    });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[0])).not.toContain("Enjoys ceramics workshops");
    expect(JSON.stringify(calls[1])).not.toContain("@unwrap help");
    const activity = value(
      await alice.query(api.agents.buyer.listActivity, { roomId: ids.roomId }),
    );
    expect(activity.events.map((e) => e.actor)).toContain("recipient");
    expect(JSON.stringify(activity)).not.toContain("Enjoys ceramics workshops");
    const chat = await t.run(async (ctx) =>
      (await ctx.db.query("chatMessages").collect()).filter(
        (m) => m.authorKind === "buyer_agent",
      ),
    );
    expect(chat).toHaveLength(1);
    expect(chat[0]?.body).toContain("pottery workshop");
    expect(chat[0]?.body).toContain("found support");
    expect(
      await t.run((ctx) => ctx.db.query("publishedClues").collect()),
    ).toHaveLength(1);
  });
  it("requires demo opt-in, isolates preferences, and rejects a revoked in-flight verdict", async () => {
    const { t, ids, alice, bob } = await setup();
    expect(
      await alice.mutation(api.agents.recipient.createProfile, {
        roomId: ids.roomId,
      }),
    ).toMatchObject({ ok: false });
    vi.stubEnv("RECIPIENT_AGENT_DEMO_ENABLED", "true");
    expect(
      await bob.mutation(api.agents.recipient.createProfile, {
        roomId: ids.roomId,
      }),
    ).toMatchObject({ ok: false });
    const { recipientProfileId } = value(
      await alice.mutation(api.agents.recipient.createProfile, {
        roomId: ids.roomId,
      }),
    );
    value(
      await alice.mutation(api.agents.recipient.updateRecipientPreferences, {
        recipientProfileId,
        preferences: [
          {
            category: "interest",
            text: "pottery",
            authorized: true,
            disclosable: true,
          },
        ],
        grants: [
          { category: "interest", allowedQuestionTypes: ["suitability"] },
        ],
      }),
    );
    expect(
      await bob.query(api.agents.recipient.getMyProfile, {
        roomId: ids.roomId,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await bob.mutation(api.agents.recipient.updateRecipientPreferences, {
        recipientProfileId,
        preferences: [],
        grants: [],
      }),
    ).toMatchObject({ ok: false });
    const { jobId } = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "evaluate_thread",
    });
    const revision = await t.run(
      async (ctx) => (await ctx.db.get(recipientProfileId))!.revision,
    );
    value(
      await alice.mutation(api.agents.recipient.updateRecipientPreferences, {
        recipientProfileId,
        preferences: [],
        grants: [],
      }),
    );
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId,
      attempt: 1,
      decision: {
        intent: "query_recipient",
        rationale: "Check suitability",
        needsFollowup: false,
        recipientQuery: {
          type: "suitability",
          subject: { kind: "category", label: "pottery" },
        },
      },
      recipientResult: {
        profileId: recipientProfileId,
        profileRevision: revision,
        reply: {
          queryId: `${jobId}:recipient`,
          status: "answered",
          guidance: "Approved direction",
          usedPreferenceIds: [],
          policy: { allowed: true },
        },
      },
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "stale",
    });
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("chatMessages").collect()).filter(
          (m) => m.authorKind === "buyer_agent",
        ),
      ),
    ).toEqual([]);
  });
});

describe("failure and revocation", () => {
  it("fails visibly without provider credentials instead of fabricating an answer", async () => {
    const { t, ids, alice } = await setup();
    vi.stubEnv("LLM_API_KEY", "");
    const { jobId } = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "failed",
    });
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("chatMessages").collect()).filter(
          (m) => m.authorKind === "buyer_agent",
        ),
      ),
    ).toEqual([]);
    expect(
      value(
        await alice.query(api.agents.buyer.listActivity, {
          roomId: ids.roomId,
        }),
      ).events.some((e) => e.kind === "failed"),
    ).toBe(true);
  });
  it("does not commit when the acting member has been removed", async () => {
    const { t, ids, alice } = await setup();
    const { jobId } = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId: ids.roomId,
      }),
    );
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "evaluate_thread",
    });
    await t.run((ctx) => ctx.db.delete(ids.alice));
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId,
      attempt: 1,
      decision: question,
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: "stale",
    });
    expect(await t.run((ctx) => ctx.db.query("askedSlots").collect())).toEqual(
      [],
    );
  });
  it("rolls back all proposed clues if any citation crosses a source boundary", async () => {
    const { t, ids, alice } = await setup();
    const { jobId } = value(
      await alice.mutation(api.agents.extract.extractClues, {
        sourceId: ids.sourceId,
      }),
    );
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId,
      kind: "extract",
    });
    const foreignMessageId = await t.run(async (ctx) => {
      const sourceId = await ctx.db.insert("evidenceSources", {
        roomId: ids.roomId,
        participantId: ids.bob,
        kind: "paste",
        label: "Bob only",
        sourceRevision: 1,
        createdAt: 0,
      });
      return ctx.db.insert("privateMessages", {
        sourceId,
        participantId: ids.bob,
        body: "Private Bob text",
      });
    });
    const clue = {
      kind: "interest",
      text: "pottery",
      confidence: 0.9,
      sourceMessageIds: [ids.privateMessageId],
      speakerAssumption: "recipient",
      contradictsClueIds: [],
    };
    await expect(
      t.mutation(internal.agents.runtime.completeExtraction, {
        jobId,
        attempt: 1,
        result: {
          sourceId: ids.sourceId,
          clues: [clue, { ...clue, sourceMessageIds: [foreignMessageId] }],
        },
      }),
    ).rejects.toThrow("citation mismatch");
    expect(
      await t.run((ctx) => ctx.db.query("proposedClues").collect()),
    ).toEqual([]);
  });
});
