// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Dev 2 Phase 5 privacy retest. Seeds one room through the public API with
 * every class of private data (imports, proposed clues, caps, recipient
 * profile, payment attempts, media), then calls every public room query as
 * the organizer, a contributor, an outsider, and an anonymous client.
 * See docs/DEV2_PRIVACY_RETEST.md.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../lib/contracts";
import { api, internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { INFEASIBLE_CAPS_MESSAGE } from "./lib/proposalEngine";
import schema from "./schema";
import { modules } from "./test.setup";

const ALICE_PRIVATE = "ALICE-PRIVATE-LINE wants a kiln but do not tell anyone";
const ALICE_PROPOSED = "ALICE-PROPOSED-UNPUBLISHED kiln wish";
const BOB_PRIVATE = "BOB-PRIVATE-LINE secretly hates scented candles";
const BOB_PROPOSED = "BOB-PROPOSED-UNPUBLISHED no candles";
const PUBLISHED = "Loves pottery";
const RECIPIENT_SECRET = "RECIPIENT-SECRET collects vintage fountain pens";
const ALICE_CAP = 5678;
const BOB_CAP = 1234;
const LISTING_PRICE = 2000;

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** True when `n` appears as a JSON number or as a formatted dollar amount. */
function containsAmount(json: string, n: number): boolean {
  const dollars = (n / 100).toFixed(2).replace(".", "\\.");
  return new RegExp(`[:\\[,]${n}[,\\]}]`).test(json) || new RegExp(dollars).test(json);
}

async function seedListing(t: ReturnType<typeof convexTest>, roomId: Id<"rooms">, priceMinor: number) {
  return await t.run(async (ctx) => {
    const jobId = await ctx.db.insert("researchJobs", {
      roomId,
      knowledgeRevision: 0,
      publishedClueIds: [],
      status: "succeeded",
      inputHash: `h-${roomId}-${priceMinor}`,
      idempotencyKey: `k-${roomId}-${priceMinor}`,
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
      priceMinor,
      priceStatus: "observed",
      availability: "in_stock",
      shippingStatus: "unknown",
      retrievedAt: Date.now(),
      status: "active",
    });
  });
}

async function seed() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "user_alice|s1" });
  const bob = t.withIdentity({ subject: "user_bob|s2" });
  const eve = t.withIdentity({ subject: "user_eve|s3" });

  const created = unwrap(
    await alice.mutation(api.rooms.createRoom, {
      title: "Maya's birthday",
      recipientDisplayName: "Maya",
      occasion: "Birthday",
      displayName: "Alice",
    }),
  );
  const roomId = created.room._id;
  const aliceP = created.participant._id;
  const bobP = unwrap(await bob.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Bob" }))
    .participant._id;

  const { recipientProfileId } = unwrap(await alice.mutation(api.agents.recipient.createProfile, { roomId }));
  unwrap(
    await alice.mutation(api.agents.recipient.updateRecipientPreferences, {
      recipientProfileId,
      preferences: [{ category: "interest", text: RECIPIENT_SECRET, authorized: true, disclosable: true }],
      grants: [{ category: "interest", allowedQuestionTypes: ["suitability"] }],
    }),
  );

  const aliceImport = unwrap(
    await alice.mutation(api.clues.importEvidence, {
      roomId,
      kind: "paste",
      label: "Alice DMs",
      rawText: `Maya: ${ALICE_PRIVATE}\nMaya: I love pottery`,
    }),
  );
  const bobImport = unwrap(
    await bob.mutation(api.clues.importEvidence, { roomId, kind: "paste", label: "Bob DMs", rawText: `Maya: ${BOB_PRIVATE}` }),
  );

  const extractJob = (participantId: Id<"participants">, key: string) =>
    t.run((ctx) =>
      ctx.db.insert("agentJobs", {
        roomId,
        kind: "extract",
        status: "running",
        inputHash: key,
        idempotencyKey: key,
        attempt: 1,
        actingParticipantId: participantId,
        createdAt: Date.now(),
      }),
    );
  const aliceJob = await extractJob(aliceP, "extract-alice");
  const bobJob = await extractJob(bobP, "extract-bob");
  const clue = (text: string, messageId: Id<"privateMessages">) => ({
    kind: "interest" as const,
    text,
    confidence: 0.9,
    sourceMessageIds: [messageId],
    speakerAssumption: "recipient" as const,
    contradictsClueIds: [],
  });
  const aliceClues = unwrap(
    await t.mutation(internal.clues.insertProposedClues, {
      jobId: aliceJob,
      sourceId: aliceImport.source._id,
      clues: [clue(ALICE_PROPOSED, aliceImport.messages[0]!._id), clue(PUBLISHED, aliceImport.messages[1]!._id)],
    }),
  ).insertedIds;
  const bobClues = unwrap(
    await t.mutation(internal.clues.insertProposedClues, {
      jobId: bobJob,
      sourceId: bobImport.source._id,
      clues: [clue(BOB_PROPOSED, bobImport.messages[0]!._id)],
    }),
  ).insertedIds;
  const published = unwrap(await alice.mutation(api.clues.publishClue, { proposedClueId: aliceClues[1]! }));

  const aliceStorageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })),
  );
  const aliceMedia = unwrap(
    await alice.mutation(api.media.importMediaEvidence, {
      roomId,
      kind: "photo",
      label: "Alice photos",
      files: [{ storageId: aliceStorageId }],
    }),
  );

  unwrap(await alice.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: ALICE_CAP }));
  unwrap(await bob.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: BOB_CAP }));
  const listingId = await seedListing(t, roomId, LISTING_PRICE);
  const revisionId = unwrap(await alice.mutation(api.proposals.selectGift, { roomId, listingId })).revision!._id;
  unwrap(await alice.mutation(api.proposals.approveRevision, { revisionId }));
  unwrap(await bob.mutation(api.proposals.approveRevision, { revisionId }));

  const authorize = async (who: typeof alice, providerObjectId: string, key: string) => {
    const intent = unwrap(await who.mutation(api.payments.state.beginAuthorization, { revisionId, idempotencyKey: key }));
    unwrap(await t.mutation(internal.payments.state.attachProviderObject, { attemptId: intent.attemptId, providerObjectId }));
    unwrap(await t.mutation(internal.payments.state.applyAttemptStatus, { attemptId: intent.attemptId, status: "authorized" }));
    return intent.attemptId;
  };
  const aliceAttempt = await authorize(alice, "pi_ALICE_PROVIDER_OBJECT", "alice-pay");
  const bobAttempt = await authorize(bob, "pi_BOB_PROVIDER_OBJECT", "bob-pay");

  unwrap(await bob.mutation(api.votes.castVote, { roomId, listingId, value: "up" }));
  unwrap(await bob.mutation(api.messages.sendMessage, { roomId, body: "Pottery sounds right", clientIdempotencyKey: "b1" }));

  return {
    t,
    alice,
    bob,
    eve,
    roomId,
    inviteToken: created.inviteToken,
    aliceP,
    bobP,
    recipientProfileId,
    listingId,
    revisionId,
    publishedClueId: published._id,
    alice_: {
      sourceId: aliceImport.source._id,
      messageId: aliceImport.messages[0]!._id,
      proposedClueId: aliceClues[0]!,
      jobId: aliceJob,
      attemptId: aliceAttempt,
      mediaSourceId: aliceMedia.source._id,
      storageId: aliceStorageId,
    },
    bob_: {
      sourceId: bobImport.source._id,
      messageId: bobImport.messages[0]!._id,
      proposedClueId: bobClues[0]!,
      jobId: bobJob,
      attemptId: bobAttempt,
    },
  };
}

