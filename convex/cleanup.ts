/**
 * Removes uploads that never reached importMediaEvidence (closed tab, failed
 * request, rejected-then-abandoned file). Owner: Dev 3 (AI-018), alongside the media path.
 *
 * A file is kept while an evidenceMedia row references it; rows are deleted
 * together with their files after the read. Everything else older than the
 * grace period is unreachable by any client and is deleted.
 */
import { internalMutation } from "./_generated/server";

export const STALE_UPLOAD_GRACE_MS = 60 * 60 * 1000;
const BATCH = 100;

export const sweepStaleUploads = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number; more: boolean }> => {
    const cutoff = Date.now() - STALE_UPLOAD_GRACE_MS;
    const old = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(BATCH);
    let deleted = 0;
    for (const file of old) {
      const claimed = await ctx.db
        .query("evidenceMedia")
        .withIndex("by_storage", (q) => q.eq("storageId", file._id))
        .first();
      if (claimed) continue;
      await ctx.storage.delete(file._id);
      deleted++;
    }
    return { deleted, more: old.length === BATCH };
  },
});
