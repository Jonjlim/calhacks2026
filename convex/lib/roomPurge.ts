/**
 * BE-017 room purge. Owner: Dev 2. Exports no Convex functions; the
 * scheduled entry point is internal.rooms.purgeRoomBatch.
 *
 * Every room-scoped table is reached through a roomId index or through a
 * room-scoped parent (privateMessages and evidenceMedia via evidenceSources,
 * approvals and paymentAttempts via proposalRevisions, councilEvents via
 * councilRuns, recipient preferences and grants via recipientProfiles).
 *
 * Job tables go first: every agent/research/council commit path loads its job
 * or run row and gives up when it is missing, so once those rows are gone an
 * in-flight action cannot write new room rows behind the purge.
 */
import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type Purger = (ctx: MutationCtx, roomId: Id<"rooms">, limit: number) => Promise<number>;

async function deleteAll<T extends TableNames>(ctx: MutationCtx, rows: Array<{ _id: Id<T> }>) {
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

/** Storage may already be gone (read-once media); a missing file is not an error here. */
async function deleteStorage(ctx: MutationCtx, storageId: Id<"_storage">) {
  if (await ctx.db.system.get(storageId)) await ctx.storage.delete(storageId);
}

const researchJobs: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("researchJobs").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const fashionJobs: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("fashionJobs").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const trendJobs: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("trendJobs").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const trendPasses: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("trendPasses").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const agentJobs: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("agentJobs").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const councilRuns: Purger = async (ctx, roomId, limit) => {
  const run = await ctx.db.query("councilRuns").withIndex("by_room", (q) => q.eq("roomId", roomId)).first();
  if (!run) return 0;
  const events = await ctx.db
    .query("councilEvents")
    .withIndex("by_run_sequence", (q) => q.eq("runId", run.runId))
    .take(limit);
  let n = await deleteAll(ctx, events);
  if (events.length < limit) {
    await ctx.db.delete(run._id);
    n += 1;
  }
  return n;
};

const evidenceSources: Purger = async (ctx, roomId, limit) => {
  const source = await ctx.db
    .query("evidenceSources")
    .withIndex("by_room_participant", (q) => q.eq("roomId", roomId))
    .first();
  if (!source) return 0;
  const messages = await ctx.db
    .query("privateMessages")
    .withIndex("by_source", (q) => q.eq("sourceId", source._id))
    .take(limit);
  let n = await deleteAll(ctx, messages);
  if (n >= limit) return n;
  const media = await ctx.db
    .query("evidenceMedia")
    .withIndex("by_source", (q) => q.eq("sourceId", source._id))
    .take(limit - n);
  for (const row of media) {
    await deleteStorage(ctx, row.storageId);
    await ctx.db.delete(row._id);
  }
  const mediaDone = media.length < limit - n;
  n += media.length;
  if (mediaDone) {
    await ctx.db.delete(source._id);
    n += 1;
  }
  return n;
};

const mediaUploadGrants: Purger = async (ctx, roomId, limit) =>
  deleteAll(
    ctx,
    await ctx.db.query("mediaUploadGrants").withIndex("by_room_participant_issued", (q) => q.eq("roomId", roomId)).take(limit),
  );

const proposedClues: Purger = async (ctx, roomId, limit) =>
  deleteAll(
    ctx,
    await ctx.db.query("proposedClues").withIndex("by_room_participant", (q) => q.eq("roomId", roomId)).take(limit),
  );

const contributionLimits: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("contributionLimits").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const recipientProfiles: Purger = async (ctx, roomId, limit) => {
  const profile = await ctx.db.query("recipientProfiles").withIndex("by_room", (q) => q.eq("roomId", roomId)).first();
  if (!profile) return 0;
  const prefs = await ctx.db
    .query("recipientPreferences")
    .withIndex("by_profile", (q) => q.eq("recipientProfileId", profile._id))
    .take(limit);
  let n = await deleteAll(ctx, prefs);
  if (n >= limit) return n;
  const grants = await ctx.db
    .query("recipientGrants")
    .withIndex("by_profile", (q) => q.eq("recipientProfileId", profile._id))
    .take(limit - n);
  n += await deleteAll(ctx, grants);
  if (prefs.length + grants.length < limit) {
    await ctx.db.delete(profile._id);
    n += 1;
  }
  return n;
};

const chatMessages: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("chatMessages").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const publishedClues: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const agentDecisions: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("agentDecisions").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const agentEvents: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("agentEvents").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const askedSlots: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("askedSlots").withIndex("by_room_slot", (q) => q.eq("roomId", roomId)).take(limit));