type Seeded = Awaited<ReturnType<typeof seed>>;
type Caller = Seeded["alice"];

/** Every public query that takes room-scoped input, labelled for failure messages. */
async function readEverything(s: Seeded, who: Caller): Promise<Record<string, unknown>> {
  const { roomId } = s;
  const calls: Record<string, Promise<unknown>> = {
    "rooms.getRoom": who.query(api.rooms.getRoom, { roomId }),
    "rooms.listMyRooms": who.query(api.rooms.listMyRooms, {}),
    "rooms.getInvite": who.query(api.rooms.getInvite, { roomId }),
    "rooms.previewInvite": who.query(api.rooms.previewInvite, { inviteToken: s.inviteToken }),
    "messages.listMessages": who.query(api.messages.listMessages, { roomId }),
    "clues.listMyEvidence": who.query(api.clues.listMyEvidence, { roomId }),
    "clues.getMyEvidenceMessages(alice)": who.query(api.clues.getMyEvidenceMessages, { sourceId: s.alice_.sourceId }),
    "clues.getMyEvidenceMessages(bob)": who.query(api.clues.getMyEvidenceMessages, { sourceId: s.bob_.sourceId }),
    "clues.listMyProposedClues": who.query(api.clues.listMyProposedClues, { roomId }),
    "clues.listPublishedClues": who.query(api.clues.listPublishedClues, { roomId }),
    "jobs.listRoomJobs": who.query(api.jobs.listRoomJobs, { roomId }),
    "votes.listVotes": who.query(api.votes.listVotes, { roomId }),
    "proposals.getSelection": who.query(api.proposals.getSelection, { roomId }),
    "proposals.getMyContributionLimit": who.query(api.proposals.getMyContributionLimit, { roomId }),
    "proposals.getProposal": who.query(api.proposals.getProposal, { roomId }),
    "proposals.listRevisions": who.query(api.proposals.listRevisions, { roomId }),
    "payments.state.getPaymentStatus": who.query(api.payments.state.getPaymentStatus, { roomId }),
    "research.research.listRecommendations": who.query(api.research.research.listRecommendations, { roomId }),
    "agents.buyer.listActivity": who.query(api.agents.buyer.listActivity, { roomId }),
    "agents.recipient.getMyProfile": who.query(api.agents.recipient.getMyProfile, { roomId }),
    "agents.stats.getRoomStats": who.query(api.agents.stats.getRoomStats, { roomId }),
    "worlds.getMyWorldShare": who.query(api.worlds.getMyWorldShare, { roomId }),
    "worlds.listWorlds": who.query(api.worlds.listWorlds, {}),
    "councilRoom.state": who.query(api.councilRoom.state, { roomId }),
  };
  const out: Record<string, unknown> = {};
  for (const [name, call] of Object.entries(calls)) out[name] = await call;
  return out;
}

