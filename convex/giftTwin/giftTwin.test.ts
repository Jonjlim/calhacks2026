// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { splitIntoUploadBatches, TWIN_LIMITS, type VaultMessage } from "../../lib/agentCollaborators/contracts";
import { sampleChat } from "../../lib/agentCollaborators/fixture";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { purgeRoomStep } from "../lib/roomPurge";
import schema from "../schema";
import { modules } from "../test.setup";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const TOKEN = "test-device-token-maya-macbook-0000000000";
const OTHER_TOKEN = "test-device-token-other-device-111111111";
const moss = vi.hoisted(() => ({
  addDocs: vi.fn().mockResolvedValue({ added: 1, updated: 0 }),
  query: vi.fn().mockResolvedValue({ docs: [], query: "" }),
  close: vi.fn().mockResolvedValue(undefined),
  session: vi.fn(),
}));
vi.mock("@moss-js/moss", () => ({ MossClient: class {
  session = moss.session;
  close = moss.close;
} }));
const MAYA: VaultMessage[] = sampleChat(Date.UTC(2026, 9, 24))
  .filter((m) => m.fromMe)
  .map(({ text, sentAt }) => ({ text, sentAt }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GIFT_TWIN_DEMO_ENABLED", "true");
  // No model in tests: the twin agent and the gift agent use their deterministic paths.
  vi.stubEnv("LLM_BASE_URL", "");
  vi.stubEnv("GIFT_TWIN_MOSS_ENABLED", "");
  moss.session.mockReset().mockResolvedValue({ addDocs: moss.addDocs, query: moss.query });
  moss.addDocs.mockClear();
  moss.query.mockClear();
  moss.close.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "user_alice|s1" });
  const bob = t.withIdentity({ subject: "user_bob|s2" });
  const mallory = t.withIdentity({ subject: "user_mallory|s3" });
  const created = unwrap(
    await alice.mutation(api.rooms.createRoom, { title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alice" }),
  );
  const roomId = created.room._id;
  unwrap(await bob.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Bob" }));
  return { t, alice, bob, mallory, roomId };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

async function paired() {
  const ctx = await setup();
  const issued = unwrap(await ctx.alice.action(api.giftTwin.room.createPairing, { roomId: ctx.roomId }));
  const session = unwrap(
    await ctx.t.mutation(api.giftTwin.device.pair, { pairingCode: issued.pairingCode.toLowerCase(), deviceToken: TOKEN, deviceLabel: "Maya's MacBook" }),
  );
  return { ...ctx, issued, session };
}

/** Runs what is due now: the agent pass, then the gift agent's review. */
async function settle(t: T) {
  for (let i = 0; i < 4; i++) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

async function share(t: T, messages: VaultMessage[] = MAYA) {
  const started = unwrap(await t.mutation(api.giftTwin.device.startUpload, { deviceToken: TOKEN, consent: true }));
  for (const batch of splitIntoUploadBatches(messages))
    unwrap(await t.mutation(api.giftTwin.device.uploadMessages, { deviceToken: TOKEN, uploadId: started.uploadId, messages: batch }));
  const done = unwrap(await t.mutation(api.giftTwin.device.finishUpload, { deviceToken: TOKEN, uploadId: started.uploadId }));
  await settle(t);
  return { ...started, ...done };
}

async function seedClue(t: T, roomId: Awaited<ReturnType<typeof setup>>["roomId"], text: string) {
  return t.run(async (ctx) => {
    const bobP = (await ctx.db.query("participants").collect()).find((p) => p.displayName === "Bob")!;
    return ctx.db.insert("publishedClues", {
      roomId, publisherId: bobP._id, kind: "interest", text, sourceKind: "manual", sourceMessageIds: [], status: "active", publishedAt: Date.now(),
    });
  });
}

const chunkCount = (t: T) => t.run(async (ctx) => (await ctx.db.query("twinVaultChunks").collect()).length);

describe("pairing", () => {
  it("is refused while the demo flag is off", async () => {
    const { alice, roomId } = await setup();
    vi.stubEnv("GIFT_TWIN_DEMO_ENABLED", "");
    expect(await alice.action(api.giftTwin.room.createPairing, { roomId })).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  it("lets members issue a code but refuses outsiders", async () => {
    const { bob, mallory, roomId } = await setup();
    expect(await bob.action(api.giftTwin.room.createPairing, { roomId })).toMatchObject({ ok: true });
    expect(await mallory.action(api.giftTwin.room.createPairing, { roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("uses a code once, stores only hashes, and shows the twin as a collaborator", async () => {
    const { t, bob, issued, roomId, session } = await paired();
    expect(issued.pairingCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(session).toMatchObject({ recipientDisplayName: "Maya", occasion: "Birthday", status: "active" });
    expect(await t.mutation(api.giftTwin.device.pair, { pairingCode: issued.pairingCode, deviceToken: OTHER_TOKEN })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    const rows = await t.run((ctx) => ctx.db.query("agentCollaborators").collect());
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
    expect(JSON.stringify(rows)).not.toContain(issued.pairingCode);
    const feed = unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId }));
    expect(feed.collaborators).toEqual([expect.objectContaining({ displayName: "Maya's Gift Twin", status: "active", deviceLabel: "Maya's MacBook" })]);
    expect(JSON.stringify(feed)).not.toMatch(/Hash/);
  });

  it("rejects expired codes", async () => {
    const { t, alice, roomId } = await setup();
    const issued = unwrap(await alice.action(api.giftTwin.room.createPairing, { roomId }));
    vi.advanceTimersByTime(16 * 60_000);
    expect(await t.mutation(api.giftTwin.device.pair, { pairingCode: issued.pairingCode, deviceToken: TOKEN })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("refuses a second twin while one is connected", async () => {
    const { alice, roomId } = await paired();
    expect(await alice.action(api.giftTwin.room.createPairing, { roomId })).toMatchObject({ ok: false, error: { code: "refused" } });
  });

  it("keeps non-members out of the feed", async () => {
    const { mallory, roomId } = await paired();
    expect(await mallory.query(api.giftTwin.room.getFeed, { roomId })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });
});

describe("upload", () => {
  it("removes emoji sequences on the server while preserving words and plain digits", async () => {
    const { t } = await paired();
    const { uploadId } = unwrap(await t.mutation(api.giftTwin.device.startUpload, { deviceToken: TOKEN, consent: true }));
    const result = unwrap(await t.mutation(api.giftTwin.device.uploadMessages, {
      deviceToken: TOKEN, uploadId,
      messages: [
        { text: "I want 2 books 📚👩🏽‍💻🇺🇸1️⃣❤️", sentAt: 1 },
        { text: "😀👨‍👩‍👧‍👦👍🏽", sentAt: 2 },
        { text: "#1 costs $25 * 2", sentAt: 3 },
      ],
    }));
    expect(result.messageCount).toBe(2);
    const chunks = await t.run((ctx) => ctx.db.query("twinVaultChunks").collect());
    expect(chunks[0]?.messages).toEqual([
      { text: "I want 2 books", sentAt: 1 },
      { text: "#1 costs $25 * 2", sentAt: 3 },
    ]);
    expect(unwrap(await t.mutation(api.giftTwin.device.uploadMessages, {
      deviceToken: TOKEN, uploadId, messages: [{ text: "🎉", sentAt: 4 }],
    })).messageCount).toBe(2);
    expect(await chunkCount(t)).toBe(1);
  });

  it("enforces the 1 MiB vault limit using UTF-8 bytes across batches", async () => {
    const { t } = await paired();
    const { uploadId } = unwrap(await t.mutation(api.giftTwin.device.startUpload, { deviceToken: TOKEN, consent: true }));
    const messages = Array.from({ length: 40 }, () => ({ text: "界".repeat(2_000), sentAt: 1 }));
    for (let batch = 0; batch < 4; batch++) {
      expect(await t.mutation(api.giftTwin.device.uploadMessages, { deviceToken: TOKEN, uploadId, messages })).toMatchObject({ ok: true });
    }
    expect(await t.mutation(api.giftTwin.device.uploadMessages, { deviceToken: TOKEN, uploadId, messages })).toMatchObject({
      ok: false, error: { code: "validation_failed" },
    });
    expect(await chunkCount(t)).toBe(4);
  });

  it("needs explicit consent and the demo flag", async () => {
    const { t } = await paired();
    expect(await t.mutation(api.giftTwin.device.startUpload, { deviceToken: TOKEN, consent: false })).toMatchObject({ ok: false, error: { code: "refused" } });
    vi.stubEnv("GIFT_TWIN_DEMO_ENABLED", "");
    expect(await t.mutation(api.giftTwin.device.startUpload, { deviceToken: TOKEN, consent: true })).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(await chunkCount(t)).toBe(0);
  });

  it("enforces limits at the boundary and rejects unknown devices and stale uploads", async () => {
    const { t } = await paired();
    expect(await t.mutation(api.giftTwin.device.startUpload, { deviceToken: OTHER_TOKEN, consent: true })).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    const { uploadId } = unwrap(await t.mutation(api.giftTwin.device.startUpload, { deviceToken: TOKEN, consent: true }));
    const send = (messages: VaultMessage[], id = uploadId) => t.mutation(api.giftTwin.device.uploadMessages, { deviceToken: TOKEN, uploadId: id, messages });
    expect(await send([])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await send([{ text: "x".repeat(TWIN_LIMITS.messageMaxChars + 1), sentAt: 1 }])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await send([{ text: "   ", sentAt: 1 }])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await send([{ text: "hi", sentAt: 1 }], "not-this-upload")).toMatchObject({ ok: false, error: { code: "stale_job" } });
    expect(unwrap(await send([{ text: "I love matcha", sentAt: 1 }]))).toEqual({ messageCount: 1 });
    // A new upload replaces the old one.
    unwrap(await t.mutation(api.giftTwin.device.startUpload, { deviceToken: TOKEN, consent: true }));
    expect(await chunkCount(t)).toBe(0);
    expect(await send([{ text: "hi", sentAt: 1 }])).toMatchObject({ ok: false, error: { code: "stale_job" } });
  });
});

describe("cloud twin agent", () => {
  it("finds insights, votes on existing ideas, and the gift agent adds them without a human step", async () => {
    const { t, bob, roomId } = await paired();
    await seedClue(t, roomId, "Maya loves backpacking");
    await seedClue(t, roomId, "Maya likes matcha");
    await seedClue(t, roomId, "Golf lessons");
    const done = await share(t);
    expect(done.messageCount).toBe(MAYA.length);

    const feed = unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId }));
    expect(feed.collaborators[0]).toMatchObject({ reportedAt: expect.any(Number), vault: { status: "ready", messageCount: MAYA.length } });
    const votes = feed.posts.filter((p) => p.kind === "vote");
    expect(votes).toEqual(
      expect.arrayContaining([
        // The extractor already publishes this dislike as an insight; the
        // review step notes the downvote instead of duplicating the clue.
        expect.objectContaining({ vote: "down", ideaText: "Maya loves backpacking", status: "noted" }),
        expect.objectContaining({ vote: "up", ideaText: "Maya likes matcha", status: "noted" }),
      ]),
    );
    expect(votes.some((p) => p.ideaText === "Golf lessons")).toBe(false);
    const insights = feed.posts.filter((p) => p.kind === "insight").map((p) => p.text);
    expect(insights).toEqual(expect.arrayContaining(["Maya wants a hydration vest", "Maya doesn't like backpacking", "Maya doesn't like scented candles"]));

    const clues = await t.run((ctx) => ctx.db.query("publishedClues").collect());
    const organizer = (await t.run((ctx) => ctx.db.query("participants").collect())).find((p) => p.role === "organizer")!;
    expect(clues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "exclusion", text: "Maya doesn't like backpacking", publisherId: organizer._id })]));
    expect(clues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "explicit_wish", text: "Maya wants a hydration vest" })]));
    expect((await t.run((ctx) => ctx.db.get(roomId)))?.knowledgeRevision).toBeGreaterThan(0);
  });

  it("never exposes raw messages to the room or the device", async () => {
    const { t, bob, roomId } = await paired();
    await share(t);
    const feed = JSON.stringify(unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId })));
    const session = JSON.stringify(unwrap(await t.query(api.giftTwin.device.session, { deviceToken: TOKEN })));
    const clues = JSON.stringify(await t.run((ctx) => ctx.db.query("publishedClues").collect()));
    for (const leak of ["therapist", "Dipsea", "so tired", "uploadId", "checkedIdeaRefs"]) {
      expect(feed).not.toContain(leak);
      expect(session).not.toContain(leak);
    }
    expect(clues).not.toMatch(/therapist|Dipsea/);
    expect(await chunkCount(t)).toBeGreaterThan(0);
  });

  it("votes on ideas added later while the vault is open", async () => {
    const { t, bob, roomId } = await paired();
    await share(t);
    await seedClue(t, roomId, "Maya would love scented candles");
    vi.advanceTimersByTime(TWIN_LIMITS.watchIntervalMs);
    await t.finishInProgressScheduledFunctions();
    await settle(t);
    const feed = unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId }));
    expect(feed.posts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "vote", vote: "down", ideaText: "Maya would love scented candles" })]));
  });

  it("forget deletes the messages and stops voting; the notes stay", async () => {
    const { t, bob, roomId } = await paired();
    await share(t);
    const before = unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId })).posts.length;
    unwrap(await t.mutation(api.giftTwin.device.forget, { deviceToken: TOKEN }));
    expect(await chunkCount(t)).toBe(0);
    await seedClue(t, roomId, "Maya would love scented candles");
    vi.advanceTimersByTime(TWIN_LIMITS.watchIntervalMs);
    await t.finishInProgressScheduledFunctions();
    await settle(t);
    const feed = unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId }));
    expect(feed.posts.length).toBe(before);
    expect(feed.collaborators[0]?.vault).toEqual({ status: "expired", messageCount: MAYA.length });
  });

  it("deletes the messages when the vault expires", async () => {
    const { t, bob, roomId } = await paired();
    await share(t);
    vi.advanceTimersByTime(TWIN_LIMITS.vaultTtlMs + 1);
    await t.finishInProgressScheduledFunctions();
    expect(await chunkCount(t)).toBe(0);
    expect(unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId })).collaborators[0]?.vault?.status).toBe("expired");
  });

  it("revoking stops the device and deletes the messages", async () => {
    const { t, alice, bob, session, roomId } = await paired();
    const targetId = await seedClue(t, roomId, "Maya likes matcha");
    await share(t);
    expect(await bob.mutation(api.giftTwin.room.revokeCollaborator, { collaboratorId: session.collaboratorId as never })).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    unwrap(await alice.mutation(api.giftTwin.room.revokeCollaborator, { collaboratorId: session.collaboratorId as never }));
    expect(await chunkCount(t)).toBe(0);
    expect(await t.query(api.giftTwin.device.session, { deviceToken: TOKEN })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    const history = unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId }));
    expect(history.collaborators).toEqual([]);
    expect(history.posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "vote", ideaRef: `clue:${targetId}`, authorName: "Maya's Gift Twin" }),
      expect.objectContaining({ kind: "insight", authorName: "Maya's Gift Twin", publishedClueId: expect.any(String) }),
    ]));
    expect(JSON.stringify(history)).not.toMatch(/deviceTokenHash|pairingCodeHash|vaultUploadId|therapist/);
  });
});

