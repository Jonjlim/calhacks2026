// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Dev 2 backend tests (BE-006 privacy, BE-011 approvals, membership, chat).
 * Uses convex-test against the real schema and functions.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../lib/contracts";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { canTransition } from "./jobs";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function errorCode<T>(result: Result<T>): string | null {
  return result.ok ? null : result.error.code;
}

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "user_alice|session1" });
  const bob = t.withIdentity({ subject: "user_bob|session2" });
  const eve = t.withIdentity({ subject: "user_eve|session3" });
  const created = unwrap(
    await alice.mutation(api.rooms.createRoom, {
      title: "Maya's birthday",
      recipientDisplayName: "Maya",
      occasion: "Birthday",
      displayName: "Alice",
    }),
  );
  const roomId = created.room._id;
  const joined = unwrap(await bob.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Bob" }));
  return { t, alice, bob, eve, roomId, inviteToken: created.inviteToken, aliceP: created.participant._id, bobP: joined.participant._id };
}

async function seedListing(
  t: ReturnType<typeof convexTest>,
  roomId: Id<"rooms">,
  overrides: { priceMinor?: number; title?: string } = {},
) {
  return await t.run(async (ctx) => {
    const room = (await ctx.db.get(roomId))!;
    const jobId = await ctx.db.insert("researchJobs", {
      roomId,
      knowledgeRevision: room.knowledgeRevision,
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
      title: overrides.title ?? "Mini pottery wheel",
      currency: "USD",
      priceMinor: overrides.priceMinor ?? 9000,
      priceStatus: "observed",
      availability: "in_stock",
      shippingStatus: "unknown",
      retrievedAt: Date.now(),
      status: "active",
    });
  });
}

async function extractJob(t: ReturnType<typeof convexTest>, roomId: Id<"rooms">, participantId: Id<"participants">) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("agentJobs", {
        roomId,
        kind: "extract",
        status: "running",
        inputHash: `x-${Math.random()}`,
        idempotencyKey: `x-${Math.random()}`,
        attempt: 1,
        actingParticipantId: participantId,
        createdAt: Date.now(),
      }),
  );
}

beforeEach(() => {
  // Keeps scheduled agent actions (Dev 3 stubs) from running during tests.
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("rooms and membership", () => {
  it("requires auth to create and join", async () => {
    const t = convexTest(schema, modules);
    expect(
      errorCode(await t.mutation(api.rooms.createRoom, { title: "x", recipientDisplayName: "y", occasion: "z" })),
    ).toBe("unauthorized");
    expect(errorCode(await t.mutation(api.rooms.joinRoom, { inviteToken: "nope", displayName: "n" }))).toBe(
      "unauthorized",
    );
  });

  it("validates room input", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "a" });
    expect(
      errorCode(await alice.mutation(api.rooms.createRoom, { title: "  ", recipientDisplayName: "M", occasion: "B" })),
    ).toBe("validation_failed");
    expect(
      errorCode(
        await alice.mutation(api.rooms.createRoom, {
          title: "T",
          recipientDisplayName: "M",
          occasion: "B",
          budgetMinor: -100,
        }),
      ),
    ).toBe("validation_failed");
  });

  it("joins by token, is idempotent, and blocks outsiders", async () => {
    const { bob, eve, roomId, inviteToken, bobP } = await setup();
    expect(errorCode(await eve.mutation(api.rooms.joinRoom, { inviteToken: "bad", displayName: "Eve" }))).toBe(
      "not_found",
    );
    const again = unwrap(await bob.mutation(api.rooms.joinRoom, { inviteToken, displayName: "Bobby" }));
    expect(again.participant._id).toBe(bobP);

    const view = unwrap(await bob.query(api.rooms.getRoom, { roomId }));
    expect(view.participants.map((p) => p.role).sort()).toEqual(["contributor", "organizer"]);
    expect(view.me.id).toBe(bobP);

    expect(errorCode(await eve.query(api.rooms.getRoom, { roomId }))).toBe("unauthorized");
    expect(errorCode(await eve.query(api.messages.listMessages, { roomId }))).toBe("unauthorized");
    expect(errorCode(await eve.query(api.clues.listPublishedClues, { roomId }))).toBe("unauthorized");
    expect(errorCode(await eve.query(api.proposals.getProposal, { roomId }))).toBe("unauthorized");

    const preview = unwrap(await eve.query(api.rooms.previewInvite, { inviteToken }));
    expect(preview).toMatchObject({ title: "Maya's birthday", participantCount: 2, alreadyMember: false });
  });
});