const ROOM_SCOPED = [
  "rooms.getRoom",
  "rooms.getInvite",
  "messages.listMessages",
  "clues.listMyEvidence",
  "clues.getMyEvidenceMessages(alice)",
  "clues.getMyEvidenceMessages(bob)",
  "clues.listMyProposedClues",
  "clues.listPublishedClues",
  "jobs.listRoomJobs",
  "votes.listVotes",
  "proposals.getSelection",
  "proposals.getMyContributionLimit",
  "proposals.getProposal",
  "proposals.listRevisions",
  "payments.state.getPaymentStatus",
  "research.research.listRecommendations",
  "agents.buyer.listActivity",
  "agents.recipient.getMyProfile",
  "agents.stats.getRoomStats",
  "worlds.getMyWorldShare",
  "councilRoom.state",
];

function expectAbsent(views: Record<string, unknown>, forbidden: string[], amounts: number[]) {
  for (const [name, view] of Object.entries(views)) {
    const json = JSON.stringify(view);
    for (const needle of forbidden) expect(json, `${name} leaked ${needle}`).not.toContain(needle);
    for (const n of amounts) expect(containsAmount(json, n), `${name} leaked amount ${n}`).toBe(false);
  }
}

const SNAPSHOT_TABLES: TableNames[] = [
  "rooms",
  "participants",
  "chatMessages",
  "evidenceSources",
  "evidenceMedia",
  "privateMessages",
  "proposedClues",
  "publishedClues",
  "productListings",
  "giftSelections",
  "votes",
  "contributionLimits",
  "proposalRevisions",
  "approvals",
  "agentJobs",
  "askedSlots",
  "giftWorlds",
  "recipientProfiles",
  "recipientPreferences",
  "recipientGrants",
  "councilRuns",
  "paymentAttempts",
  "researchJobs",
];

