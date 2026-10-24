import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { decideBuyer, shouldEvaluate, validateDecision, type BuyerSnapshot } from "./engine";
import { renderReply } from "./presentation";
import { verifyListing, verifyReplyText } from "./verify";

const NOW = Date.UTC(2026, 9, 24);
const listing = (over: Partial<BuyerSnapshot["listings"][number]> = {}) => ({
  id: "l1",
  title: "Pottery Starter Kit",
  currency: "USD",
  priceMinor: 4500,
  priceStatus: "observed" as const,
  availability: "in_stock" as const,
  shippingStatus: "unknown" as const,
  sourceUrl: "https://shop.example/kit",
  retrievedAt: NOW,
  ...over,
});
function snapshot(over: Partial<BuyerSnapshot> = {}): BuyerSnapshot {
  return {
    roomId: "room",
    jobId: "job",
    recipientDisplayName: "Maya",
    occasion: "birthday",
    knowledgeRevision: 2,
    budgetMinor: 6000,
    mode: "quiet",
    trigger: "human",
    recipientAgentEnabled: false,
    recentMessages: [{ id: "m1", author: "participant", text: "@unwrap why not the kit?" }],
    publishedClues: [
      { id: "c1", kind: "interest", text: "Wants a pottery class" },
      { id: "c2", kind: "ownership", text: "Already owns a starter kit" },
    ],
    askedSlots: [],
    listings: [listing(), listing({ id: "l2", title: "Pottery class", priceMinor: 5500 })],
    recommendations: [],
    researchRunning: false,
    ...over,
  };
}
const reply = (over: Record<string, unknown> = {}) => ({
  intent: "reply",
  rationale: "Answer follow-up",
  needsFollowup: false,
  chatMessage: "The kit was dropped because Maya already owns one.",
  citations: { listingIds: ["l1"], publishedClueIds: ["c2"] },
  ...over,
});

describe("verifyListing", () => {
  it("drops unavailable, over-budget and non-USD listings", () => {
    expect(verifyListing(listing({ availability: "unavailable" }), {})).toMatchObject({ status: "drop" });
    expect(verifyListing(listing({ priceMinor: 6001 }), { budgetMinor: 6000 })).toMatchObject({ status: "drop" });
    expect(verifyListing(listing({ currency: "EUR" }), {})).toMatchObject({ status: "drop" });
    expect(verifyListing(listing(), { budgetMinor: 6000, now: NOW })).toEqual({ status: "ok" });
  });
  it("flags stale, unconfirmed and shipping-over-budget listings instead of dropping them", () => {
    expect(
      verifyListing(listing({ retrievedAt: NOW - 8 * 86_400_000 }), { now: NOW }),
    ).toMatchObject({ status: "flag", notes: ["Price was observed more than a week ago."] });
    expect(verifyListing(listing({ priceStatus: "unknown", priceMinor: undefined }), { now: NOW })).toMatchObject({
      status: "flag",
      notes: ["Price could not be confirmed."],
    });
    expect(
      verifyListing(listing({ shippingStatus: "observed", shippingMinor: 2000, priceMinor: 5000 }), {
        budgetMinor: 6000,
        now: NOW,
      }),
    ).toMatchObject({ status: "flag", notes: ["With shipping this is over the room budget."] });
    expect(verifyListing(listing({ availability: "unknown" }), { now: NOW })).toMatchObject({
      status: "flag",
    });
  });
});

describe("verifyReplyText", () => {
  const s = snapshot();
  it("allows amounts that match a stored record and rejects invented ones", () => {
    expect(verifyReplyText("The class at $55.00 is pricier than the $45 kit.", s)).toEqual({ ok: true });
    expect(verifyReplyText("It is only $39 right now.", s)).toMatchObject({ ok: false });
    expect(verifyReplyText("About 20 dollars", s)).toMatchObject({ ok: false });
  });
  it("rejects links and availability or promotion claims", () => {
    expect(verifyReplyText("See https://shop.example", s)).toMatchObject({ ok: false });
    expect(verifyReplyText("It is in stock", s)).toMatchObject({ ok: false });
    expect(verifyReplyText("It's 20% off today", s)).toMatchObject({ ok: false });
    expect(verifyReplyText("Because she already owns one.", s)).toEqual({ ok: true });
  });
});

