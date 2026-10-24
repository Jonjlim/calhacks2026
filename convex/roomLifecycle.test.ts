// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/** BE-017: room lifecycle (update, delete message, leave, cascade delete). */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../lib/contracts";
import { api, internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import { modules } from "./test.setup";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
function code<T>(result: Result<T>): string | null {
  return result.ok ? null : result.error.code;
}

async function insertListing(ctx: MutationCtx, roomId: Id<"rooms">) {
  const jobId = await ctx.db.insert("researchJobs", {
    roomId,
    knowledgeRevision: 0,
    publishedClueIds: [],
    status: "succeeded",
    inputHash: `h-${Math.random()}`,
    idempotencyKey: `k-${Math.random()}`,
    attempt: 1,
    createdAt: Date.now(),
  });
  return await ctx.db.insert("productListings", {
    roomId,
    jobId,
    source: "manual_fixture",
    sourceUrl: "https://example.com/wheel",
    title: "Mini pottery wheel",
    currency: "USD",
    priceMinor: 9000,
    priceStatus: "observed",
    availability: "in_stock",
    shippingStatus: "unknown",
    retrievedAt: Date.now(),
    status: "active",
  });
}

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "user_alice|s1" });
  const bob = t.withIdentity({ subject: "user_bob|s2" });
  const eve = t.withIdentity({ subject: "user_eve|s3" });
  const created = unwrap(
    await alice.mutation(api.rooms.createRoom, {
      title: "Maya's birthday",
      recipientDisplayName: "Maya",
      occasion: "Birthday",
      budgetMinor: 10000,
      deadlineAt: 1_900_000_000_000,
      displayName: "Alice",
    }),
  );
  const roomId = created.room._id;
  const bobP = unwrap(await bob.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Bob" }))
    .participant._id;
  const listingId = await t.run((ctx) => insertListing(ctx, roomId));
  unwrap(await alice.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 10000 }));
  unwrap(await bob.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 6000 }));
  const revision = unwrap(await alice.mutation(api.proposals.selectGift, { roomId, listingId })).revision!;
  return {
    t,
    alice,
    bob,
    eve,
    roomId,
    listingId,
    inviteToken: created.inviteToken,
    revisionId: revision._id,
    aliceP: created.participant._id,
    bobP,
  };
}

