/**
 * Evidence withdrawal shared by clues.deleteEvidence and rooms.leaveRoom.
 * Owner: Dev 2. Exports no Convex functions.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { discardSourceMedia } from "../media";

/**
 * Tombstones the source, hard-deletes its private messages and unread
 * uploads, marks dependent proposed clues `source_withdrawn`, and tombstones
 * published clues that came from it (dropping any attached excerpt). The
 * caller bumps knowledgeRevision when `publishedChanged` is true.
 */
export async function withdrawEvidenceSource(
  ctx: MutationCtx,
  source: Doc<"evidenceSources">,
): Promise<{ publishedChanged: boolean }> {
  const sourceId = source._id;
  await ctx.db.patch(sourceId, { deletedAt: Date.now(), sourceRevision: source.sourceRevision + 1 });

  const messages = await ctx.db
    .query("privateMessages")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .collect();
  for (const m of messages) await ctx.db.delete(m._id);
  await discardSourceMedia(ctx, sourceId, "deleted");

  let publishedChanged = false;
  const proposed = await ctx.db
    .query("proposedClues")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .collect();
  for (const clue of proposed) {
    if (clue.status !== "rejected") {
      await ctx.db.patch(clue._id, { status: "source_withdrawn", sourceMessageIds: [] });
    }
    if (await tombstonePublishedFrom(ctx, clue._id)) publishedChanged = true;
  }
  return { publishedChanged };
}

/** Returns true when an active published clue was tombstoned. */
async function tombstonePublishedFrom(ctx: MutationCtx, proposedClueId: Id<"proposedClues">): Promise<boolean> {
  let changed = false;
  const published = await ctx.db
    .query("publishedClues")
    .withIndex("by_proposed_clue", (q) => q.eq("proposedClueId", proposedClueId))
    .collect();
  for (const pub of published) {
    await ctx.db.patch(pub._id, {
      status: pub.status === "active" ? "source_withdrawn" : pub.status,
      excerpt: undefined,
      sourceMessageIds: [],
    });
    if (pub.status === "active") changed = true;
  }
  return changed;
}

/**
 * Hard-deletes every private row a participant owns in a room: evidence
 * sources (with messages and stored files) and proposed clues. Published
 * clues derived from that evidence become `source_withdrawn` tombstones and
 * lose their link to the deleted proposed clue; manual clues are untouched.
 */
export async function purgeParticipantPrivateData(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  participantId: Id<"participants">,
): Promise<{ publishedChanged: boolean }> {
  let publishedChanged = false;
  const sources = await ctx.db
    .query("evidenceSources")
    .withIndex("by_room_participant", (q) => q.eq("roomId", roomId).eq("participantId", participantId))
    .collect();
  for (const source of sources) {
    if (source.deletedAt === undefined) {
      if ((await withdrawEvidenceSource(ctx, source)).publishedChanged) publishedChanged = true;
    }
  }
  const proposed = await ctx.db
    .query("proposedClues")
    .withIndex("by_room_participant", (q) => q.eq("roomId", roomId).eq("participantId", participantId))
    .collect();
  for (const clue of proposed) {
    const linked = await ctx.db
      .query("publishedClues")
      .withIndex("by_proposed_clue", (q) => q.eq("proposedClueId", clue._id))
      .collect();
    for (const pub of linked) {
      await ctx.db.patch(pub._id, {
        status: pub.status === "active" ? "source_withdrawn" : pub.status,
        excerpt: undefined,
        sourceMessageIds: [],
        proposedClueId: undefined,
      });
      if (pub.status === "active") publishedChanged = true;
    }
    await ctx.db.delete(clue._id);
  }
  for (const source of sources) await ctx.db.delete(source._id);
  return { publishedChanged };
}
