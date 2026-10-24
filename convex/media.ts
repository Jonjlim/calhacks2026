/**
 * Photo and screenshot uploads. Owner: Dev 2 (BE-018); first implementation by Dev 3 to unblock AI-018.
 *
 * Files are owner-only, validated on arrival, read once by the extractor, and
 * deleted afterwards (or on failure/withdrawal). EXIF/GPS is stripped in the
 * browser before upload by re-encoding the image; this endpoint never trusts that.
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
const LABEL_MAX_CHARS = 80;

export const generateEvidenceUploadUrl = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<{ uploadUrl: string }>(member.code);
    return ok({ uploadUrl: await ctx.storage.generateUploadUrl() });
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
    await ctx.storage.delete(row.storageId);
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
    const discardUploads = async () => {
      for (const file of args.files) await ctx.storage.delete(file.storageId).catch(() => undefined);
    };
    const member = await requireMember(ctx, args.roomId);
    if (!member.ok) {
      await discardUploads();
      return memberError<Out>(member.code);
    }
    const reject = async (message: string) => {
      await discardUploads();
      return err<Out>("validation_failed", message);
    };

    if (args.files.length < 1 || args.files.length > MEDIA_MAX_FILES)
      return reject(`Upload between 1 and ${MEDIA_MAX_FILES} images.`);
    if (new Set(args.files.map((f) => f.storageId)).size !== args.files.length)
      return reject("The same file was added twice.");
    const label = cleanText(args.label || (args.kind === "photo" ? "Photos" : "Screenshots"), LABEL_MAX_CHARS);
    if (!label) return reject("Label is too long.");

    for (const file of args.files) {
      const meta = await ctx.db.system.get(file.storageId);
      if (!meta || !MEDIA_CONTENT_TYPES.includes(meta.contentType ?? "") || meta.size > MEDIA_MAX_BYTES)
        return reject("Images must be JPEG, PNG, or WebP and under 2 MB.");
      // A storage id already claimed by any source cannot be claimed again.
      const claimed = await ctx.db
        .query("evidenceMedia")
        .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
        .first();
      if (claimed) return reject("That file is already in use.");
      const m = file.marker;
      if (m && args.kind !== "photo") return reject("Only photos can mark a recipient.");
      if (m && !(m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1)) return reject("Marker is outside the photo.");
    }

    const sourceId = await ctx.db.insert("evidenceSources", {
      roomId: args.roomId,
      participantId: member.me._id,
      kind: args.kind,
      label,
      sourceRevision: 1,
      media: {
        count: args.files.length,
        ...(args.kind === "photo"
          ? { recipientMarkers: args.files.flatMap((f) => (f.marker ? [f.marker] : [])) }
          : {}),
        status: "uploaded",
      },
      createdAt: Date.now(),
    });
    for (const [mediaIndex, file] of args.files.entries()) {
      const meta = (await ctx.db.system.get(file.storageId))!;
      await ctx.db.insert("evidenceMedia", {
        sourceId,
        participantId: member.me._id,
        mediaIndex,
        storageId: file.storageId,
        contentType: meta.contentType!,
        ...(file.marker ? { marker: file.marker } : {}),
      });
    }
    return ok<Out>({ source: (await ctx.db.get(sourceId))! });
  },
});