async function room(t: ReturnType<typeof convexTest>, roomId: Id<"rooms">) {
  return (await t.run((ctx) => ctx.db.get(roomId)))!;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("updateRoom", () => {
  it("is organizer-only", async () => {
    const { bob, eve, roomId } = await setup();
    expect(code(await bob.mutation(api.rooms.updateRoom, { roomId, title: "Mine now" }))).toBe("unauthorized");
    expect(code(await eve.mutation(api.rooms.updateRoom, { roomId, title: "Mine now" }))).toBe("unauthorized");
  });

  it("validates like createRoom", async () => {
    const { alice, roomId } = await setup();
    expect(code(await alice.mutation(api.rooms.updateRoom, { roomId, title: "   " }))).toBe("validation_failed");
    expect(code(await alice.mutation(api.rooms.updateRoom, { roomId, occasion: "x".repeat(81) }))).toBe(
      "validation_failed",
    );
    expect(code(await alice.mutation(api.rooms.updateRoom, { roomId, budgetMinor: -5 }))).toBe("validation_failed");
    expect(code(await alice.mutation(api.rooms.updateRoom, { roomId, budgetMinor: 0 }))).toBe("validation_failed");
    expect(code(await alice.mutation(api.rooms.updateRoom, { roomId, budgetMinor: 12.5 }))).toBe("validation_failed");
    expect(code(await alice.mutation(api.rooms.updateRoom, { roomId, deadlineAt: -1 }))).toBe("validation_failed");
  });

  it("updates and clears metadata without touching the proposal", async () => {
    const { t, alice, roomId, revisionId } = await setup();
    const before = await room(t, roomId);
    const updated = unwrap(
      await alice.mutation(api.rooms.updateRoom, {
        roomId,
        title: "  Maya turns 30  ",
        budgetMinor: null,
        deadlineAt: null,
      }),
    );
    expect(updated.title).toBe("Maya turns 30");
    expect(updated.budgetMinor).toBeUndefined();
    expect(updated.deadlineAt).toBeUndefined();
    expect(updated.recipientDisplayName).toBe("Maya");
    const after = await room(t, roomId);
    expect(after.currentRevisionId).toBe(revisionId);
    expect(after.knowledgeRevision).toBe(before.knowledgeRevision);

    unwrap(await alice.mutation(api.rooms.updateRoom, { roomId, budgetMinor: 5000 }));
    expect((await room(t, roomId)).budgetMinor).toBe(5000);
    expect((await room(t, roomId)).currentRevisionId).toBe(revisionId);
  });
});

describe("deleteMessage", () => {
  it("lets the author tombstone their own message for every viewer", async () => {
    const { t, alice, bob, roomId } = await setup();
    const msg = unwrap(
      await bob.mutation(api.messages.sendMessage, { roomId, body: "She hates candles", clientIdempotencyKey: "m1" }),
    );
    expect(code(await alice.mutation(api.messages.deleteMessage, { messageId: msg._id }))).toBe("unauthorized");

    const deleted = unwrap(await bob.mutation(api.messages.deleteMessage, { messageId: msg._id }));
    expect(deleted.body).toBe("");
    expect(deleted.deletedAt).toBeTypeOf("number");
    // Idempotent.
    unwrap(await bob.mutation(api.messages.deleteMessage, { messageId: msg._id }));

    for (const viewer of [alice, bob]) {
      const list = unwrap(await viewer.query(api.messages.listMessages, { roomId }));
      const row = list.find((m) => m._id === msg._id)!;
      expect(row.body).toBe("");
      expect(row.deletedAt).toBeTypeOf("number");
    }
    // The stored body is gone, so readers that bypass listMessages (agent snapshot) cannot see it.
    const stored = (await t.run((ctx) => ctx.db.get(msg._id)))!;
    expect(stored.body).toBe("");
    expect((await room(t, roomId)).latestMessageId).toBe(msg._id);
  });

  it("refuses to delete buyer-agent messages, even for the organizer", async () => {
    const { t, alice, eve, roomId } = await setup();
    const agentMsg = await t.run((ctx) =>
      ctx.db.insert("chatMessages", {
        roomId,
        authorKind: "buyer_agent",
        body: "Here are three ideas.",
        createdAt: Date.now(),
        clientIdempotencyKey: "agent:x",
      }),
    );
    expect(code(await alice.mutation(api.messages.deleteMessage, { messageId: agentMsg }))).toBe("refused");
    expect(code(await eve.mutation(api.messages.deleteMessage, { messageId: agentMsg }))).toBe("unauthorized");
    expect((await t.run((ctx) => ctx.db.get(agentMsg)))!.body).toBe("Here are three ideas.");
  });
});

describe("leaveRoom", () => {
  it("removes membership, cap, votes, and share, and invalidates old approvals", async () => {
    const { t, alice, bob, roomId, listingId, revisionId, bobP } = await setup();
    unwrap(await alice.mutation(api.proposals.approveRevision, { revisionId }));
    unwrap(await bob.mutation(api.votes.castVote, { roomId, listingId, value: "up" }));

    unwrap(await bob.mutation(api.rooms.leaveRoom, { roomId }));

    expect(code(await bob.query(api.rooms.getRoom, { roomId }))).toBe("unauthorized");
    expect(code(await bob.query(api.messages.listMessages, { roomId }))).toBe("unauthorized");
    expect(unwrap(await bob.query(api.rooms.listMyRooms, {}))).toEqual([]);

    const leftovers = await t.run(async (ctx) => ({
      limits: (await ctx.db.query("contributionLimits").collect()).filter((l) => l.participantId === bobP),
      votes: (await ctx.db.query("votes").collect()).filter((v) => v.participantId === bobP),
      participant: await ctx.db.get(bobP),
      oldRevision: (await ctx.db.get(revisionId))!,
      oldApprovals: await ctx.db
        .query("approvals")
        .withIndex("by_revision", (q) => q.eq("revisionId", revisionId))
        .collect(),
    }));
    expect(leftovers.limits).toEqual([]);
    expect(leftovers.votes).toEqual([]);
    expect(leftovers.participant).toBeNull();
    expect(leftovers.oldRevision.status).toBe("superseded");
    expect(leftovers.oldApprovals.every((a) => a.status === "invalidated")).toBe(true);

    const proposal = unwrap(await alice.query(api.proposals.getProposal, { roomId }));
    expect(proposal.revision!.id).not.toBe(revisionId);
    expect(proposal.shares.map((s) => s.participantId)).not.toContain(bobP);
    expect(proposal.shares.reduce((sum, s) => sum + s.amountMinor, 0)).toBe(9000);
    expect(proposal.approvals.map((a) => a.participantId)).not.toContain(bobP);

    const view = unwrap(await alice.query(api.rooms.getRoom, { roomId }));
    expect(view.participants.map((p) => p.id)).not.toContain(bobP);
  });

  it("keeps private rows and published clues unless asked to delete private data", async () => {
    const { t, bob, roomId, bobP } = await setup();
    unwrap(
      await bob.mutation(api.clues.importEvidence, { roomId, kind: "paste", label: "DMs", rawText: "Maya: I love clay" }),
    );
    const manual = unwrap(await bob.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text: "Pottery" }));
    unwrap(await bob.mutation(api.rooms.leaveRoom, { roomId }));
    const state = await t.run(async (ctx) => ({
      sources: (await ctx.db.query("evidenceSources").collect()).filter((s) => s.participantId === bobP),
      clue: await ctx.db.get(manual._id),
    }));
    expect(state.sources).toHaveLength(1);
    expect(state.clue!.status).toBe("active");
  });

  it("optionally deletes private data and tombstones clues derived from it", async () => {
    const { t, alice, bob, roomId, bobP } = await setup();
    const imported = unwrap(
      await bob.mutation(api.clues.importEvidence, {
        roomId,
        kind: "paste",
        label: "DMs",
        rawText: "Maya: I love clay\nMaya: no candles please",
      }),
    );
    const sourceId = imported.source._id;
    const storageId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["img"], { type: "image/png" }));
      const photo = await ctx.db.insert("evidenceSources", {
        roomId,
        participantId: bobP,
        kind: "photo",
        label: "Photos",
        sourceRevision: 1,
        media: { count: 1, status: "uploaded" },
        createdAt: Date.now(),
      });
      await ctx.db.insert("evidenceMedia", {
        sourceId: photo,
        participantId: bobP,
        mediaIndex: 0,
        storageId,
        contentType: "image/png",
      });
      return storageId;
    });
    const proposedId = await t.run((ctx) =>
      ctx.db.insert("proposedClues", {
        roomId,
        participantId: bobP,
        sourceId,
        sourceMessageIds: [imported.messages[0]!._id],
        kind: "interest",
        text: "Loves clay",
        confidence: 0.9,
        speakerAssumption: "recipient",
        contradictsClueIds: [],
        status: "proposed",
        createdAt: Date.now(),
      }),
    );
    const published = unwrap(
      await bob.mutation(api.clues.publishClue, { proposedClueId: proposedId, excerpt: "I love clay" }),
    );
    const manual = unwrap(await bob.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text: "Pottery" }));
    const knowledgeBefore = (await room(t, roomId)).knowledgeRevision;

    unwrap(await bob.mutation(api.rooms.leaveRoom, { roomId, deletePrivateData: true }));

    const state = await t.run(async (ctx) => ({
      sources: (await ctx.db.query("evidenceSources").collect()).filter((s) => s.participantId === bobP),
      messages: (await ctx.db.query("privateMessages").collect()).filter((m) => m.participantId === bobP),
      media: (await ctx.db.query("evidenceMedia").collect()).filter((m) => m.participantId === bobP),
      proposed: (await ctx.db.query("proposedClues").collect()).filter((c) => c.participantId === bobP),
      file: await ctx.db.system.get(storageId),
      published: (await ctx.db.get(published._id))!,
      manual: (await ctx.db.get(manual._id))!,
    }));
    expect(state.sources).toEqual([]);
    expect(state.messages).toEqual([]);
    expect(state.media).toEqual([]);
    expect(state.proposed).toEqual([]);
    expect(state.file).toBeNull();
    expect(state.published.status).toBe("source_withdrawn");
    expect(state.published.excerpt).toBeUndefined();
    expect(state.published.sourceMessageIds).toEqual([]);
    expect(state.published.proposedClueId).toBeUndefined();
    expect(state.manual.status).toBe("active");
    expect((await room(t, roomId)).knowledgeRevision).toBeGreaterThan(knowledgeBefore);

    const visible = unwrap(await alice.query(api.clues.listPublishedClues, { roomId }));
    expect(visible.find((c) => c._id === published._id)!.excerpt).toBeUndefined();
  });

  it("cancels open agent jobs acting as the leaver", async () => {
    const { t, bob, roomId, bobP } = await setup();
    const jobId = await t.run((ctx) =>
      ctx.db.insert("agentJobs", {
        roomId,
        kind: "extract",
        status: "running",
        inputHash: "x",
        idempotencyKey: "x",
        attempt: 1,
        actingParticipantId: bobP,
        createdAt: Date.now(),
      }),
    );
    unwrap(await bob.mutation(api.rooms.leaveRoom, { roomId }));
    expect((await t.run((ctx) => ctx.db.get(jobId)))!.status).toBe("canceled");
  });

  it("refuses the organizer and frozen proposals", async () => {
    const { t, alice, bob, roomId, revisionId, bobP } = await setup();
    expect(code(await alice.mutation(api.rooms.leaveRoom, { roomId }))).toBe("refused");
    await t.run((ctx) => ctx.db.patch(revisionId, { status: "capturing" }));
    expect(code(await bob.mutation(api.rooms.leaveRoom, { roomId }))).toBe("invalid_revision");
    expect(await t.run((ctx) => ctx.db.get(bobP))).not.toBeNull();
  });
});