describe("chat", () => {
  it("syncs, dedupes by idempotency key, and enqueues one evaluate job per message", async () => {
    const { t, alice, bob, roomId } = await setup();
    const first = unwrap(
      await alice.mutation(api.messages.sendMessage, { roomId, body: "She loves pottery", clientIdempotencyKey: "k1" }),
    );
    const dup = unwrap(
      await alice.mutation(api.messages.sendMessage, { roomId, body: "She loves pottery", clientIdempotencyKey: "k1" }),
    );
    expect(dup._id).toBe(first._id);
    expect(
      errorCode(await bob.mutation(api.messages.sendMessage, { roomId, body: "x", clientIdempotencyKey: "k1" })),
    ).toBe("validation_failed");
    expect(
      errorCode(await bob.mutation(api.messages.sendMessage, { roomId, body: "   ", clientIdempotencyKey: "k2" })),
    ).toBe("validation_failed");

    const transcript = unwrap(await bob.query(api.messages.listMessages, { roomId }));
    expect(transcript.map((m) => m.body)).toEqual(["She loves pottery"]);

    const jobs = await t.run(async (ctx) =>
      ctx.db
        .query("agentJobs")
        .withIndex("by_room", (q) => q.eq("roomId", roomId))
        .collect(),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "evaluate_thread", status: "pending" });

    const agentMsg = unwrap(await t.mutation(internal.messages.postAgentMessage, { jobId: jobs[0]!._id, body: "Noted!" }));
    const agentAgain = unwrap(await t.mutation(internal.messages.postAgentMessage, { jobId: jobs[0]!._id, body: "Noted!" }));
    expect(agentAgain._id).toBe(agentMsg._id);
    expect(agentMsg.authorKind).toBe("buyer_agent");
  });
});