async function snapshot(t: Seeded["t"]): Promise<string> {
  return await t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of SNAPSHOT_TABLES) out[table] = await ctx.db.query(table).collect();
    return JSON.stringify(out);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("RECIPIENT_AGENT_DEMO_ENABLED", "true");
  vi.stubEnv("PAYMENTS_SANDBOX_ENABLED", "true");
  vi.stubEnv("DEMO_SEED_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("privacy retest: read paths", () => {
  it("a contributor never sees the organizer's private rows, cap, recipient data, or provider objects", async () => {
    const s = await seed();
    const views = await readEverything(s, s.bob);
    expectAbsent(
      views,
      [
        ALICE_PRIVATE,
        ALICE_PROPOSED,
        RECIPIENT_SECRET,
        s.recipientProfileId,
        "pi_ALICE_PROVIDER_OBJECT",
        "pi_BOB_PROVIDER_OBJECT",
        s.alice_.sourceId,
        s.alice_.messageId,
        s.alice_.proposedClueId,
        s.alice_.jobId,
        s.alice_.attemptId,
        s.alice_.mediaSourceId,
        s.alice_.storageId,
        "unwrap_",
      ],
      [ALICE_CAP],
    );
    // Bob still sees his own private data and the room-visible parts.
    const json = JSON.stringify(views);
    expect(json).toContain(BOB_PRIVATE);
    expect(json).toContain(BOB_PROPOSED);
    expect(json).toContain(PUBLISHED);
    expect(views["proposals.getMyContributionLimit"]).toMatchObject({ ok: true, value: { amountMinor: BOB_CAP } });
    expect(views["clues.getMyEvidenceMessages(alice)"]).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(views["agents.recipient.getMyProfile"]).toMatchObject({ ok: false });
    expect(views["payments.state.getPaymentStatus"]).toMatchObject({
      ok: true,
      value: { myAttempt: { id: s.bob_.attemptId }, authorizedCount: 2 },
    });
  });

  it("the organizer is not a superuser over a contributor's imports, clues, cap, or payment", async () => {
    const s = await seed();
    const views = await readEverything(s, s.alice);
    expectAbsent(
      views,
      [
        BOB_PRIVATE,
        BOB_PROPOSED,
        "pi_ALICE_PROVIDER_OBJECT",
        "pi_BOB_PROVIDER_OBJECT",
        s.bob_.sourceId,
        s.bob_.messageId,
        s.bob_.proposedClueId,
        s.bob_.jobId,
        s.bob_.attemptId,
        "unwrap_",
      ],
      [BOB_CAP],
    );
    expect(views["clues.getMyEvidenceMessages(bob)"]).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(views["proposals.getMyContributionLimit"]).toMatchObject({ ok: true, value: { amountMinor: ALICE_CAP } });
    // The profile owner is the only room member who reads recipient preferences.
    expect(JSON.stringify(views["agents.recipient.getMyProfile"])).toContain(RECIPIENT_SECRET);
  });

  it("an outsider and an anonymous client get errors from every room-scoped query", async () => {
    const s = await seed();
    const anon = s.t;
    for (const who of [s.eve, anon]) {
      const views = await readEverything(s, who);
      for (const name of ROOM_SCOPED) {
        expect(views[name], name).toMatchObject({ ok: false });
        const code = (views[name] as { error: { code: string } }).error.code;
        expect(["unauthorized", "not_found"], `${name} code`).toContain(code);
      }
      expectAbsent(
        views,
        [ALICE_PRIVATE, BOB_PRIVATE, ALICE_PROPOSED, BOB_PROPOSED, RECIPIENT_SECRET, s.recipientProfileId, "pi_"],
        [ALICE_CAP, BOB_CAP],
      );
    }
    // Holding the invite token shows only what the invite implies.
    const preview = unwrap((await s.eve.query(api.rooms.previewInvite, { inviteToken: s.inviteToken })) as Result<object>);
    expect(Object.keys(preview).sort()).toEqual(
      ["alreadyMember", "occasion", "participantCount", "recipientDisplayName", "roomId", "title"].sort(),
    );
    expect(await s.eve.query(api.rooms.listMyRooms, {})).toEqual({ ok: true, value: [] });
    expect(await anon.query(api.rooms.listMyRooms, {})).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await anon.query(api.worlds.listWorlds, {})).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  // Open finding F-1 (convex/rooms.ts, owner Dev 2 rooms worker): joinRoom and
  // createRoom return the raw room document, which includes recipientProfileId.
  // Unskip once rooms.ts maps the room through toRoom().
  it.skip("joinRoom does not return the recipient profile id", async () => {
    const s = await seed();
    const carol = s.t.withIdentity({ subject: "user_carol|s4" });
    const joined = await carol.mutation(api.rooms.joinRoom, { inviteToken: s.inviteToken, displayName: "Carol" });
    expect(JSON.stringify(joined)).not.toContain(s.recipientProfileId);
  });
});

