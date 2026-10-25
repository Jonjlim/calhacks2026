import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { modules } from "./test.setup";

type R<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
function value<T>(r: R<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", { title: "Maya", recipientDisplayName: "Maya", occasion: "birthday", currency: "USD", knowledgeRevision: 1, inviteToken: "tok", createdBy: "alice", createdAt: 0 });
    const alice = await ctx.db.insert("participants", { roomId, userId: "alice", displayName: "Alice", role: "organizer", joinedAt: 0 });
    const bob = await ctx.db.insert("participants", { roomId, userId: "bob", displayName: "Bob", role: "contributor", joinedAt: 0 });
    return { roomId, alice, bob };
  });
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  const outsider = t.withIdentity({ subject: "mallory" });
  type Caller = typeof alice;
  const upload = async (who: Caller, type = "image/jpeg") => {
    value(await who.mutation(api.media.generateEvidenceUploadUrl, { roomId: ids.roomId }));
    return t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([1, 2, 3]) as BlobPart], { type })));
  };
  const exists = (id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);
  return { t, ids, alice, bob, outsider, upload, exists };
}

describe("room photos", () => {
  it("shares a member's photo with everyone in the room, and only the room", async () => {
    const { ids, alice, bob, outsider, upload } = await setup();
    const storageId = await upload(alice);
    value(await alice.mutation(api.photos.sharePhotos, { roomId: ids.roomId, files: [{ storageId }] }));
    const seen = value(await bob.query(api.photos.listRoomPhotos, { roomId: ids.roomId }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ uploaderId: ids.alice });
    expect(seen[0]!.url).toBeTruthy();
    expect(await outsider.query(api.photos.listRoomPhotos, { roomId: ids.roomId })).toMatchObject({ ok: false });
  });

  it("only takes the uploader's own fresh uploads, of image types", async () => {
    const { ids, alice, bob, outsider, upload, exists } = await setup();
    const mine = await upload(alice);
    // Bob holds no grant older than Alice's file, so he cannot claim it; Alice's file survives.
    expect(await bob.mutation(api.photos.sharePhotos, { roomId: ids.roomId, files: [{ storageId: mine }] })).toMatchObject({ ok: false });
    expect(await outsider.mutation(api.photos.sharePhotos, { roomId: ids.roomId, files: [{ storageId: mine }] })).toMatchObject({ ok: false });
    expect(await exists(mine)).toBe(true);
    const gif = await upload(alice, "image/gif");
    expect(await alice.mutation(api.photos.sharePhotos, { roomId: ids.roomId, files: [{ storageId: gif }] })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await exists(gif)).toBe(false);
  });

  it("never lets a shared photo enter the read-once pipeline", async () => {
    const { ids, alice, upload, exists } = await setup();
    const storageId = await upload(alice);
    value(await alice.mutation(api.photos.sharePhotos, { roomId: ids.roomId, files: [{ storageId }] }));
    value(await alice.mutation(api.media.generateEvidenceUploadUrl, { roomId: ids.roomId }));
    expect(await alice.mutation(api.media.importMediaEvidence, { roomId: ids.roomId, kind: "photo", label: "", files: [{ storageId }] })).toMatchObject({ ok: false });
    expect(await exists(storageId)).toBe(true);
  });

  it("is kept by the stale-upload sweep, deleted by its uploader, and purged with the room", async () => {
    const { t, ids, alice, bob, upload, exists } = await setup();
    const keep = await upload(alice);
    const [photoId] = value(await alice.mutation(api.photos.sharePhotos, { roomId: ids.roomId, files: [{ storageId: keep }] })).photoIds;
    const old = Date.now() + 3 * 60 * 60 * 1000;
    const realNow = Date.now;
    Date.now = () => old;
    try {
      await t.mutation(internal.cleanup.sweepStaleUploads, {});
    } finally {
      Date.now = realNow;
    }
    expect(await exists(keep)).toBe(true);
    expect(await bob.mutation(api.photos.deletePhoto, { photoId: photoId! })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    value(await alice.mutation(api.photos.deletePhoto, { photoId: photoId! }));
    expect(await exists(keep)).toBe(false);

    const another = await upload(alice);
    value(await alice.mutation(api.photos.sharePhotos, { roomId: ids.roomId, files: [{ storageId: another }] }));
    const { purgeRoomStep } = await import("./lib/roomPurge");
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) if ((await purgeRoomStep(ctx, ids.roomId, 500)).done) break;
    });
    expect(await exists(another)).toBe(false);
  });
});