describe("evidence and clue privacy", () => {
  it("keeps imports and proposed clues owner-only; publishing shares only the clue", async () => {
    const { t, alice, bob, roomId, aliceP, bobP } = await setup();
    const imported = unwrap(
      await alice.mutation(api.clues.importEvidence, {
        roomId,
        kind: "paste",
        label: "Texts with Maya",
        rawText: "Maya: I want to try pottery\nMe: cool\n\nMaya: I already have a starter kit",
      }),
    );
    expect(imported.messages).toHaveLength(3);
    expect(imported.messages[0]).toMatchObject({ speakerHint: "Maya", body: "I want to try pottery" });
    const sourceId = imported.source._id;

    expect(unwrap(await bob.query(api.clues.listMyEvidence, { roomId }))).toHaveLength(0);
    expect(errorCode(await bob.query(api.clues.getMyEvidenceMessages, { sourceId }))).toBe("not_found");
    expect(errorCode(await bob.mutation(api.clues.deleteEvidence, { sourceId }))).toBe("not_found");
    expect(unwrap(await alice.query(api.clues.getMyEvidenceMessages, { sourceId }))).toHaveLength(3);

    // An extract job acting as Bob cannot read or write Alice's evidence.
    const bobJob = await extractJob(t, roomId, bobP);
    expect(errorCode(await t.query(internal.clues.getOwnEvidenceForJob, { jobId: bobJob, sourceId }))).toBe(
      "unauthorized",
    );
    expect(
      errorCode(await t.mutation(internal.clues.insertProposedClues, { jobId: bobJob, sourceId, clues: [] })),
    ).toBe("unauthorized");

    const aliceJob = await extractJob(t, roomId, aliceP);
    unwrap(await t.query(internal.clues.getOwnEvidenceForJob, { jobId: aliceJob, sourceId }));
    const inserted = unwrap(
      await t.mutation(internal.clues.insertProposedClues, {
        jobId: aliceJob,
        sourceId,
        clues: [
          {
            kind: "interest",
            text: "Wants to try pottery",
            confidence: 0.9,
            sourceMessageIds: [imported.messages[0]!._id],
            speakerAssumption: "recipient",
            contradictsClueIds: [],
          },
          {
            kind: "ownership",
            text: "Already owns a starter kit",
            confidence: 0.8,
            sourceMessageIds: [imported.messages[2]!._id],
            speakerAssumption: "recipient",
            contradictsClueIds: [],
          },
          {
            kind: "uncertain",
            text: "Bad confidence",
            confidence: 7,
            sourceMessageIds: [],
            speakerAssumption: "unknown",
            contradictsClueIds: [],
          },
        ],
      }),
    );
    expect(inserted.insertedIds).toHaveLength(2);
    expect(inserted.dropped).toBe(1);
    const [potteryId, kitId] = inserted.insertedIds as [Id<"proposedClues">, Id<"proposedClues">];

    expect(unwrap(await bob.query(api.clues.listMyProposedClues, { roomId }))).toHaveLength(0);
    expect(unwrap(await alice.query(api.clues.listMyProposedClues, { roomId }))).toHaveLength(2);
    expect(errorCode(await bob.mutation(api.clues.publishClue, { proposedClueId: potteryId }))).toBe("not_found");
    expect(errorCode(await bob.mutation(api.clues.rejectProposedClue, { proposedClueId: kitId }))).toBe("not_found");

    const before = unwrap(await bob.query(api.rooms.getRoom, { roomId })).room.knowledgeRevision;
    const published = unwrap(
      await alice.mutation(api.clues.publishClue, { proposedClueId: potteryId, excerpt: "I want to try pottery" }),
    );
    expect(published).toMatchObject({ sourceKind: "paste", status: "active", publisherId: aliceP });
    const again = unwrap(await alice.mutation(api.clues.publishClue, { proposedClueId: potteryId }));
    expect(again._id).toBe(published._id);
    const after = unwrap(await bob.query(api.rooms.getRoom, { roomId })).room.knowledgeRevision;
    expect(after).toBe(before + 1);

    const bobSees = unwrap(await bob.query(api.clues.listPublishedClues, { roomId }));
    expect(bobSees.map((c) => c.text)).toEqual(["Wants to try pottery"]);
    expect(JSON.stringify(bobSees)).not.toContain("starter kit");

    expect(errorCode(await bob.mutation(api.clues.withdrawClue, { publishedClueId: published._id }))).toBe(
      "unauthorized",
    );

    // Deleting the import tombstones dependents and drops the excerpt.
    unwrap(await alice.mutation(api.clues.deleteEvidence, { sourceId }));
    const tomb = unwrap(await bob.query(api.clues.listPublishedClues, { roomId }));
    expect(tomb[0]).toMatchObject({ status: "source_withdrawn", sourceMessageIds: [] });
    expect(tomb[0]!.excerpt).toBeUndefined();
    const left = await t.run(async (ctx) =>
      ctx.db
        .query("privateMessages")
        .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
        .collect(),
    );
    expect(left).toHaveLength(0);
    const kit = unwrap(await alice.query(api.clues.listMyProposedClues, { roomId })).find((c) => c._id === kitId);
    expect(kit?.status).toBe("source_withdrawn");
    expect(unwrap(await bob.query(api.rooms.getRoom, { roomId })).room.knowledgeRevision).toBe(after + 1);
  });

  it("adds manual clues without an import and dedupes them", async () => {
    const { bob, roomId } = await setup();
    const a = unwrap(await bob.mutation(api.clues.upsertManualPreference, { roomId, kind: "exclusion", text: "No candles" }));
    const b = unwrap(await bob.mutation(api.clues.upsertManualPreference, { roomId, kind: "exclusion", text: "no candles" }));
    expect(b._id).toBe(a._id);
    expect(a.sourceKind).toBe("manual");
    expect(
      errorCode(await bob.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text: "" })),
    ).toBe("validation_failed");
  });
});