describe("Moss memory and consent fences", () => {
  function enableMoss() {
    vi.stubEnv("GIFT_TWIN_MOSS_ENABLED", "true");
    vi.stubEnv("MOSS_PROJECT_ID", "test-project");
    vi.stubEnv("MOSS_PROJECT_KEY", "test-key");
  }

  it("routes initial and later idea evaluations through a private session and closes it", async () => {
    const { t, bob, roomId } = await paired();
    await seedClue(t, roomId, "Maya loves backpacking");
    enableMoss();
    await share(t);
    expect(moss.query).toHaveBeenCalledWith("Maya loves backpacking", { topK: 8, alpha: 0.8 });
    expect(moss.session).toHaveBeenCalledWith(expect.stringMatching(/^twin-[0-9a-f-]+$/));
    expect(moss.close).toHaveBeenCalledTimes(1);
    await seedClue(t, roomId, "Maya would love scented candles");
    vi.advanceTimersByTime(TWIN_LIMITS.watchIntervalMs);
    await t.finishInProgressScheduledFunctions();
    await settle(t);
    expect(moss.close).toHaveBeenCalledTimes(2);
    const feed = unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId }));
    expect(feed.posts).toEqual(expect.arrayContaining([expect.objectContaining({ vote: "down", ideaText: "Maya would love scented candles" })]));
    expect(JSON.stringify(feed)).not.toMatch(/test-key|vaultUploadId|therapist/);
  });

  it("continues evaluating from keywords when Moss setup fails, and still closes the client", async () => {
    const { t, bob, roomId } = await paired();
    await seedClue(t, roomId, "Maya loves backpacking");
    enableMoss();
    moss.session.mockRejectedValue(new Error("provider failure with private details"));
    await share(t);
    expect(moss.close).toHaveBeenCalledOnce();
    expect(unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId })).posts)
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "vote", vote: "down" })]));
  });

  it("discards in-flight recall when the recipient forgets the vault during indexing", async () => {
    const { t, bob, roomId } = await paired();
    await seedClue(t, roomId, "Maya loves backpacking");
    enableMoss();
    moss.addDocs.mockImplementationOnce(async () => {
      unwrap(await t.mutation(api.giftTwin.device.forget, { deviceToken: TOKEN }));
      return { added: 1, updated: 0 };
    });
    await share(t);
    expect(moss.close).toHaveBeenCalledOnce();
    expect(await chunkCount(t)).toBe(0);
    expect(unwrap(await bob.query(api.giftTwin.room.getFeed, { roomId })).posts).toEqual([]);
  });

  it("denies reads and findings at expiry even before the deletion job runs", async () => {
    const { t, session } = await paired();
    const upload = await share(t);
    const collaboratorId = session.collaboratorId as Id<"agentCollaborators">;
    const chunks = await t.run((ctx) => ctx.db.query("twinVaultChunks").collect());
    const chunkId = chunks[0]!._id;
    await t.run((ctx) => ctx.db.patch(collaboratorId, { vaultExpiresAt: Date.now() - 1 }));
    const args = { collaboratorId, uploadId: upload.uploadId };
    expect(await t.query(internal.giftTwin.agent.snapshot, args)).toBeNull();
    expect(await t.query(internal.giftTwin.agent.chunk, { ...args, chunkId })).toEqual([]);
    const before = await t.run((ctx) => ctx.db.query("agentCollaboratorPosts").collect());
    await t.mutation(internal.giftTwin.agent.recordFindings, { ...args, firstPass: false, checkedRefs: [], votes: [], insights: [{
      category: "wish", text: "Maya wants a camera", confidence: "high", evidenceCount: 1,
    }] });
    expect(await t.run((ctx) => ctx.db.query("agentCollaboratorPosts").collect())).toEqual(before);
    enableMoss();
    expect(await t.action(internal.giftTwin.memory.vote, args)).toEqual([]);
    expect(moss.session).not.toHaveBeenCalled();
  });
});

describe("room deletion", () => {
  it("purges collaborator rows and vaulted messages", async () => {
    const { t, roomId } = await paired();
    await share(t);
    await t.run(async (ctx) => {
      for (;;) if ((await purgeRoomStep(ctx, roomId, 500)).done) break;
    });
    const left = await t.run(async (ctx) => [
      ...(await ctx.db.query("agentCollaborators").collect()),
      ...(await ctx.db.query("agentCollaboratorPosts").collect()),
      ...(await ctx.db.query("twinVaultChunks").collect()),
    ]);
    expect(left).toEqual([]);
  });
});
