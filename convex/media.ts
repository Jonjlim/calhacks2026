/**
 * Photo and screenshot uploads. Owner: Dev 2 (BE-018); first implementation by Dev 3 to unblock AI-018.
 *
 * Files are owner-only, validated on arrival, read once by the extractor, and
 * deleted afterwards (or on failure, timeout, or withdrawal). Photos shared with
 * the room on the gift map are separate uploads in `roomPhotos` (D20, convex/photos.ts)
 * and can never be claimed here. EXIF/GPS is
 * stripped in the browser by re-encoding; this endpoint never trusts that.
 *
 * Convex cannot bind an upload URL to the storage id it produces, so every
 * issued URL records a `mediaUploadGrants` row. A file can be claimed only
 * against one of the caller's own unused grants issued before the file was
 * created and within the last hour, and URLs are rate limited per member. A
 * storage id leaked to another member could still be claimed by them if they
 * hold a grant older than the file; storage ids are only ever returned to the
 * uploading browser, so this requires the id to leak first.
 *
 * Content type and size come from Convex `_storage` metadata. Size is measured
 * by Convex; contentType is the upload request's header, so it is a claim, not
 * a sniffed fact. Mutations cannot read file bytes; the extraction action is
 * the first code that sees them.
 *
 * Rejections never delete a file the caller did not upload: non-members and
 * unauthenticated callers delete nothing, and validation failures delete only
 * unclaimed files matched to the caller's own grants. Anything else left
 * behind is removed by `cleanup.sweepStaleUploads`.
 */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { cleanText } from "./lib/input";
import { err, memberError, ok } from "./lib/result";

export const MEDIA_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** ~2.2 MB of bytes is ~3M base64 characters, the model adapter's per-image cap. */
export const MEDIA_MAX_BYTES = 2_200_000;
export const MEDIA_MAX_FILES = 3;
/** One URL per file, so this allows four full three-file imports per window. */
export const UPLOAD_URL_LIMIT = 12;
export const UPLOAD_URL_WINDOW_MS = 10 * 60 * 1000;
/** Matches Convex's upload URL lifetime and the stale-upload sweep grace period. */
export const UPLOAD_GRANT_TTL_MS = 60 * 60 * 1000;
const LABEL_MAX_CHARS = 80;
const GRANT_PRUNE_BATCH = 50;

export const generateEvidenceUploadUrl = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    type Out = { uploadUrl: string };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Out>(member.code);
    const participantId = member.me._id;
    const now = Date.now();

    const expired = await ctx.db
      .query("mediaUploadGrants")
      .withIndex("by_room_participant_issued", (q) =>
        q.eq("roomId", roomId).eq("participantId", participantId).lt("issuedAt", now - UPLOAD_GRANT_TTL_MS),
      )
      .take(GRANT_PRUNE_BATCH);
    for (const grant of expired) await ctx.db.delete(grant._id);

    const recent = await ctx.db
      .query("mediaUploadGrants")
      .withIndex("by_room_participant_issued", (q) =>
        q.eq("roomId", roomId).eq("participantId", participantId).gt("issuedAt", now - UPLOAD_URL_WINDOW_MS),
      )
      .take(UPLOAD_URL_LIMIT);
    if (recent.length >= UPLOAD_URL_LIMIT)
      return err<Out>("refused", "Too many uploads right now. Try again in a few minutes.");

    await ctx.db.insert("mediaUploadGrants", { roomId, participantId, issuedAt: now });
    return ok<Out>({ uploadUrl: await ctx.storage.generateUploadUrl() });
  },
});

/** Deletes the stored files and their rows for a source, and records the final media status. */
export async function discardSourceMedia(
  ctx: MutationCtx,
  sourceId: Id<"evidenceSources">,
  status: "read" | "failed" | "deleted",
): Promise<void> {
  const rows = await ctx.db
    .query("evidenceMedia")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .collect();
  for (const row of rows) {
    if (await ctx.db.system.get(row.storageId)) await ctx.storage.delete(row.storageId);
    await ctx.db.delete(row._id);
  }
  const source = await ctx.db.get(sourceId);
  if (source?.media) await ctx.db.patch(sourceId, { media: { ...source.media, status } });
}

