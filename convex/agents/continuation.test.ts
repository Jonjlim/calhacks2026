import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import type { BuyerSnapshot } from "./engine";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import { modules } from "../test.setup";
import fixture from "../research/fixtures/johnvc-shopping.json";

function value<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(result.error.code + ": " + result.error.message);
  return result.value;
}
async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice|session" });
  const bob = t.withIdentity({ subject: "bob|session" });
  const created = value(
    await alice.mutation(api.rooms.createRoom, {
      title: "Maya",
      recipientDisplayName: "Maya",
      occasion: "Birthday",
      budgetMinor: 10000,
    }),
  );
  const joined = value(
    await bob.mutation(api.rooms.joinRoom, {
      inviteToken: created.inviteToken,
      displayName: "Bob",
    }),
  );
  const clue = value(
    await alice.mutation(api.clues.upsertManualPreference, {
      roomId: created.room._id,
      kind: "interest",
      text: "pottery",
    }),
  );
  return {
    t,
    alice,
    bob,
    roomId: created.room._id,
    participantId: created.participant._id,
    bobId: joined.participant._id,
    clueId: clue._id,
  };
}
async function ready(t: ReturnType<typeof convexTest>) {
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(1);
    await t.finishInProgressScheduledFunctions();
  }
}
function configureModel() {
  vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
  vi.stubEnv("LLM_API_KEY", "private-model-key");
  vi.stubEnv("LLM_MODEL", "test-model");
}
function recommendation(snapshot: BuyerSnapshot) {
  const rec = snapshot.recommendations.find(
    (row) => row.publishedClueIds.length > 0,
  )!;
  return {
    intent: "recommend",
    rationale: "Use the supported candidate",
    needsFollowup: false,
    chatMessage: "It costs $0, ships tomorrow, and is guaranteed in stock!",
    citations: {
      listingIds: [rec.listingId],
      publishedClueIds: rec.publishedClueIds,
    },
  };
}
function fullProvider() {
  configureModel();
  vi.stubEnv("APIFY_TOKEN", "private-apify-key");
  const inputs: BuyerSnapshot[] = [];
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url, options) => {
      const path = String(url);
      if (path.startsWith("https://model.example/")) {
        const payload = JSON.parse(String(options?.body)) as {
          messages: Array<{ content: string }>;
        };
        const { snapshot } = JSON.parse(payload.messages[1]!.content) as {
          snapshot: BuyerSnapshot;
        };
        inputs.push(snapshot);
        const output =
          snapshot.trigger === "human"
            ? {
                intent: "search",
                rationale: "Find pottery options",
                needsFollowup: false,
                searchBrief: {
                  roomId: snapshot.roomId,
                  knowledgeRevision: snapshot.knowledgeRevision,
                  queryTerms: ["pottery tools"],
                  mustExclude: [],
                  listingLimit: 6,
                },
              }
            : recommendation(snapshot);
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(output) },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 200,
            prompt_tokens_details: { cached_tokens: 50 },
            completion_tokens_details: { reasoning_tokens: 20 },
          },
        });
      }
      if (path.includes("/acts/"))
        return Response.json({ data: { id: "run123", status: "RUNNING" } });
      if (path.includes("/actor-runs/"))
        return Response.json({
          data: {
            id: "run123",
            status: "SUCCEEDED",
            defaultDatasetId: "dataset123",
          },
        });
      if (path.includes("/datasets/")) return Response.json(fixture.pages);
      throw new Error("Unexpected network request");
    });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, inputs };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("research-to-agent continuation", () => {
  it("runs human → planner → provider → facilitator using the UI's dynamic ranking", async () => {
    const { t, alice, bob, roomId } = await setup();
    const { fetcher, inputs } = fullProvider();
    await alice.mutation(api.messages.sendMessage, {
      roomId,
      body: "@unwrap find thoughtful pottery tools",
      clientIdempotencyKey: "human",
    });
    await ready(t);
    await vi.advanceTimersByTimeAsync(3100);
    await t.finishInProgressScheduledFunctions();
    await ready(t);
    const research = await t.run((ctx) =>
      ctx.db.query("researchJobs").collect(),
    );
    expect(research).toHaveLength(1);
    expect(research[0]?.status).toBe("succeeded");
    expect(research[0]?.originatingAgentJobId).toBeTruthy();
    expect(research[0]?.continuationAgentJobId).toBeTruthy();
    expect(
      await t.run((ctx) => ctx.db.query("recommendations").collect()),
    ).toEqual([]);
    const results = value(
      await alice.query(api.research.research.listRecommendations, { roomId }),
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[1]?.trigger).toBe("research_completed");
    expect(inputs[1]?.recommendations.map((row) => row.listingId)).toEqual(
      results.recommendations.map((row) => row.listingId),
    );
    expect(
      fetcher.mock.calls.filter(
        ([url, opts]) =>
          String(url).includes("/acts/") && opts?.method === "POST",
      ),
    ).toHaveLength(1);
    const chat = value(
      await alice.query(api.messages.listMessages, { roomId }),
    ).filter((row) => row.authorKind === "buyer_agent");
    expect(chat).toHaveLength(1);
    expect(chat[0]?.body).not.toContain("guaranteed in stock");
    expect(chat[0]?.body).not.toContain("ships tomorrow");
    expect(chat[0]?.body).toContain("observed item price");
    expect(chat[0]?.body).toContain("Shipping is unconfirmed");
    expect(chat[0]?.citations?.researchJobId).toBe(research[0]?._id);
    expect(chat[0]?.citations?.publishedClueIds).not.toEqual([]);
    expect(JSON.stringify(inputs)).not.toContain("private-model-key");
    expect(JSON.stringify(inputs)).not.toContain("private-apify-key");
    expect(
      await t.run((ctx) => ctx.db.query("agentJobs").collect()),
    ).toHaveLength(2);
    const activity = value(
      await alice.query(api.agents.buyer.listActivity, { roomId }),
    );
    expect(activity.capabilities.modelConfigured).toBe(true);
    expect(
      activity.jobs.every(
        (job) =>
          job.modelUsage?.calls === 1 && job.modelUsage?.reportedCalls === 1,
      ),
    ).toBe(true);
    const otherActivity = value(
      await bob.query(api.agents.buyer.listActivity, { roomId }),
    );
    expect(otherActivity.jobs.every((job) => !("modelUsage" in job))).toBe(
      true,
    );
    expect(JSON.stringify(activity)).not.toContain("private-model-key");
  });

  it("queues only one continuation for duplicate completion callbacks", async () => {
    const { t, alice, roomId, clueId } = await setup();
    const { jobId } = value(
      await alice.mutation(api.research.research.startResearch, {
        roomId,
        publishedClueIds: [clueId],
        idempotencyKey: "research",
      }),
    );
    await t.mutation(internal.research.research.claimJob, { jobId });
    for (let i = 0; i < 2; i++)
      await t.mutation(internal.research.research.completeJob, {
        jobId,
        raw: fixture.pages,
        retrievedAt: fixture.retrievedAt,
      });
    const jobs = await t.run((ctx) => ctx.db.query("agentJobs").collect());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      trigger: "research_completed",
      researchJobId: jobId,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(jobId)))?.continuationAgentJobId,
    ).toBe(jobs[0]?._id);
  });

  it.each(["failed", "uncertain"] as const)(
    "reports %s without a model call, fabricated success, or another paid search",
    async (status) => {
      const { t, alice, roomId, clueId } = await setup();
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const { jobId } = value(
        await alice.mutation(api.research.research.startResearch, {
          roomId,
          publishedClueIds: [clueId],
          idempotencyKey: "research",
        }),
      );
      await t.mutation(internal.research.research.claimJob, { jobId });
      await t.mutation(internal.research.research.settleJob, {
        jobId,
        status,
        message: "Controlled provider failure",
      });
      await ready(t);
      const messages = value(
        await alice.query(api.messages.listMessages, { roomId }),
      ).filter((row) => row.authorKind === "buyer_agent");
      expect(messages).toHaveLength(1);
      expect(messages[0]?.body).toContain(
        status === "failed"
          ? "did not return usable results"
          : "still uncertain",
      );
      expect(fetcher).not.toHaveBeenCalled();
      expect(
        await t.run((ctx) => ctx.db.query("researchJobs").collect()),
      ).toHaveLength(1);
    },
  );

  it("does not interrupt a newer human conversation with an old research follow-up", async () => {
    const { t, alice, roomId, clueId } = await setup();
    const { jobId } = value(
      await alice.mutation(api.research.research.startResearch, {
        roomId,
        publishedClueIds: [clueId],
        idempotencyKey: "research",
      }),
    );
    await t.mutation(internal.research.research.claimJob, { jobId });
    await alice.mutation(api.messages.sendMessage, {
      roomId,
      body: "Let's discuss this ourselves first",
      clientIdempotencyKey: "newer",
    });
    await t.mutation(internal.research.research.completeJob, {
      jobId,
      raw: fixture.pages,
      retrievedAt: fixture.retrievedAt,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(jobId)))?.continuationAgentJobId,
    ).toBeUndefined();
  });

  it("marks an already queued continuation stale after newer chat or listing invalidation", async () => {
    const { t, alice, roomId, clueId } = await setup();
    const { jobId } = value(
      await alice.mutation(api.research.research.startResearch, {
        roomId,
        publishedClueIds: [clueId],
        idempotencyKey: "research",
      }),
    );
    await t.mutation(internal.research.research.claimJob, { jobId });
    await t.mutation(internal.research.research.completeJob, {
      jobId,
      raw: fixture.pages,
      retrievedAt: fixture.retrievedAt,
    });
    const continuationId = (await t.run((ctx) => ctx.db.get(jobId)))!
      .continuationAgentJobId!;
    const work = (await t.mutation(internal.agents.runtime.claimJob, {
      jobId: continuationId,
      kind: "evaluate_thread",
    }))!;
    const decision = recommendation(work.snapshot!);
    const listingId = await t.run(
      async (ctx) =>
        (await ctx.db.query("productListings").collect()).find(
          (row) => row._id === decision.citations.listingIds[0],
        )!._id,
    );
    await t.run((ctx) => ctx.db.patch(listingId, { status: "invalid" }));
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId: continuationId,
      attempt: work.attempt,
      decision,
    });
    expect((await t.run((ctx) => ctx.db.get(continuationId)))?.status).toBe(
      "stale",
    );
    expect(
      value(await alice.query(api.messages.listMessages, { roomId })),
    ).toEqual([]);
  });

  it("does not continue after its acting member is removed", async () => {
    const { t, alice, roomId, clueId, participantId } = await setup();
    const { jobId } = value(
      await alice.mutation(api.research.research.startResearch, {
        roomId,
        publishedClueIds: [clueId],
        idempotencyKey: "research",
      }),
    );
    await t.mutation(internal.research.research.claimJob, { jobId });
    await t.run((ctx) => ctx.db.delete(participantId));
    await t.mutation(internal.research.research.completeJob, {
      jobId,
      raw: fixture.pages,
      retrievedAt: fixture.retrievedAt,
    });
    expect(
      (await t.run((ctx) => ctx.db.get(jobId)))?.continuationAgentJobId,
    ).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("agentJobs").collect())).toEqual(
      [],
    );
  });

  it("expires a lost research worker into exactly one truthful, non-model continuation", async () => {
    const { t, alice, roomId, clueId } = await setup();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { jobId } = value(
      await alice.mutation(api.research.research.startResearch, {
        roomId,
        publishedClueIds: [clueId],
        idempotencyKey: "watchdog",
      }),
    );
    await t.mutation(internal.research.research.claimJob, { jobId });
    await t.mutation(internal.research.research.expireJob, { jobId });
    await t.mutation(internal.research.research.expireJob, { jobId });
    await ready(t);
    expect(
      await t.run((ctx) => ctx.db.query("agentJobs").collect()),
    ).toHaveLength(1);
    expect(
      value(await alice.query(api.messages.listMessages, { roomId })).filter(
        (row) => row.authorKind === "buyer_agent",
      ),
    ).toHaveLength(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects external-work intents on automatic follow-ups instead of looping", async () => {
    const { t, alice, roomId, clueId } = await setup();
    configureModel();
    const { jobId } = value(
      await alice.mutation(api.research.research.startResearch, {
        roomId,
        publishedClueIds: [clueId],
        idempotencyKey: "research",
      }),
    );
    await t.mutation(internal.research.research.claimJob, { jobId });
    await t.mutation(internal.research.research.completeJob, {
      jobId,
      raw: fixture.pages,
      retrievedAt: fixture.retrievedAt,
    });
    const continuationId = (await t.run((ctx) => ctx.db.get(jobId)))!
      .continuationAgentJobId!;
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId: continuationId,
      kind: "evaluate_thread",
    });
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId: continuationId,
      attempt: 1,
      decision: {
        intent: "search",
        rationale: "Search again",
        needsFollowup: false,
        searchBrief: {
          roomId,
          knowledgeRevision: 1,
          queryTerms: ["pottery"],
          mustExclude: [],
          listingLimit: 6,
        },
      },
    });
    expect(
      await t.run((ctx) => ctx.db.query("researchJobs").collect()),
    ).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(continuationId)))?.status).toBe(
      "succeeded",
    );
  });
});

