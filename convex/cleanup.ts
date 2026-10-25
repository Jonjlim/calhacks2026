/**
 * Removes uploads that never reached importMediaEvidence (closed tab, failed
 * request, rejected-then-abandoned file). Owner: Dev 3 (AI-018), alongside the media path.
 *
 * A file is kept while an evidenceMedia row references it; rows are deleted
 * together with their files after the read. Everything else older than the
 * grace period is unreachable by any client and is deleted. A claimed file
 * that is still unread after UNREAD_MEDIA_MAX_AGE_MS (extraction was never
 * started) is discarded with its source marked failed. Expired upload grants
 * (media.ts, Dev 2) are pruned here too.
 */
import { internalMutation } from "./_generated/server";
import { discardSourceMedia, UPLOAD_GRANT_TTL_MS } from "./media";

export const STALE_UPLOAD_GRACE_MS = 60 * 60 * 1000;
export const UNREAD_MEDIA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;

export const sweepStaleUploads = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number; more: boolean }> => {
    const now = Date.now();
    const cutoff = now - STALE_UPLOAD_GRACE_MS;
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
      // Shared room photos (D20) are kept until their uploader or the room deletes them.
      const shared = claimed ? null : await ctx.db.query("roomPhotos").withIndex("by_storage", (q) => q.eq("storageId", file._id)).first();
      if (shared) continue;
      if (claimed) {
        if (file._creationTime < now - UNREAD_MEDIA_MAX_AGE_MS) {
          await discardSourceMedia(ctx, claimed.sourceId, "failed");
          deleted++;
        }
        continue;
      }
      await ctx.storage.delete(file._id);
      deleted++;
    }
    const expiredGrants = await ctx.db
      .query("mediaUploadGrants")
      .withIndex("by_issued", (q) => q.lt("issuedAt", now - UPLOAD_GRANT_TTL_MS))
      .take(BATCH);
    for (const grant of expiredGrants) await ctx.db.delete(grant._id);
    return { deleted, more: old.length === BATCH || expiredGrants.length === BATCH };
  },
});
