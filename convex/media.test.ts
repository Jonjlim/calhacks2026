import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { modules } from "./test.setup";
import { MEDIA_MAX_BYTES, UPLOAD_URL_LIMIT } from "./media";

type R<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
function value<T>(r: R<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const MARKER = { x: 0.1234, y: 0.8765 };

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      title: "Maya", recipientDisplayName: "Maya", occasion: "birthday", currency: "USD",
      knowledgeRevision: 1, inviteToken: "tok", createdBy: "alice", createdAt: 0,
    });
    const alice = await ctx.db.insert("participants", {
      roomId, userId: "alice", displayName: "Alice", role: "organizer", joinedAt: 0,
    });
    const bob = await ctx.db.insert("participants", {
      roomId, userId: "bob", displayName: "Bob", role: "contributor", joinedAt: 0,
    });
    return { roomId, alice, bob };
  });
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  const outsider = t.withIdentity({ subject: "mallory" });
  type Caller = typeof alice;
  const grant = async (who: Caller) =>
    value(await who.mutation(api.media.generateEvidenceUploadUrl, { roomId: ids.roomId }));
  const put = (type = "image/png", bytes: Uint8Array = new Uint8Array([1, 2, 3])) =>
    t.run((ctx) => ctx.storage.store(new Blob([bytes as BlobPart], { type })));
  /** The browser flow: one upload URL per file, then the upload. */
  const upload = async (who: Caller, type?: string, bytes?: Uint8Array) => {
    await grant(who);
    return put(type, bytes);
  };
  const exists = (id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);
  const importAs = (
    who: Caller,
    files: Array<{ storageId: Id<"_storage">; marker?: { x: number; y: number } }>,
    kind: "photo" | "screenshot" = "photo",
  ) => who.mutation(api.media.importMediaEvidence, { roomId: ids.roomId, kind, label: "", files });
  const sourceCount = () => t.run(async (ctx) => (await ctx.db.query("evidenceSources").collect()).length);
  return { t, ids, alice, bob, outsider, grant, put, upload, exists, importAs, sourceCount };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("importMediaEvidence ownership", () => {
  it("non-members and unauthenticated callers get an error and never delete the file", async () => {
    const { t, ids, alice, outsider, upload, exists, importAs, sourceCount } = await setup();
    const file = await upload(alice);
    expect(await importAs(outsider, [{ storageId: file }])).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(
      await t.mutation(api.media.importMediaEvidence, {
        roomId: ids.roomId, kind: "photo", label: "", files: [{ storageId: file }],
      }),
    ).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await exists(file)).toBe(true);
    expect(await sourceCount()).toBe(0);
    // The owner can still claim it afterwards.
    value(await importAs(alice, [{ storageId: file }]));
  });

  it("non-members cannot get upload URLs", async () => {
    const { t, ids, outsider } = await setup();
    expect(await outsider.mutation(api.media.generateEvidenceUploadUrl, { roomId: ids.roomId }))
      .toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await t.mutation(api.media.generateEvidenceUploadUrl, { roomId: ids.roomId }))
      .toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await t.run((ctx) => ctx.db.query("mediaUploadGrants").collect())).toEqual([]);
  });

  it("a peer passing another member's claimed file is rejected and the file stays", async () => {
    const { t, alice, bob, upload, exists, importAs } = await setup();
    const aliceFile = await upload(alice);
    const { source } = value(await importAs(alice, [{ storageId: aliceFile }]));
    const bobFile = await upload(bob);
    expect(await importAs(bob, [{ storageId: aliceFile }, { storageId: bobFile }]))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await exists(aliceFile)).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("evidenceMedia").collect()))
      .toMatchObject([{ sourceId: source._id, storageId: aliceFile }]);
    // Bob's own file in the rejected batch is his to lose; the sweep would get it anyway.
    expect(await exists(bobFile)).toBe(false);
  });

  it("a peer cannot claim or delete another member's unclaimed upload", async () => {
    vi.useFakeTimers();
    const { alice, bob, upload, grant, exists, importAs, sourceCount } = await setup();
    // Bob has no grant at all.
    const aliceFile = await upload(alice);
    expect(await importAs(bob, [{ storageId: aliceFile, marker: { x: 5, y: 5 } }]))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await exists(aliceFile)).toBe(true);
    // Bob's grant is newer than Alice's file, so it does not cover it.
    vi.advanceTimersByTime(1000);
    await grant(bob);
    expect(await importAs(bob, [{ storageId: aliceFile }]))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await exists(aliceFile)).toBe(true);
    expect(await sourceCount()).toBe(0);
    value(await importAs(alice, [{ storageId: aliceFile }]));
  });

  it("a file stored without an upload grant cannot be claimed and is left for the sweep", async () => {
    const { alice, put, exists, importAs } = await setup();
    const file = await put();
    expect(await importAs(alice, [{ storageId: file }]))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await exists(file)).toBe(true);
  });

  it("each grant covers one file, is consumed on claim, and expires after an hour", async () => {
    vi.useFakeTimers();
    const { alice, grant, put, upload, exists, importAs } = await setup();
    await grant(alice);
    const first = await put();
    const second = await put();
    // One grant for two files: the earlier file is the caller's and is deleted; the other is not touched.
    expect(await importAs(alice, [{ storageId: first }, { storageId: second }]))
      .toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await exists(first)).toBe(false);
    expect(await exists(second)).toBe(true);

    const a = await upload(alice);
    value(await importAs(alice, [{ storageId: a }]));
    // The consumed grant cannot be reused for a later file.
    const b = await put();
    expect(await importAs(alice, [{ storageId: b }])).toMatchObject({ ok: false });

    await grant(alice);
    vi.advanceTimersByTime(61 * 60 * 1000);
    const late = await put();
    expect(await importAs(alice, [{ storageId: late }])).toMatchObject({ ok: false });
    expect(await exists(late)).toBe(true);
  });
});