describe("selection, caps, proposals, approvals", () => {
  it("runs the full revision lifecycle with private caps", async () => {
    const { t, alice, bob, roomId, aliceP, bobP } = await setup();
    const listingId = await seedListing(t, roomId, { priceMinor: 9000 });

    expect(errorCode(await bob.mutation(api.proposals.selectGift, { roomId, listingId }))).toBe("unauthorized");
    expect(errorCode(await alice.mutation(api.proposals.createProposal, { roomId }))).toBe("not_found");

    // Caps unset count as 0: the first revision is infeasible and shows no shares.
    const selected = unwrap(await alice.mutation(api.proposals.selectGift, { roomId, listingId }));
    expect(selected.revision?.status).toBe("infeasible");
    expect(selected.revision?.shares).toEqual([]);
    expect(errorCode(await alice.mutation(api.proposals.createProposal, { roomId }))).toBe("infeasible");
    expect(errorCode(await alice.mutation(api.proposals.approveRevision, { revisionId: selected.revision!._id }))).toBe(
      "infeasible",
    );

    expect(errorCode(await alice.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: -1 }))).toBe(
      "validation_failed",
    );
    expect(errorCode(await alice.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 10.5 }))).toBe(
      "validation_failed",
    );
    unwrap(await alice.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 8000 }));
    const bobCap = unwrap(await bob.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 1500 }));
    const rev1 = bobCap.revision!;
    expect(rev1.status).toBe("awaiting_approval");
    expect(rev1.shares).toEqual([
      { participantId: aliceP, amountMinor: 7500 },
      { participantId: bobP, amountMinor: 1500 },
    ]);

    // Bob sees frozen shares and his own cap, never Alice's cap.
    const bobView = unwrap(await bob.query(api.proposals.getProposal, { roomId }));
    expect(bobView.feasible).toBe(true);
    expect(bobView.myLimit?.amountMinor).toBe(1500);
    expect(JSON.stringify(bobView)).not.toContain("8000");
    expect(unwrap(await bob.query(api.proposals.getMyContributionLimit, { roomId }))?.amountMinor).toBe(1500);

    // createProposal is idempotent when nothing changed.
    const ensured = unwrap(await alice.mutation(api.proposals.createProposal, { roomId }));
    expect(ensured.revision?.id).toBe(rev1._id);

    unwrap(await alice.mutation(api.proposals.approveRevision, { revisionId: rev1._id }));
    unwrap(await bob.mutation(api.proposals.approveRevision, { revisionId: rev1._id }));
    const pledged = unwrap(await alice.query(api.proposals.getProposal, { roomId }));
    expect(pledged.revision?.status).toBe("approved_pledged");
    expect(pledged.approvals.every((a) => a.status === "approved")).toBe(true);

    // Changing a cap mints revision 2 and invalidates revision 1 approvals.
    const changed = unwrap(await bob.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 4000 }));
    const rev2 = changed.revision!;
    expect(rev2._id).not.toBe(rev1._id);
    expect(rev2.revisionNumber).toBe(rev1.revisionNumber + 1);
    expect(rev2.shares.map((s) => s.amountMinor)).toEqual([5000, 4000]);
    const oldApprovals = await t.run(async (ctx) =>
      ctx.db
        .query("approvals")
        .withIndex("by_revision", (q) => q.eq("revisionId", rev1._id))
        .collect(),
    );
    expect(oldApprovals.map((a) => a.status)).toEqual(["invalidated", "invalidated"]);
    const oldRev = await t.run(async (ctx) => ctx.db.get(rev1._id));
    expect(oldRev?.status).toBe("superseded");

    // A stale approval cannot pass.
    expect(errorCode(await alice.mutation(api.proposals.approveRevision, { revisionId: rev1._id }))).toBe(
      "invalid_revision",
    );
    expect(unwrap(await alice.query(api.proposals.getProposal, { roomId })).approvals.map((a) => a.status)).toEqual([
      "pending",
      "pending",
    ]);

    // Re-saving a cap that leaves shares unchanged does not mint a revision.
    const same = unwrap(await bob.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 4500 }));
    expect(same.revision?._id).not.toBe(rev2._id);
    const stable = unwrap(await alice.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 8000 }));
    expect(stable.revision?._id).toBe(same.revision?._id);

    // Changing the gift supersedes the revision too.
    const other = await seedListing(t, roomId, { priceMinor: 5000, title: "Glaze set" });
    const reselected = unwrap(await alice.mutation(api.proposals.selectGift, { roomId, listingId: other }));
    expect(reselected.revision?.listingId).toBe(other);
    expect(reselected.revision?.shares.map((s) => s.amountMinor)).toEqual([2500, 2500]);

    // Withdrawing an approval reopens a pledged revision.
    const rev = reselected.revision!;
    unwrap(await alice.mutation(api.proposals.approveRevision, { revisionId: rev._id }));
    unwrap(await bob.mutation(api.proposals.approveRevision, { revisionId: rev._id }));
    unwrap(await bob.mutation(api.proposals.withdrawApproval, { revisionId: rev._id }));
    expect(unwrap(await alice.query(api.proposals.getProposal, { roomId })).revision?.status).toBe("awaiting_approval");

    // Invalidating the listing clears the selection and the current revision.
    await t.run(async (ctx) => ctx.db.patch(other, { status: "invalid" }));
    unwrap(await t.mutation(internal.proposals.clearSelectionsForListing, { listingId: other }));
    const cleared = unwrap(await alice.query(api.proposals.getProposal, { roomId }));
    expect(cleared.revision).toBeNull();
    expect(unwrap(await alice.query(api.proposals.getSelection, { roomId }))).toBeNull();
  });

  it("re-allocates when someone joins mid-proposal", async () => {
    const { t, alice, roomId, inviteToken } = await setup();
    const listingId = await seedListing(t, roomId, { priceMinor: 3000 });
    unwrap(await alice.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: 5000 }));
    const first = unwrap(await alice.mutation(api.proposals.selectGift, { roomId, listingId })).revision!;
    const carol = t.withIdentity({ subject: "user_carol" });
    unwrap(await carol.mutation(api.rooms.joinRoom, { inviteToken, displayName: "Carol" }));
    const view = unwrap(await alice.query(api.proposals.getProposal, { roomId }));
    expect(view.revision?.id).not.toBe(first._id);
    expect(view.shares).toHaveLength(3);
  });
});