const ROOM_TABLES = [
  "participants",
  "chatMessages",
  "evidenceSources",
  "proposedClues",
  "publishedClues",
  "productListings",
  "recommendations",
  "giftSelections",
  "votes",
  "contributionLimits",
  "proposalRevisions",
  "approvals",
  "agentJobs",
  "agentDecisions",
  "askedSlots",
  "agentEvents",
  "giftWorlds",
  "recipientProfiles",
  "councilRuns",
  "giftDecorations",
  "paymentAttempts",
  "researchJobs",
] as const satisfies readonly TableNames[];

/** Inserts at least one row in every room-scoped table, plus children reachable only through parents. */
async function seedEverything(ctx: MutationCtx, roomId: Id<"rooms">, participantId: Id<"participants">, privateRows: number) {
  const now = Date.now();
  const storageId = await ctx.storage.store(new Blob(["img"], { type: "image/png" }));
  const sourceId = await ctx.db.insert("evidenceSources", {
    roomId,
    participantId,
    kind: "photo",
    label: "Photos",
    sourceRevision: 1,
    media: { count: 1, status: "uploaded" },
    createdAt: now,
  });
  await ctx.db.insert("evidenceMedia", { sourceId, participantId, mediaIndex: 0, storageId, contentType: "image/png" });
  const messageIds = [];
  for (let i = 0; i < privateRows; i++) {
    messageIds.push(await ctx.db.insert("privateMessages", { sourceId, participantId, body: `secret ${i}` }));
  }
  const proposedClueId = await ctx.db.insert("proposedClues", {
    roomId,
    participantId,
    sourceId,
    sourceMessageIds: messageIds.slice(0, 1),
    kind: "interest",
    text: "Clay",
    confidence: 0.8,
    speakerAssumption: "recipient",
    contradictsClueIds: [],
    status: "published",
    createdAt: now,
  });
  const publishedClueId = await ctx.db.insert("publishedClues", {
    roomId,
    proposedClueId,
    publisherId: participantId,
    kind: "interest",
    text: "Clay",
    sourceKind: "photo",
    sourceMessageIds: [],
    status: "active",
    publishedAt: now,
  });
  const listingId = await insertListing(ctx, roomId);
  await ctx.db.insert("recommendations", {
    roomId,
    listingId,
    publishedClueIds: [publishedClueId],
    score: 1,
    personalRelevance: 1,
    budgetFit: 1,
    trendSignal: 0,
    explanation: "Fits",
    createdAt: now,
  });
  const selectionId = await ctx.db.insert("giftSelections", {
    roomId,
    listingId,
    quantity: 1,
    listingSnapshot: { title: "Wheel", sourceUrl: "https://example.com", priceMinor: 9000, priceStatus: "observed", retrievedAt: now },
    status: "cleared",
    selectedBy: participantId,
    selectedAt: now,
  });
  await ctx.db.insert("votes", { roomId, listingId, participantId, value: "up", updatedAt: now });
  await ctx.db.insert("contributionLimits", { roomId, participantId, amountMinor: 100, updatedAt: now });
  const revisionId = await ctx.db.insert("proposalRevisions", {
    roomId,
    revisionNumber: 99,
    selectionId,
    listingId,
    quantity: 1,
    payableTotalMinor: 9000,
    currency: "USD",
    shares: [{ participantId, amountMinor: 9000 }],
    conditions: [],
    status: "superseded",
    createdAt: now,
  });
  await ctx.db.insert("approvals", { roomId, revisionId, participantId, status: "invalidated", updatedAt: now });
  await ctx.db.insert("paymentAttempts", {
    roomId,
    revisionId,
    participantId,
    provider: "stripe_test",
    idempotencyKey: `pay-${roomId}`,
    clientIdempotencyKey: "c",
    amountMinor: 9000,
    currency: "USD",
    status: "canceled",
    createdAt: now,
    updatedAt: now,
  });
  const jobId = await ctx.db.insert("agentJobs", {
    roomId,
    kind: "evaluate_thread",
    status: "running",
    inputHash: "i",
    idempotencyKey: `j-${roomId}`,
    attempt: 1,
    actingParticipantId: participantId,
    createdAt: now,
  });
  await ctx.db.insert("agentDecisions", {
    jobId,
    roomId,
    intent: "listen",
    rationale: "r",
    needsFollowup: false,
    createdAt: now,
  });
  const messageId = await ctx.db.insert("chatMessages", {
    roomId,
    authorKind: "participant",
    participantId,
    body: "hello",
    createdAt: now,
    clientIdempotencyKey: `c-${roomId}`,
  });
  await ctx.db.insert("askedSlots", { roomId, slot: "budget", messageId, status: "open", askedAt: now });
  await ctx.db.insert("agentEvents", { roomId, jobId, actor: "buyer", kind: "started", summary: "s", createdAt: now });
  await ctx.db.insert("giftWorlds", {
    roomId,
    ownerUserId: "u",
    isSample: false,
    occasion: "Birthday",
    recipientAlias: "Someone",
    budgetBand: "unknown",
    friends: 2,
    inputs: [],
    highlights: [],
    state: "exploring",
    sharedAt: now,
    updatedAt: now,
  });
  const recipientProfileId = await ctx.db.insert("recipientProfiles", { roomId, ownerUserId: "u", revision: 1, createdAt: now });
  await ctx.db.insert("recipientPreferences", {
    recipientProfileId,
    category: "interest",
    text: "clay",
    disclosable: true,
    authorized: true,
    createdAt: now,
  });
  await ctx.db.insert("recipientGrants", { recipientProfileId, category: "interest", allowedQuestionTypes: ["suitability"] });
  const runId = `run-${roomId}`;
  await ctx.db.insert("councilRuns", { runId, source: "web", roomId, status: "running", lastSequence: 0, startedAt: now, updatedAt: now });
  await ctx.db.insert("councilEvents", {
    eventId: `e-${roomId}`,
    runId,
    actor: "muse",
    task: "t",
    status: "completed",
    sequence: 0,
    timestamp: now,
    receivedAt: now,
  });
  await ctx.db.insert("giftDecorations", {
    roomId,
    memoryId: "m",
    runId,
    jar: "j",
    assetId: "a",
    color: "c",
    placement: "p",
    label: "l",
    createdAt: now,
  });
  return { storageId, sourceId, recipientProfileId, runId, revisionId };
}