describe("importMediaEvidence validation", () => {
  it("rejects wrong type and oversize files and deletes the caller's uploads", async () => {
    const { alice, upload, exists, importAs, sourceCount } = await setup();
    const text = await upload(alice, "text/plain");
    expect(await importAs(alice, [{ storageId: text }])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    expect(await exists(text)).toBe(false);
    const gif = await upload(alice, "image/gif");
    expect(await importAs(alice, [{ storageId: gif }])).toMatchObject({ ok: false });
    expect(await exists(gif)).toBe(false);
    const big = await upload(alice, "image/jpeg", new Uint8Array(MEDIA_MAX_BYTES + 1));
    expect(await importAs(alice, [{ storageId: big }])).toMatchObject({ ok: false });
    expect(await exists(big)).toBe(false);
    const fine = await upload(alice, "image/webp", new Uint8Array(MEDIA_MAX_BYTES));
    value(await importAs(alice, [{ storageId: fine }]));
    expect(await sourceCount()).toBe(1);
  });

  it("rejects bad counts, duplicates, and markers", async () => {
    const { alice, upload, importAs, sourceCount } = await setup();
    expect(await importAs(alice, [])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
    const four = [await upload(alice), await upload(alice), await upload(alice), await upload(alice)];
    expect(await importAs(alice, four.map((storageId) => ({ storageId })))).toMatchObject({ ok: false });
    const dup = await upload(alice);
    expect(await importAs(alice, [{ storageId: dup }, { storageId: dup }])).toMatchObject({ ok: false });
    const shot = await upload(alice);
    expect(await importAs(alice, [{ storageId: shot, marker: MARKER }], "screenshot")).toMatchObject({ ok: false });
    for (const marker of [{ x: -0.1, y: 0.5 }, { x: 0.5, y: 1.01 }, { x: Number.NaN, y: 0.5 }]) {
      const file = await upload(alice);
      expect(await importAs(alice, [{ storageId: file, marker }])).toMatchObject({ ok: false });
    }
    expect(await sourceCount()).toBe(0);
    const ok = [await upload(alice), await upload(alice), await upload(alice)];
    const { source } = value(
      await importAs(alice, ok.map((storageId, i) => (i === 0 ? { storageId, marker: MARKER } : { storageId }))),
    );
    expect(source.media).toEqual({ count: 3, recipientMarkers: [MARKER], status: "uploaded" });
  });

  it("a missing storage file is rejected", async () => {
    const { t, alice, upload, importAs } = await setup();
    const file = await upload(alice);
    await t.run((ctx) => ctx.storage.delete(file));
    expect(await importAs(alice, [{ storageId: file }])).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });
});

describe("generateEvidenceUploadUrl rate limit", () => {
  it("caps URLs per member per ten minutes and prunes expired grants", async () => {
    vi.useFakeTimers();
    const { t, ids, alice, bob, grant } = await setup();
    for (let i = 0; i < UPLOAD_URL_LIMIT; i++) await grant(alice);
    expect(await alice.mutation(api.media.generateEvidenceUploadUrl, { roomId: ids.roomId }))
      .toMatchObject({ ok: false, error: { code: "refused" } });
    // Per member: Bob is unaffected.
    await grant(bob);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await grant(alice);
    vi.advanceTimersByTime(61 * 60 * 1000);
    await grant(alice);
    const left = await t.run((ctx) => ctx.db.query("mediaUploadGrants").collect());
    // Alice's expired grants were pruned on her next request; Bob's waits for the sweep.
    expect(left.filter((g) => g.participantId === ids.alice)).toHaveLength(1);
    await t.mutation(internal.cleanup.sweepStaleUploads, {});
    expect(await t.run((ctx) => ctx.db.query("mediaUploadGrants").collect())).toHaveLength(1);
  });
});

describe("media privacy", () => {
  it("peers see no media source, storage id, or marker through room queries", async () => {
    const { t, ids, alice, bob, upload, importAs } = await setup();
    const file = await upload(alice);
    const { source } = value(await importAs(alice, [{ storageId: file, marker: MARKER }]));
    value(await alice.mutation(api.clues.upsertManualPreference, { roomId: ids.roomId, kind: "interest", text: "pottery" }));

    const mine = value(await alice.query(api.clues.listMyEvidence, { roomId: ids.roomId }));
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain(String(file));

    expect(value(await bob.query(api.clues.listMyEvidence, { roomId: ids.roomId }))).toEqual([]);
    expect(await bob.query(api.clues.getMyEvidenceMessages, { sourceId: source._id }))
      .toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await bob.mutation(api.agents.extract.extractClues, { sourceId: source._id }))
      .toMatchObject({ ok: false, error: { code: "unauthorized" } });
    const views = [
      await bob.query(api.clues.listMyEvidence, { roomId: ids.roomId }),
      await bob.query(api.clues.listMyProposedClues, { roomId: ids.roomId }),
      await bob.query(api.clues.listPublishedClues, { roomId: ids.roomId }),
      await bob.query(api.rooms.getRoom, { roomId: ids.roomId }),
      await bob.query(api.agents.buyer.listActivity, { roomId: ids.roomId }),
      await bob.query(api.messages.listMessages, { roomId: ids.roomId }),
      await alice.query(api.clues.listPublishedClues, { roomId: ids.roomId }),
    ];
    for (const view of views) {
      expect(view).toMatchObject({ ok: true });
      const json = JSON.stringify(view);
      for (const secret of [String(file), String(source._id), "0.1234", "0.8765", "storageId"])
        expect(json).not.toContain(secret);
    }
    const asOutsider = await t.withIdentity({ subject: "mallory" }).query(api.clues.listMyEvidence, { roomId: ids.roomId });
    expect(asOutsider).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });
});

describe("deleteEvidence for media sources", () => {
  it("only the owner can delete; it removes files and rows and tombstones dependent clues", async () => {
    const { t, ids, alice, bob, upload, exists, importAs } = await setup();
    const files = [await upload(alice), await upload(alice)];
    const { source } = value(await importAs(alice, files.map((storageId) => ({ storageId, marker: MARKER }))));

    expect(await bob.mutation(api.clues.deleteEvidence, { sourceId: source._id }))
      .toMatchObject({ ok: false, error: { code: "not_found" } });
    for (const f of files) expect(await exists(f)).toBe(true);

    const { proposedId, observation } = await t.run(async (ctx) => {
      const observation = await ctx.db.insert("privateMessages", {
        sourceId: source._id, participantId: ids.alice, body: "Photo 1 — Recipient activity: hiking", mediaIndex: 0,
      });
      const proposedId = await ctx.db.insert("proposedClues", {
        roomId: ids.roomId, participantId: ids.alice, sourceId: source._id, sourceMessageIds: [observation],
        kind: "interest", text: "Seems to enjoy hiking.", confidence: 0.55, speakerAssumption: "unknown",
        contradictsClueIds: [], status: "proposed", createdAt: 0,
      });
      return { proposedId, observation };
    });
    const published = value(await alice.mutation(api.clues.publishClue, { proposedClueId: proposedId, excerpt: "hiking" }));
    expect(published.sourceKind).toBe("photo");

    value(await alice.mutation(api.clues.deleteEvidence, { sourceId: source._id }));
    for (const f of files) expect(await exists(f)).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("evidenceMedia").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(observation))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(source._id))).toMatchObject({ media: { status: "deleted" } });
    expect(await t.run((ctx) => ctx.db.get(source._id))).toHaveProperty("deletedAt");
    expect(await t.run((ctx) => ctx.db.get(proposedId))).toMatchObject({ status: "source_withdrawn", sourceMessageIds: [] });
    const tomb = value(await bob.query(api.clues.listPublishedClues, { roomId: ids.roomId }));
    expect(tomb).toMatchObject([{ status: "source_withdrawn", sourceMessageIds: [] }]);
    expect(tomb[0]!.excerpt).toBeUndefined();
    // Idempotent.
    value(await alice.mutation(api.clues.deleteEvidence, { sourceId: source._id }));
  });
});