describe("privacy retest: write paths", () => {
  it("an outsider and an anonymous client cannot change anything in the room", async () => {
    const s = await seed();
    const before = await snapshot(s.t);
    const { roomId, listingId, revisionId } = s;
    for (const who of [s.eve, s.t]) {
      const attempts: Array<[string, Promise<unknown>]> = [
        ["sendMessage", who.mutation(api.messages.sendMessage, { roomId, body: "hi", clientIdempotencyKey: "e1" })],
        ["importEvidence", who.mutation(api.clues.importEvidence, { roomId, kind: "paste", label: "x", rawText: "a: b" })],
        ["deleteEvidence", who.mutation(api.clues.deleteEvidence, { sourceId: s.alice_.sourceId })],
        ["editProposedClue", who.mutation(api.clues.editProposedClue, { proposedClueId: s.alice_.proposedClueId, text: "x" })],
        ["rejectProposedClue", who.mutation(api.clues.rejectProposedClue, { proposedClueId: s.alice_.proposedClueId })],
        ["publishClue", who.mutation(api.clues.publishClue, { proposedClueId: s.alice_.proposedClueId })],
        ["withdrawClue", who.mutation(api.clues.withdrawClue, { publishedClueId: s.publishedClueId })],
        ["upsertManualPreference", who.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text: "x" })],
        ["castVote", who.mutation(api.votes.castVote, { roomId, listingId, value: "down" })],
        ["clearVote", who.mutation(api.votes.clearVote, { roomId, listingId })],
        ["selectGift", who.mutation(api.proposals.selectGift, { roomId, listingId })],
        ["clearSelection", who.mutation(api.proposals.clearSelection, { roomId })],
        ["setContributionLimit", who.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 1 })],
        ["createProposal", who.mutation(api.proposals.createProposal, { roomId })],
        ["approveRevision", who.mutation(api.proposals.approveRevision, { revisionId })],
        ["withdrawApproval", who.mutation(api.proposals.withdrawApproval, { revisionId })],
        ["beginAuthorization", who.mutation(api.payments.state.beginAuthorization, { revisionId, idempotencyKey: "e" })],
        ["beginCapture", who.mutation(api.payments.state.beginCapture, { revisionId })],
        ["cancelPayments", who.mutation(api.payments.state.cancelPayments, { revisionId })],
        ["cancelMyAuthorization", who.mutation(api.payments.state.cancelMyAuthorization, { attemptId: s.alice_.attemptId })],
        ["generateEvidenceUploadUrl", who.mutation(api.media.generateEvidenceUploadUrl, { roomId })],
        ["extractClues", who.mutation(api.agents.extract.extractClues, { sourceId: s.alice_.sourceId })],
        ["requestTurn", who.mutation(api.agents.buyer.requestTurn, { roomId })],
        ["setChatMode", who.mutation(api.agents.buyer.setChatMode, { roomId, mode: "chatty" })],
        ["answerQuestion", who.mutation(api.agents.buyer.answerQuestion, { roomId, slot: "budget", body: "x", clientIdempotencyKey: "e" })],
        ["abandonQuestion", who.mutation(api.agents.buyer.abandonQuestion, { roomId, slot: "budget" })],
        ["retryJob", who.mutation(api.agents.buyer.retryJob, { jobId: s.alice_.jobId })],
        ["createProfile", who.mutation(api.agents.recipient.createProfile, { roomId })],
        [
          "updateRecipientPreferences",
          who.mutation(api.agents.recipient.updateRecipientPreferences, {
            recipientProfileId: s.recipientProfileId,
            preferences: [],
            grants: [],
          }),
        ],
        ["startResearch", who.mutation(api.research.research.startResearch, { roomId, publishedClueIds: [s.publishedClueId], idempotencyKey: "e" })],
        ["invalidateListing", who.mutation(api.research.research.invalidateListing, { roomId, listingId })],
        ["shareWorld", who.mutation(api.worlds.shareWorld, { roomId })],
        ["unshareWorld", who.mutation(api.worlds.unshareWorld, { roomId })],
        ["councilRoom.start", who.mutation(api.councilRoom.start, { roomId, publishedClueIds: [s.publishedClueId], idempotencyKey: "e" })],
        ["councilRoom.resume", who.mutation(api.councilRoom.resume, { roomId, runId: "run_x" })],
        ["seedFixturePool", who.mutation(api.demo.seedFixturePool, { roomId })],
      ];
      for (const [name, call] of attempts) {
        expect(await call, name).toMatchObject({ ok: false });
      }
    }
    expect(await snapshot(s.t)).toBe(before);
  });

  it("a contributor cannot act on the organizer's private rows or recipient profile", async () => {
    const s = await seed();
    const before = await snapshot(s.t);
    const bob = s.bob;
    const attempts: Array<[string, Promise<unknown>]> = [
      ["deleteEvidence", bob.mutation(api.clues.deleteEvidence, { sourceId: s.alice_.sourceId })],
      ["editProposedClue", bob.mutation(api.clues.editProposedClue, { proposedClueId: s.alice_.proposedClueId, text: "x" })],
      ["rejectProposedClue", bob.mutation(api.clues.rejectProposedClue, { proposedClueId: s.alice_.proposedClueId })],
      ["publishClue", bob.mutation(api.clues.publishClue, { proposedClueId: s.alice_.proposedClueId })],
      ["withdrawClue", bob.mutation(api.clues.withdrawClue, { publishedClueId: s.publishedClueId })],
      ["extractClues", bob.mutation(api.agents.extract.extractClues, { sourceId: s.alice_.sourceId })],
      ["retryJob", bob.mutation(api.agents.buyer.retryJob, { jobId: s.alice_.jobId })],
      ["cancelMyAuthorization", bob.mutation(api.payments.state.cancelMyAuthorization, { attemptId: s.alice_.attemptId })],
      ["beginCapture", bob.mutation(api.payments.state.beginCapture, { revisionId: s.revisionId })],
      ["cancelPayments", bob.mutation(api.payments.state.cancelPayments, { revisionId: s.revisionId })],
      ["selectGift", bob.mutation(api.proposals.selectGift, { roomId: s.roomId, listingId: s.listingId })],
      ["clearSelection", bob.mutation(api.proposals.clearSelection, { roomId: s.roomId })],
      ["createProfile", bob.mutation(api.agents.recipient.createProfile, { roomId: s.roomId })],
      [
        "updateRecipientPreferences",
        bob.mutation(api.agents.recipient.updateRecipientPreferences, {
          recipientProfileId: s.recipientProfileId,
          preferences: [],
          grants: [],
        }),
      ],
      ["setChatMode", bob.mutation(api.agents.buyer.setChatMode, { roomId: s.roomId, mode: "chatty" })],
      ["invalidateListing", bob.mutation(api.research.research.invalidateListing, { roomId: s.roomId, listingId: s.listingId })],
      ["shareWorld", bob.mutation(api.worlds.shareWorld, { roomId: s.roomId })],
      ["seedFixturePool", bob.mutation(api.demo.seedFixturePool, { roomId: s.roomId })],
    ];
    for (const [name, call] of attempts) {
      const result = (await call) as Result<unknown>;
      expect(result, name).toMatchObject({ ok: false });
      expect(JSON.stringify(result), name).not.toContain(ALICE_PRIVATE);
    }
    expect(await snapshot(s.t)).toBe(before);
  });

  it("clearVote refuses a listing from another room instead of returning its tally", async () => {
    const s = await seed();
    const eveRoom = unwrap(
      await s.eve.mutation(api.rooms.createRoom, { title: "Other", recipientDisplayName: "Zed", occasion: "Party" }),
    ).room._id;
    const eveListing = await seedListing(s.t, eveRoom, 4000);
    unwrap(await s.eve.mutation(api.votes.castVote, { roomId: eveRoom, listingId: eveListing, value: "up" }));
    const result = await s.bob.mutation(api.votes.clearVote, { roomId: s.roomId, listingId: eveListing });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(JSON.stringify(result)).not.toContain('"up":1');
    // Bob's own vote in his room still clears normally.
    expect(unwrap(await s.bob.mutation(api.votes.clearVote, { roomId: s.roomId, listingId: s.listingId })).tally.up).toBe(0);
  });

  it("does not trust client-provided participant ids: every write binds to the caller", async () => {
    const s = await seed();
    const ownerOf = await s.t.run(async (ctx) => {
      const limits = await ctx.db
        .query("contributionLimits")
        .withIndex("by_room", (q) => q.eq("roomId", s.roomId))
        .collect();
      return Object.fromEntries(limits.map((l) => [l.participantId, l.amountMinor]));
    });
    expect(ownerOf).toEqual({ [s.aliceP]: ALICE_CAP, [s.bobP]: BOB_CAP });
    const attempts = await s.t.run((ctx) =>
      ctx.db
        .query("paymentAttempts")
        .withIndex("by_revision", (q) => q.eq("revisionId", s.revisionId))
        .collect(),
    );
    expect(attempts.map((a) => [a._id, a.participantId]).sort()).toEqual(
      [
        [s.alice_.attemptId, s.aliceP],
        [s.bob_.attemptId, s.bobP],
      ].sort(),
    );
  });
});