type Seed = Awaited<ReturnType<typeof seedEverything>>;

async function countRoomRows(t: ReturnType<typeof convexTest>, roomId: Id<"rooms">, seed: Seed) {
  return await t.run(async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of ROOM_TABLES) {
      counts[table] = (await ctx.db.query(table).collect()).filter((r) => r.roomId === roomId).length;
    }
    counts.privateMessages = (await ctx.db.query("privateMessages").collect()).filter((r) => r.sourceId === seed.sourceId).length;
    counts.evidenceMedia = (await ctx.db.query("evidenceMedia").collect()).filter((r) => r.sourceId === seed.sourceId).length;
    counts.councilEvents = (await ctx.db.query("councilEvents").collect()).filter((r) => r.runId === seed.runId).length;
    counts.recipientPreferences = (await ctx.db.query("recipientPreferences").collect()).filter(
      (r) => r.recipientProfileId === seed.recipientProfileId,
    ).length;
    counts.recipientGrants = (await ctx.db.query("recipientGrants").collect()).filter(
      (r) => r.recipientProfileId === seed.recipientProfileId,
    ).length;
    counts.storage = (await ctx.db.system.get(seed.storageId)) ? 1 : 0;
    counts.rooms = (await ctx.db.get(roomId)) ? 1 : 0;
    return counts;
  });
}