describe("cached replanning and user replies", () => {
  it("debounces new ownership clues, drops the duplicate, and updates the shortlist without another source call", async () => {
    const { t, alice, roomId, clueId } = await setup();
    configureModel();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, options) => {
        const payload = JSON.parse(String(options?.body)) as {
          messages: Array<{ content: string }>;
        };
        const { snapshot } = JSON.parse(payload.messages[1]!.content) as {
          snapshot: BuyerSnapshot;
        };
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(recommendation(snapshot)) },
            },
          ],
        });
      });
    vi.stubGlobal("fetch", fetcher);
    const { jobId } = value(
      await alice.mutation(api.research.research.startResearch, {
        roomId,
        publishedClueIds: [clueId],
        idempotencyKey: "research",
      }),
    );
    await t.mutation(internal.research.research.claimJob, { jobId });
    const raw = structuredClone(fixture.pages);
    raw[0]!.shopping_results[0]!.title = "Complete Pottery Starter Kit";
    await t.mutation(internal.research.research.completeJob, {
      jobId,
      raw,
      retrievedAt: fixture.retrievedAt,
    });
    await ready(t);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await alice.mutation(api.clues.upsertManualPreference, {
      roomId,
      kind: "ownership",
      text: "Already owns a starter kit",
    });
    await alice.mutation(api.clues.upsertManualPreference, {
      roomId,
      kind: "exclusion",
      text: "No pink",
    });
    await vi.advanceTimersByTimeAsync(400);
    await t.finishInProgressScheduledFunctions();
    await ready(t);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const result = value(
      await alice.query(api.research.research.listRecommendations, { roomId }),
    );
    expect(
      result.listings.some(
        (row) => row.title === "Complete Pottery Starter Kit",
      ),
    ).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.query("researchJobs").collect()),
    ).toHaveLength(1);
    const jobs = await t.run((ctx) => ctx.db.query("agentJobs").collect());
    expect(
      jobs.filter(
        (job) => job.trigger === "knowledge_changed" && job.status === "stale",
      ),
    ).toHaveLength(1);
    const messages = value(
      await alice.query(api.messages.listMessages, { roomId }),
    );
    expect(messages.at(-1)?.body).toContain("updated clues");
    expect(messages.at(-1)?.body).not.toContain("Complete Pottery Starter Kit");
    expect(
      messages
        .at(-1)
        ?.citations?.listingIds.every((id) =>
          result.listings.some((row) => row.id === id),
        ),
    ).toBe(true);
  });

  it("closes explicitly targeted chat answers and preserves answer idempotency after later messages", async () => {
    const { t, alice, roomId } = await setup();
    const turn = value(
      await alice.mutation(api.agents.buyer.requestTurn, {
        roomId,
        mode: "auto",
      }),
    );
    await t.mutation(internal.agents.runtime.claimJob, {
      jobId: turn.jobId,
      kind: "evaluate_thread",
    });
    await t.mutation(internal.agents.runtime.completeTurn, {
      jobId: turn.jobId,
      attempt: 1,
      decision: {
        intent: "clarify",
        clarifySlot: "direction",
        chatMessage: "Would she enjoy a class?",
        rationale: "Need direction",
        needsFollowup: false,
      },
    });
    const answered = value(
      await alice.mutation(api.messages.sendMessage, {
        roomId,
        body: "Yes, a class",
        replyToSlot: "direction",
        clientIdempotencyKey: "reply",
      }),
    );
    expect(answered.replyToSlot).toBe("direction");
    expect(answered.responseAgentJobId).toBeTruthy();
    expect(
      (await t.run((ctx) => ctx.db.query("askedSlots").first()))?.status,
    ).toBe("answered");
    expect(
      await alice.mutation(api.messages.sendMessage, {
        roomId,
        body: "Another answer",
        replyToSlot: "direction",
        clientIdempotencyKey: "reply2",
      }),
    ).toMatchObject({ ok: false });
    await t.run(async (ctx) => {
      const question = (await ctx.db.query("askedSlots").first())!;
      await ctx.db.patch(question._id, { status: "open" });
    });
    const args = {
      roomId,
      slot: "direction",
      body: "Bring two friends",
      clientIdempotencyKey: "form-answer",
    };
    const first = value(
      await alice.mutation(api.agents.buyer.answerQuestion, args),
    );
    await alice.mutation(api.messages.sendMessage, {
      roomId,
      body: "I will check dates",
      clientIdempotencyKey: "later",
    });
    const before = await t.run((ctx) => ctx.db.query("agentJobs").collect());
    expect(
      value(await alice.mutation(api.agents.buyer.answerQuestion, args)),
    ).toEqual(first);
    expect(
      await t.run((ctx) => ctx.db.query("agentJobs").collect()),
    ).toHaveLength(before.length);
    expect(
      await alice.mutation(api.agents.buyer.answerQuestion, {
        ...args,
        body: "Different payload",
      }),
    ).toMatchObject({ ok: false });
  });
});