const votes: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("votes").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const recommendations: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("recommendations").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const proposalRevisions: Purger = async (ctx, roomId, limit) => {
  const revision = await ctx.db.query("proposalRevisions").withIndex("by_room", (q) => q.eq("roomId", roomId)).first();
  if (!revision) return 0;
  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_revision", (q) => q.eq("revisionId", revision._id))
    .take(limit);
  let n = await deleteAll(ctx, approvals);
  if (n >= limit) return n;
  const attempts = await ctx.db
    .query("paymentAttempts")
    .withIndex("by_revision", (q) => q.eq("revisionId", revision._id))
    .take(limit - n);
  n += await deleteAll(ctx, attempts);
  if (approvals.length + attempts.length < limit) {
    await ctx.db.delete(revision._id);
    n += 1;
  }
  return n;
};

const giftSelections: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("giftSelections").withIndex("by_room_status", (q) => q.eq("roomId", roomId)).take(limit));

const productListings: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("productListings").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const giftDecorations: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("giftDecorations").withIndex("by_room_memory", (q) => q.eq("roomId", roomId)).take(limit));

const giftWorlds: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("giftWorlds").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

const paymentSimulations: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("paymentSimulations").withIndex("by_room", q => q.eq("roomId", roomId)).take(limit));

const participants: Purger = async (ctx, roomId, limit) =>
  deleteAll(ctx, await ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(limit));

/** Order matters: jobs first (see file comment), private data next, membership last. */
export const PURGE_PHASES: ReadonlyArray<readonly [string, Purger]> = [
  ["fashionJobs", fashionJobs],
  ["trendPasses", trendPasses],
  ["trendJobs", trendJobs],
  ["researchJobs", researchJobs],
  ["agentJobs", agentJobs],
  ["councilRuns", councilRuns],
  ["evidenceSources", evidenceSources],
  ["mediaUploadGrants", mediaUploadGrants],
  ["proposedClues", proposedClues],
  ["contributionLimits", contributionLimits],
  ["recipientProfiles", recipientProfiles],
  ["chatMessages", chatMessages],
  ["publishedClues", publishedClues],
  ["agentDecisions", agentDecisions],
  ["agentEvents", agentEvents],
  ["askedSlots", askedSlots],
  ["votes", votes],
  ["recommendations", recommendations],
  ["paymentSimulations", paymentSimulations],
  ["proposalRevisions", proposalRevisions],
  ["giftSelections", giftSelections],
  ["productListings", productListings],
  ["giftDecorations", giftDecorations],
  ["giftWorlds", giftWorlds],
  ["participants", participants],
];

/**
 * Deletes up to `budget` documents of the room's data. Returns `done: true`
 * once every phase is empty and the room document itself is deleted.
 */
export async function purgeRoomStep(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  budget: number,
): Promise<{ deleted: number; done: boolean }> {
  let deleted = 0;
  for (const [, purge] of PURGE_PHASES) {
    for (;;) {
      if (deleted >= budget) return { deleted, done: false };
      const n = await purge(ctx, roomId, budget - deleted);
      if (n === 0) break;
      deleted += n;
    }
  }
  const room = await ctx.db.get(roomId);
  if (room) await ctx.db.delete(roomId);
  return { deleted: deleted + (room ? 1 : 0), done: true };
}