describe("unread media cleanup", () => {
  it("a failed read on a missing file still deletes the remaining files and rows", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
    vi.stubEnv("LLM_API_KEY", "test");
    vi.stubEnv("LLM_MODEL", "test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network in tests")));
    const { t, alice, upload, exists, importAs } = await setup();
    const files = [await upload(alice), await upload(alice)];
    const { source } = value(await importAs(alice, files.map((storageId) => ({ storageId }))));
    await t.run((ctx) => ctx.storage.delete(files[1]!));
    const { jobId } = value(await alice.mutation(api.agents.extract.extractClues, { sourceId: source._id }));
    await t.action(internal.agents.extract.runExtraction, { jobId });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ status: "failed" });
    expect(await exists(files[0]!)).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("evidenceMedia").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(source._id))).toMatchObject({ media: { status: "failed" } });
  });

  it("a timed-out read deletes the files", async () => {
    const { t, alice, upload, exists, importAs } = await setup();
    const file = await upload(alice);
    const { source } = value(await importAs(alice, [{ storageId: file }]));
    const { jobId } = value(await alice.mutation(api.agents.extract.extractClues, { sourceId: source._id }));
    const work = await t.mutation(internal.agents.runtime.claimJob, { jobId, kind: "extract" });
    expect(work?.media?.items).toHaveLength(1);
    await t.mutation(internal.agents.runtime.expireJob, { jobId, attempt: work!.attempt });
    expect(await exists(file)).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(source._id))).toMatchObject({ media: { status: "failed" } });
  });

  it("the sweep discards claimed media that was never read after a day", async () => {
    vi.useFakeTimers();
    const { t, alice, upload, exists, importAs } = await setup();
    const file = await upload(alice);
    const { source } = value(await importAs(alice, [{ storageId: file }]));
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    await t.mutation(internal.cleanup.sweepStaleUploads, {});
    expect(await exists(file)).toBe(true);
    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    expect(await t.mutation(internal.cleanup.sweepStaleUploads, {})).toMatchObject({ deleted: 1 });
    expect(await exists(file)).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("evidenceMedia").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(source._id))).toMatchObject({ media: { status: "failed" } });
  });
});