describe("privacy retest: infeasible messages", () => {
  it("never name a participant or reveal a cap amount", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "user_alice|s1" });
    const bob = t.withIdentity({ subject: "user_bob|s2" });
    const created = unwrap(
      await alice.mutation(api.rooms.createRoom, {
        title: "Maya",
        recipientDisplayName: "Maya",
        occasion: "Birthday",
        displayName: "Alice",
      }),
    );
    const roomId = created.room._id;
    unwrap(await bob.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Bob" }));
    unwrap(await alice.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: ALICE_CAP }));
    unwrap(await bob.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: BOB_CAP }));
    const listingId = await seedListing(t, roomId, 9000);
    const revision = unwrap(await alice.mutation(api.proposals.selectGift, { roomId, listingId })).revision!;
    expect(revision.status).toBe("infeasible");

    const surfaces = [
      revision.conditions.join(" "),
      JSON.stringify(await alice.mutation(api.proposals.createProposal, { roomId })),
      JSON.stringify(await bob.mutation(api.proposals.createProposal, { roomId })),
      JSON.stringify(await bob.mutation(api.proposals.approveRevision, { revisionId: revision._id })),
      JSON.stringify(await bob.query(api.proposals.getProposal, { roomId })),
      JSON.stringify(await bob.query(api.proposals.listRevisions, { roomId })),
    ];
    expect(surfaces[1]).toContain(INFEASIBLE_CAPS_MESSAGE);
    for (const text of surfaces) {
      expect(text).not.toMatch(/Alice|Bob/);
      expect(containsAmount(text, ALICE_CAP)).toBe(false);
      // Bob's view includes his own limit; the cap must still not appear in shared text.
      if (!text.includes('"myLimit"')) expect(containsAmount(text, BOB_CAP)).toBe(false);
    }
    expect(containsAmount(JSON.stringify(await alice.query(api.proposals.getProposal, { roomId })), BOB_CAP)).toBe(false);
  });
});