describe("votes", () => {
  it("keeps one vote per participant per listing", async () => {
    const { t, alice, bob, eve, roomId } = await setup();
    const listingId = await seedListing(t, roomId);
    unwrap(await alice.mutation(api.votes.castVote, { roomId, listingId, value: "up" }));
    unwrap(await bob.mutation(api.votes.castVote, { roomId, listingId, value: "down" }));
    const res = unwrap(await bob.mutation(api.votes.castVote, { roomId, listingId, value: "up" }));
    expect(res.tally).toEqual({ up: 2, down: 0, flag_duplicate: 0 });
    expect(errorCode(await eve.mutation(api.votes.castVote, { roomId, listingId, value: "up" }))).toBe("unauthorized");
    const rows = unwrap(await alice.query(api.votes.listVotes, { roomId }));
    expect(rows[0]).toMatchObject({ myVote: "up", tally: { up: 2 } });
  });
});

describe("jobs", () => {
  it("enforces status transitions", () => {
    expect(canTransition("pending", "running", 0)).toBe(true);
    expect(canTransition("running", "succeeded", 1)).toBe(true);
    expect(canTransition("running", "uncertain", 1)).toBe(true);
    expect(canTransition("uncertain", "succeeded", 1)).toBe(true);
    expect(canTransition("succeeded", "running", 1)).toBe(false);
    expect(canTransition("stale", "succeeded", 1)).toBe(false);
    expect(canTransition("failed", "running", 1)).toBe(true);
    expect(canTransition("failed", "running", 3)).toBe(false);
    expect(canTransition("running", "pending", 1)).toBe(false);
  });

  it("hides other people's extraction jobs and rejects terminal rewrites", async () => {
    const { t, alice, bob, roomId, aliceP } = await setup();
    const jobId = await extractJob(t, roomId, aliceP);
    const aliceJobs = unwrap(await alice.query(api.jobs.listRoomJobs, { roomId }));
    const bobJobs = unwrap(await bob.query(api.jobs.listRoomJobs, { roomId }));
    expect(aliceJobs.agentJobs.map((j) => j._id)).toContain(jobId);
    expect(bobJobs.agentJobs.map((j) => j._id)).not.toContain(jobId);

    unwrap(await t.mutation(internal.jobs.setAgentJobStatus, { jobId, status: "succeeded" }));
    expect(errorCode(await t.mutation(internal.jobs.setAgentJobStatus, { jobId, status: "failed" }))).toBe(
      "stale_job",
    );
  });
});