describe("reply decisions", () => {
  it("accepts a grounded reply and keeps only real ids", () => {
    const decision = validateDecision(
      reply({ citations: { listingIds: ["l1", "ghost"], publishedClueIds: ["c2", "nope"] } }) as never,
      snapshot(),
    );
    expect(decision).toMatchObject({ intent: "reply", citations: { listingIds: ["l1"], publishedClueIds: ["c2"] } });
  });
  it("replaces unverifiable wording with record-based facts, or stays silent when nothing is cited", () => {
    const withCitation = validateDecision(reply({ chatMessage: "It costs $12 and is in stock!" }) as never, snapshot());
    expect(withCitation).toMatchObject({ intent: "reply", chatMessage: expect.stringContaining("observed facts") });
    const uncited = validateDecision(
      reply({ chatMessage: "It costs $12.", citations: { listingIds: [], publishedClueIds: [] } }) as never,
      snapshot(),
    );
    expect(uncited.intent).toBe("listen");
  });
  it("turns leaked ids into readable titles and clue text", () => {
    const decision = validateDecision(
      reply({ chatMessage: "l1 was dropped because c2, unlike l2." }) as never,
      snapshot(),
    );
    expect(decision).toMatchObject({
      chatMessage:
        "“Pottery Starter Kit” was dropped because “Already owns a starter kit”, unlike “Pottery class”.",
    });
  });
  it("never chats on automatic continuations", () => {
    expect(validateDecision(reply() as never, snapshot({ trigger: "knowledge_changed" })).intent).toBe("listen");
  });
  it("renders facts from the record, never the model's numbers", () => {
    const decision = validateDecision(reply({ chatMessage: "The class is $55." }) as never, snapshot());
    if (decision.intent !== "reply") throw new Error("expected reply");
    const rendered = renderReply({ ...decision, citations: { listingIds: ["l2"], publishedClueIds: [] } }, snapshot());
    expect(rendered.body).toContain("$55.00 observed item price");
    expect(rendered.body).toContain("Availability: in_stock");
    expect(rendered.citations.listingIds).toEqual(["l2"]);
  });
});

