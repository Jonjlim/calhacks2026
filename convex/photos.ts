/**
 * Room photos (D20). Owner: Dev 3; storage rules follow Dev 2's media hardening (convex/media.ts).
 *
 * A photo a member adds on the gift map is shared with everyone in the room.
 * It is a separate upload from the private evidence copy the extractor reads
 * once and deletes; what the extractor guesses stays private until published.
 *
 * - Only room members can list photos or load their URLs.
 * - EXIF/GPS is stripped in the browser by re-encoding; this endpoint checks type and size.
 * - Files are claimed against the uploader's own upload grants, exactly like evidence uploads.
 * - The uploader can delete a photo at any time; room deletion purges the files.
 * - Recipient markers are not stored here; they stay on the private evidence source.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { err, memberError, ok } from "./lib/result";
import { MEDIA_CONTENT_TYPES, MEDIA_MAX_BYTES, MEDIA_MAX_FILES, UPLOAD_GRANT_TTL_MS } from "./media";

/** Plenty for one gift, and keeps a room from becoming a photo host. */
export const ROOM_PHOTO_LIMIT = 60;

export const sharePhotos = mutation({
  args: {
    roomId: v.id("rooms"),
    files: v.array(v.object({ storageId: v.id("_storage") })),
    /** The private evidence source read from the same pictures, so its published clues can show the photo. */
    sourceId: v.optional(v.id("evidenceSources")),
  },
  handler: async (ctx, args) => {
    type Out = { photoIds: Id<"roomPhotos">[] };
    const member = await requireMember(ctx, args.roomId);
    // Never delete anything for a non-member: they could be naming someone else's file.
    if (!member.ok) return memberError<Out>(member.code);
    const participantId = member.me._id;
    if (args.files.length < 1 || args.files.length > MEDIA_MAX_FILES) return err<Out>("validation_failed", `Add between 1 and ${MEDIA_MAX_FILES} photos.`);
    if (new Set(args.files.map((f) => f.storageId)).size !== args.files.length) return err<Out>("validation_failed", "The same photo was added twice.");
    if (args.sourceId) {
      const source = await ctx.db.get(args.sourceId);
      if (!source || source.roomId !== args.roomId || source.participantId !== participantId || source.kind !== "photo") return err<Out>("not_found", "That photo read isn't yours.");
    }
    const existing = await ctx.db.query("roomPhotos").withIndex("by_room", (q) => q.eq("roomId", args.roomId)).take(ROOM_PHOTO_LIMIT + 1);
    if (existing.length + args.files.length > ROOM_PHOTO_LIMIT) return err<Out>("refused", "This room has as many photos as it can hold. Delete one first.");

    const files = await Promise.all(args.files.map(async (f) => {
      const meta = await ctx.db.system.get(f.storageId);
      const inEvidence = meta ? await ctx.db.query("evidenceMedia").withIndex("by_storage", (q) => q.eq("storageId", f.storageId)).first() : null;
      const inPhotos = meta ? await ctx.db.query("roomPhotos").withIndex("by_storage", (q) => q.eq("storageId", f.storageId)).first() : null;
      return { ...f, meta, claimed: !!inEvidence || !!inPhotos };
    }));

    // Bind each file to one of the caller's own unused grants issued before it was created (see convex/media.ts).
    const grants = (await ctx.db
      .query("mediaUploadGrants")
      .withIndex("by_room_participant_issued", (q) => q.eq("roomId", args.roomId).eq("participantId", participantId).gte("issuedAt", Date.now() - UPLOAD_GRANT_TTL_MS))
      .collect()).filter((g) => g.storageId === undefined);
    const grantFor = new Map<Id<"_storage">, Id<"mediaUploadGrants">>();
    for (const file of files.filter((f) => f.meta && !f.claimed).sort((a, b) => a.meta!._creationTime - b.meta!._creationTime)) {
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
    for (const file of files) {
      if (!file.meta || file.claimed || !grantFor.has(file.storageId)) return reject("That upload is missing or expired. Add the photo again.");
      if (!MEDIA_CONTENT_TYPES.includes(file.meta.contentType ?? "") || file.meta.size > MEDIA_MAX_BYTES) return reject("Photos must be JPEG, PNG, or WebP and under 2 MB.");
    }

    const photoIds: Id<"roomPhotos">[] = [];
    const now = Date.now();
    for (const file of files) {
      await ctx.db.patch(grantFor.get(file.storageId)!, { storageId: file.storageId });
      photoIds.push(await ctx.db.insert("roomPhotos", { roomId: args.roomId, uploaderId: participantId, storageId: file.storageId, ...(args.sourceId ? { sourceId: args.sourceId } : {}), createdAt: now }));
    }
    return ok<Out>({ photoIds });
  },
});

export const listRoomPhotos = query({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    type Row = { id: Id<"roomPhotos">; uploaderId: Id<"participants">; url: string; sourceId?: Id<"evidenceSources">; clueIds: Id<"publishedClues">[]; createdAt: number };
    const member = await requireMember(ctx, roomId);
    if (!member.ok) return memberError<Row[]>(member.code);
    const rows = await ctx.db.query("roomPhotos").withIndex("by_room", (q) => q.eq("roomId", roomId)).take(ROOM_PHOTO_LIMIT);
    // Published clues read from the same pictures, so everyone can see which photo a clue came from.
    const published = (await ctx.db.query("publishedClues").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect()).filter((c) => c.status === "active" && c.sourceKind === "photo" && c.proposedClueId);
    const sourceOf = new Map<Id<"publishedClues">, Id<"evidenceSources">>();
    for (const clue of published) {
      const proposed = await ctx.db.get(clue.proposedClueId!);
      if (proposed) sourceOf.set(clue._id, proposed.sourceId);
    }
    const out: Row[] = [];
    for (const row of rows) {
      const url = await ctx.storage.getUrl(row.storageId);
      if (!url) continue;
      const clueIds = row.sourceId ? published.filter((c) => sourceOf.get(c._id) === row.sourceId).map((c) => c._id) : [];
      out.push({ id: row._id, uploaderId: row.uploaderId, url, ...(row.sourceId ? { sourceId: row.sourceId } : {}), clueIds, createdAt: row.createdAt });
    }
    return ok(out);
  },
});

export const deletePhoto = mutation({
  args: { photoId: v.id("roomPhotos") },
  handler: async (ctx, { photoId }) => {
    const row: Doc<"roomPhotos"> | null = await ctx.db.get(photoId);
    if (!row) return err<null>("not_found", "That photo is already gone.");
    const member = await requireMember(ctx, row.roomId);
    if (!member.ok) return memberError<null>(member.code);
    if (row.uploaderId !== member.me._id) return err<null>("unauthorized", "Only the person who added a photo can delete it.");
    if (await ctx.db.system.get(row.storageId)) await ctx.storage.delete(row.storageId);
    await ctx.db.delete(photoId);
    return ok(null);
  },
});