export const importMediaEvidence = mutation({
  args: {
    roomId: v.id("rooms"),
    kind: v.union(v.literal("photo"), v.literal("screenshot")),
    label: v.string(),
    files: v.array(
      v.object({
        storageId: v.id("_storage"),
        /** photo only: the uploader's tap on the recipient, normalized 0–1. */
        marker: v.optional(v.object({ x: v.number(), y: v.number() })),
      }),
    ),
  },
  handler: async (ctx, args) => {
    type Out = { source: Doc<"evidenceSources"> };
    const member = await requireMember(ctx, args.roomId);
    // Deleting here would let anyone who learns a storage id destroy another member's upload.
    if (!member.ok) return memberError<Out>(member.code);
    const participantId = member.me._id;

    if (args.files.length < 1 || args.files.length > MEDIA_MAX_FILES)
      return err<Out>("validation_failed", `Upload between 1 and ${MEDIA_MAX_FILES} images.`);
    if (new Set(args.files.map((f) => f.storageId)).size !== args.files.length)
      return err<Out>("validation_failed", "The same file was added twice.");

    const files = await Promise.all(
      args.files.map(async (file) => {
        const meta = await ctx.db.system.get(file.storageId);
        const claimed = meta
          ? await ctx.db
              .query("evidenceMedia")
              .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
              .first()
          : null;
        // A shared room photo must never enter the read-once pipeline, which deletes its file.
        const shared = meta ? await ctx.db.query("roomPhotos").withIndex("by_storage", (q) => q.eq("storageId", file.storageId)).first() : null;
        return { ...file, meta, claimed: claimed !== null || shared !== null };
      }),
    );

    // Bind each unclaimed file to one of the caller's unused grants issued before it was created.
    // Any open grant at or before a file's creation also precedes every later file, so the greedy pass is optimal.
    const grants = (
      await ctx.db
        .query("mediaUploadGrants")
        .withIndex("by_room_participant_issued", (q) =>
          q
            .eq("roomId", args.roomId)
            .eq("participantId", participantId)
            .gte("issuedAt", Date.now() - UPLOAD_GRANT_TTL_MS),
        )
        .collect()
    ).filter((g) => g.storageId === undefined);
    const grantFor = new Map<Id<"_storage">, Id<"mediaUploadGrants">>();
    const ordered = files
      .filter((f) => f.meta && !f.claimed)
      .sort((a, b) => a.meta!._creationTime - b.meta!._creationTime);
    for (const file of ordered) {
      const index = grants.findIndex((g) => g.issuedAt <= file.meta!._creationTime);
      if (index === -1) continue;
      grantFor.set(file.storageId, grants[index]!._id);
      grants.splice(index, 1);
    }

    const reject = async (message: string) => {
      for (const file of files) {
        const grantId = grantFor.get(file.storageId);
        if (!grantId) continue;
        await ctx.storage.delete(file.storageId);
        await ctx.db.patch(grantId, { storageId: file.storageId });
      }
      return err<Out>("validation_failed", message);
    };

    const label = cleanText(args.label || (args.kind === "photo" ? "Photos" : "Screenshots"), LABEL_MAX_CHARS);
    if (!label) return reject("Label is too long.");

    for (const file of files) {
      if (!file.meta) return reject("That upload is missing or expired. Add the image again.");
      if (file.claimed) return reject("That file is already in use.");
      if (!grantFor.has(file.storageId))
        return reject("That upload is missing or expired. Add the image again.");
      if (!MEDIA_CONTENT_TYPES.includes(file.meta.contentType ?? "") || file.meta.size > MEDIA_MAX_BYTES)
        return reject("Images must be JPEG, PNG, or WebP and under 2 MB.");
      const m = file.marker;
      if (m && args.kind !== "photo") return reject("Only photos can mark a recipient.");
      if (m && !(m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1)) return reject("Marker is outside the photo.");
    }

    const sourceId = await ctx.db.insert("evidenceSources", {
      roomId: args.roomId,
      participantId,
      kind: args.kind,
      label,
      sourceRevision: 1,
      media: {
        count: files.length,
        ...(args.kind === "photo"
          ? { recipientMarkers: files.flatMap((f) => (f.marker ? [f.marker] : [])) }
          : {}),
        status: "uploaded",
      },
      createdAt: Date.now(),
    });
    for (const [mediaIndex, file] of files.entries()) {
      await ctx.db.patch(grantFor.get(file.storageId)!, { storageId: file.storageId });
      await ctx.db.insert("evidenceMedia", {
        sourceId,
        participantId,
        mediaIndex,
        storageId: file.storageId,
        contentType: file.meta!.contentType!,
        ...(file.marker ? { marker: file.marker } : {}),
      });
    }
    return ok<Out>({ source: (await ctx.db.get(sourceId))! });
  },
});