describe("chatty mode", () => {
  const chatty = (over: Partial<BuyerSnapshot> = {}) =>
    snapshot({
      chatty: true,
      secondsSinceAgentMessage: 120,
      recentMessages: [{ id: "m1", author: "participant", text: "which is cheaper, the kit or the class?" }],
      ...over,
    });
  it("joins in only when enabled, the last voice is human, and the agent has been quiet", () => {
    expect(shouldEvaluate(chatty())).toBe(true);
    expect(shouldEvaluate(chatty({ chatty: false }))).toBe(false);
    expect(shouldEvaluate(chatty({ secondsSinceAgentMessage: 5 }))).toBe(false);
    expect(
      shouldEvaluate(
        chatty({
          recentMessages: [
            { id: "m1", author: "participant", text: "hello" },
            { id: "m2", author: "buyer_agent", text: "hi" },
          ],
        }),
      ),
    ).toBe(false);
  });
  it("makes no model call when it should stay out", async () => {
    const model = vi.fn();
    const result = await decideBuyer(chatty({ chatty: false }), model);
    expect(result.intent).toBe("listen");
    expect(model).not.toHaveBeenCalled();
  });
  it("allows an unprompted reply but turns any other intent into silence", async () => {
    const model = vi.fn().mockResolvedValueOnce(reply());
    expect((await decideBuyer(chatty(), model)).intent).toBe("reply");
    const search = {
      intent: "search",
      rationale: "x",
      needsFollowup: false,
      searchBrief: {
        roomId: "room",
        knowledgeRevision: 2,
        queryTerms: ["pottery"],
        mustExclude: [],
        listingLimit: 6,
      },
    };
    const model2 = vi.fn().mockResolvedValue(search);
    expect((await decideBuyer(chatty(), model2)).intent).toBe("listen");
    expect(model2).toHaveBeenCalledTimes(1);
  });
  it("does not push an unprompted turn to act", async () => {
    const model = vi.fn().mockResolvedValue({ intent: "listen", rationale: "nothing to add", needsFollowup: false });
    await decideBuyer(chatty(), model);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("tells the model whether it was invited", async () => {
    const model = vi.fn().mockResolvedValue(reply());
    await decideBuyer(chatty(), model);
    expect(model.mock.calls[0]![0].input.invited).toBe(false);
  });
});

describe("citation recovery", () => {
  const recSnapshot = () =>
    snapshot({
      mode: "auto",
      trigger: "knowledge_changed",
      recommendations: [
        { listingId: "l2", publishedClueIds: ["c1"], explanation: "x" },
      ],
    });
  const bad = {
    intent: "recommend",
    rationale: "x",
    needsFollowup: false,
    chatMessage: "Here",
    citations: { listingIds: ["l1"], publishedClueIds: ["c1"] },
  };
  it("corrects the model once, then builds the answer from the ranked records", async () => {
    const model = vi.fn().mockResolvedValue(bad);
    const result = await decideBuyer(recSnapshot(), model);
    expect(model).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      intent: "recommend",
      citations: { listingIds: ["l2"], publishedClueIds: ["c1"] },
    });
  });
  it("accepts the corrected answer without the fallback", async () => {
    const good = { ...bad, citations: { listingIds: ["l2"], publishedClueIds: ["c1"] } };
    const model = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    expect(await decideBuyer(recSnapshot(), model)).toMatchObject({
      citations: { listingIds: ["l2"] },
    });
  });
  it("still fails when there is nothing grounded to fall back on", async () => {
    const model = vi.fn().mockResolvedValue(bad);
    await expect(
      decideBuyer({ ...recSnapshot(), trigger: "human", recommendations: [] }, model),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("recommendation verification", () => {
  it("drops an over-budget candidate and stays silent when none pass", () => {
    const base = snapshot({
      mode: "auto",
      recommendations: [
        { listingId: "l1", publishedClueIds: ["c1"], explanation: "x" },
        { listingId: "l2", publishedClueIds: ["c1"], explanation: "x" },
      ],
    });
    const recommend = (ids: string[]) =>
      ({
        intent: "recommend",
        rationale: "x",
        needsFollowup: false,
        chatMessage: "Here you go",
        citations: { listingIds: ids, publishedClueIds: ["c1"] },
      }) as never;
    const over = { ...base, listings: [listing({ priceMinor: 9000 }), listing({ id: "l2", priceMinor: 5500 })] };
    expect(validateDecision(recommend(["l1", "l2"]), over)).toMatchObject({
      intent: "recommend",
      citations: { listingIds: ["l2"] },
    });
    expect(validateDecision(recommend(["l1"]), over).intent).toBe("listen");
  });
});

describe("keep-chatting room (end to end)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function room() {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const roomId = await ctx.db.insert("rooms", {
        title: "Maya", recipientDisplayName: "Maya", occasion: "birthday", currency: "USD",
        budgetMinor: 6000, knowledgeRevision: 1, inviteToken: "tok", createdBy: "alice", createdAt: 0,
      });
      const alice = await ctx.db.insert("participants", {
        roomId, userId: "alice", displayName: "Alice", role: "organizer", joinedAt: 0,
      });
      await ctx.db.insert("participants", {
        roomId, userId: "bob", displayName: "Bob", role: "contributor", joinedAt: 0,
      });
      const clueId = await ctx.db.insert("publishedClues", {
        roomId, publisherId: alice, kind: "interest", text: "pottery", sourceKind: "manual",
        sourceMessageIds: [], status: "active", publishedAt: 0,
      });
      return { roomId, clueId };
    });
    return { t, ids, alice: t.withIdentity({ subject: "alice" }), bob: t.withIdentity({ subject: "bob" }) };
  }
  const ok = <T,>(r: { ok: true; value: T } | { ok: false; error: unknown }) => {
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  };

  it("only the organizer can turn it on", async () => {
    const { ids, alice, bob } = await room();
    expect(await bob.mutation(api.agents.buyer.setChatMode, { roomId: ids.roomId, mode: "chatty" })).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    ok(await alice.mutation(api.agents.buyer.setChatMode, { roomId: ids.roomId, mode: "chatty" }));
    const bobView = ok(await bob.query(api.agents.buyer.listActivity, { roomId: ids.roomId }));
    expect(bobView.capabilities).toMatchObject({ chatMode: "chatty", canSetChatMode: false });
  });

  it("stays silent in quiet mode and replies, with record facts, once chatty", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
    vi.stubEnv("LLM_API_KEY", "test");
    vi.stubEnv("LLM_MODEL", "test");
    const { t, ids, alice, bob } = await room();
    const fetcher = vi.fn().mockImplementation(async (_url: unknown, options: { body: string }) => {
      const { snapshot } = JSON.parse(JSON.parse(options.body).messages[1].content) as { snapshot: BuyerSnapshot };
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                intent: "reply",
                rationale: "Answer",
                needsFollowup: false,
                chatMessage: "Both fit the pottery clue, and the class costs $1.",
                citations: { listingIds: [], publishedClueIds: [snapshot.publishedClues[0]!.id] },
              }),
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetcher);

    ok(await bob.mutation(api.messages.sendMessage, { roomId: ids.roomId, body: "which is cheaper?", clientIdempotencyKey: "a" }));
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(fetcher).not.toHaveBeenCalled();

    ok(await alice.mutation(api.agents.buyer.setChatMode, { roomId: ids.roomId, mode: "chatty" }));
    ok(await bob.mutation(api.messages.sendMessage, { roomId: ids.roomId, body: "so is the class cheaper?", clientIdempotencyKey: "b" }));
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(fetcher).toHaveBeenCalledTimes(1);

    const agentMessages = ok(await alice.query(api.messages.listMessages, { roomId: ids.roomId })).filter(
      (m) => m.authorKind === "buyer_agent",
    );
    // The model invented "$1" with nothing cited, so the reply is withheld rather than posted.
    expect(agentMessages).toHaveLength(0);
    const jobs = await t.run((ctx) => ctx.db.query("agentJobs").collect());
    expect(jobs.at(-1)).toMatchObject({ status: "succeeded" });
  });

  it("posts a grounded unprompted reply with its citations", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
    vi.stubEnv("LLM_API_KEY", "test");
    vi.stubEnv("LLM_MODEL", "test");
    const { t, ids, alice, bob } = await room();
    const fetcher = vi.fn().mockImplementation(async (_url: unknown, options: { body: string }) => {
      const { snapshot } = JSON.parse(JSON.parse(options.body).messages[1].content) as { snapshot: BuyerSnapshot };
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                intent: "reply",
                rationale: "Answer",
                needsFollowup: false,
                chatMessage: "Pottery is a confirmed interest, so a class fits.",
                citations: { listingIds: [], publishedClueIds: [snapshot.publishedClues[0]!.id] },
              }),
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetcher);
    ok(await alice.mutation(api.agents.buyer.setChatMode, { roomId: ids.roomId, mode: "chatty" }));
    ok(await bob.mutation(api.messages.sendMessage, { roomId: ids.roomId, body: "would a class fit her?", clientIdempotencyKey: "c" }));
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const messages = ok(await alice.query(api.messages.listMessages, { roomId: ids.roomId }));
    const said = messages.filter((m) => m.authorKind === "buyer_agent");
    expect(said).toHaveLength(1);
    expect(said[0]!.body).toBe("Pottery is a confirmed interest, so a class fits.");
    expect(said[0]!.citations?.publishedClueIds).toEqual([ids.clueId]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("room model budget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  it("refuses new agent turns once the hourly ceiling is reached, and recovers as jobs age out", async () => {
    vi.stubEnv("AGENT_MAX_JOBS_PER_ROOM_HOUR", "2");
    const t = convexTest(schema, modules);
    const roomId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("rooms", {
        title: "R", recipientDisplayName: "Maya", occasion: "b", currency: "USD",
        knowledgeRevision: 0, inviteToken: "t", createdBy: "alice", createdAt: 0,
      });
      await ctx.db.insert("participants", { roomId: id, userId: "alice", displayName: "A", role: "organizer", joinedAt: 0 });
      return id;
    });
    const alice = t.withIdentity({ subject: "alice" });
    const spend = (createdAt: number) =>
      t.run((ctx) =>
        ctx.db.insert("agentJobs", {
          roomId, kind: "evaluate_thread", status: "succeeded", attempt: 1, inputHash: String(createdAt),
          idempotencyKey: `k${createdAt}`, createdAt,
          modelUsage: { calls: 1, reportedCalls: 1, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningTokens: 0 },
        }),
      );
    const now = Date.now();
    await spend(now - 1000);
    await spend(now - 2000);
    expect(await alice.mutation(api.agents.buyer.requestTurn, { roomId, mode: "auto" })).toMatchObject({
      ok: false,
      error: { code: "refused" },
    });
    // Spend ages out of the rolling hour.
    vi.setSystemTime(now + 61 * 60 * 1000);
    const again = await alice.mutation(api.agents.buyer.requestTurn, { roomId, mode: "auto" });
    expect(again.ok).toBe(true);
  });
});
