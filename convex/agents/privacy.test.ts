import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";

const SECRETS = [
  "PRIVATE-IMPORT-TEXT-91",
  "PRIVATE-PROPOSED-CLUE-92",
  "PRIVATE-PHOTO-OBSERVATION-93",
  "PRIVATE-RECIPIENT-PREFERENCE-94",
  "PRIVATE-INVITE-TOKEN-95",
  "7654321", // a contribution cap in minor units
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("what the buyer model can see", () => {
  it("never receives private imports, unpublished clues, photo rows, recipient raw text, caps or the invite token", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
    vi.stubEnv("LLM_API_KEY", "test");
    vi.stubEnv("LLM_MODEL", "test");
    vi.stubEnv("RECIPIENT_AGENT_DEMO_ENABLED", "true");
    const t = convexTest(schema, modules);
    const roomId = await t.run(async (ctx) => {
      const room = await ctx.db.insert("rooms", {
        title: "Maya", recipientDisplayName: "Maya", occasion: "birthday", currency: "USD",
        budgetMinor: 6000, knowledgeRevision: 1, inviteToken: "PRIVATE-INVITE-TOKEN-95",
        agentChatMode: "chatty", createdBy: "alice", createdAt: 0,
      });
      const alice = await ctx.db.insert("participants", { roomId: room, userId: "alice", displayName: "Alice", role: "organizer", joinedAt: 0 });
      const bob = await ctx.db.insert("participants", { roomId: room, userId: "bob", displayName: "Bob", role: "contributor", joinedAt: 0 });
      await ctx.db.insert("publishedClues", {
        roomId: room, publisherId: alice, kind: "interest", text: "pottery", sourceKind: "manual",
        sourceMessageIds: [], status: "active", publishedAt: 0,
      });
      // Bob's private evidence, an unpublished proposal derived from it, and a photo observation row.
      const source = await ctx.db.insert("evidenceSources", { roomId: room, participantId: bob, kind: "paste", label: "private", sourceRevision: 1, createdAt: 0 });
      const photo = await ctx.db.insert("evidenceSources", {
        roomId: room, participantId: bob, kind: "photo", label: "photos", sourceRevision: 1, createdAt: 0,
        media: { count: 1, status: "read" },
      });
      const msg = await ctx.db.insert("privateMessages", { sourceId: source, participantId: bob, body: "PRIVATE-IMPORT-TEXT-91" });
      await ctx.db.insert("privateMessages", { sourceId: photo, participantId: bob, body: "PRIVATE-PHOTO-OBSERVATION-93", mediaIndex: 0 });
      await ctx.db.insert("proposedClues", {
        roomId: room, participantId: bob, sourceId: source, sourceMessageIds: [msg], kind: "interest",
        text: "PRIVATE-PROPOSED-CLUE-92", confidence: 0.9, speakerAssumption: "unknown",
        contradictsClueIds: [], status: "proposed", createdAt: 0,
      });
      await ctx.db.insert("contributionLimits", { roomId: room, participantId: bob, amountMinor: 7654321, updatedAt: 0 });
      const profile = await ctx.db.insert("recipientProfiles", { roomId: room, ownerUserId: "alice", revision: 1, createdAt: 0 });
      await ctx.db.patch(room, { recipientProfileId: profile });
      await ctx.db.insert("recipientPreferences", {
        recipientProfileId: profile, category: "interest", text: "PRIVATE-RECIPIENT-PREFERENCE-94",
        disclosable: true, authorized: true, createdAt: 0,
      });
      return room;
    });

    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: unknown, options: { body: string }) => {
        bodies.push(options.body);
        return Response.json({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ intent: "listen", rationale: "nothing to add", needsFollowup: false }) } }],
        });
      }),
    );
    const alice = t.withIdentity({ subject: "alice" });
    const send = (body: string, key: string) =>
      alice.mutation(api.messages.sendMessage, { roomId, body, clientIdempotencyKey: key });
    // An addressed turn, an unaddressed chatty turn, and Ask Unwrap: every route to a model call.
    await send("@unwrap what should we get her?", "a");
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await send("is a class better than a kit?", "b");
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await alice.mutation(api.agents.buyer.requestTurn, { roomId, mode: "auto" });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) for (const secret of SECRETS) expect(body).not.toContain(secret);
    // The one thing it should see is what the room published.
    expect(bodies.some((b) => b.includes("pottery"))).toBe(true);
  });
});