describe("deleteRoom", () => {
  it("is organizer-only and requires the exact title", async () => {
    const { t, bob, alice, eve, roomId } = await setup();
    expect(code(await bob.mutation(api.rooms.deleteRoom, { roomId, confirmTitle: "Maya's birthday" }))).toBe("unauthorized");
    expect(code(await eve.mutation(api.rooms.deleteRoom, { roomId, confirmTitle: "Maya's birthday" }))).toBe("unauthorized");
    expect(code(await alice.mutation(api.rooms.deleteRoom, { roomId, confirmTitle: "maya's birthday" }))).toBe(
      "validation_failed",
    );
    expect((await room(t, roomId)).deletedAt).toBeUndefined();
  });

  it("refuses while payment is frozen or still settling", async () => {
    const { t, alice, roomId, revisionId, aliceP } = await setup();
    await t.run((ctx) => ctx.db.patch(revisionId, { status: "capturing" }));
    expect(code(await alice.mutation(api.rooms.deleteRoom, { roomId, confirmTitle: "Maya's birthday" }))).toBe(
      "invalid_revision",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(revisionId, { status: "authorizing" });
      await ctx.db.insert("paymentAttempts", {
        roomId,
        revisionId,
        participantId: aliceP,
        provider: "stripe_test",
        providerObjectId: "pi_1",
        idempotencyKey: "p1",
        clientIdempotencyKey: "c1",
        amountMinor: 4500,
        currency: "USD",
        status: "authorized",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    expect(code(await alice.mutation(api.rooms.deleteRoom, { roomId, confirmTitle: "Maya's birthday" }))).toBe(
      "invalid_revision",
    );
    expect((await room(t, roomId)).deletedAt).toBeUndefined();
  });

  it("revokes access immediately and cascades every room-scoped row and file", async () => {
    const { t, alice, bob, roomId, aliceP, inviteToken } = await setup();
    const other = unwrap(
      await bob.mutation(api.rooms.createRoom, { title: "Other", recipientDisplayName: "Sam", occasion: "Thanks" }),
    );
    const seedA = await t.run((ctx) => seedEverything(ctx, roomId, aliceP, 300));
    const seedB = await t.run((ctx) => seedEverything(ctx, other.room._id, other.participant._id, 2));

    const beforeA = await countRoomRows(t, roomId, seedA);
    for (const [table, n] of Object.entries(beforeA)) expect(n, table).toBeGreaterThan(0);

    unwrap(await alice.mutation(api.rooms.deleteRoom, { roomId, confirmTitle: "  Maya's birthday " }));

    // Before any purge batch runs, the room is unreachable for everyone.
    for (const viewer of [alice, bob]) {
      expect(code(await viewer.query(api.rooms.getRoom, { roomId }))).toBe("not_found");
      expect(code(await viewer.query(api.messages.listMessages, { roomId }))).toBe("not_found");
      expect(code(await viewer.query(api.proposals.getProposal, { roomId }))).toBe("not_found");
      expect(code(await viewer.query(api.clues.listMyEvidence, { roomId }))).toBe("not_found");
    }
    expect(unwrap(await alice.query(api.rooms.listMyRooms, {}))).toEqual([]);
    expect(code(await alice.query(api.rooms.previewInvite, { inviteToken }))).toBe("not_found");
    expect(code(await t.withIdentity({ subject: "late" }).mutation(api.rooms.joinRoom, { inviteToken, displayName: "Late" }))).toBe(
      "not_found",
    );
    expect(
      code(await alice.mutation(api.messages.sendMessage, { roomId, body: "hi", clientIdempotencyKey: "late" })),
    ).toBe("not_found");
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.query("agentJobs").collect()).filter((j) => j.roomId === roomId),
    );
    expect(jobs.every((j) => j.status === "canceled")).toBe(true);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const afterA = await countRoomRows(t, roomId, seedA);
    for (const [table, n] of Object.entries(afterA)) expect(n, table).toBe(0);
    const afterB = await countRoomRows(t, other.room._id, seedB);
    for (const [table, n] of Object.entries(afterB)) expect(n, table).toBeGreaterThan(0);
    expect(unwrap(await bob.query(api.rooms.listMyRooms, {})).map((r) => r.roomId)).toEqual([other.room._id]);
  });

  it("purgeRoomBatch ignores rooms that were not deleted", async () => {
    const { t, roomId } = await setup();
    const result = await t.mutation(internal.rooms.purgeRoomBatch, { roomId });
    expect(result).toEqual({ deleted: 0, done: true });
    expect(await t.run((ctx) => ctx.db.get(roomId))).not.toBeNull();
  });
});
