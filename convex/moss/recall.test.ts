import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";

type R<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
function value<T>(r: R<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

const moss = vi.hoisted(() => ({
  addDocs: vi.fn(),
  query: vi.fn(),
  close: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@moss-js/moss", () => ({ MossClient: class {
  session = moss.session;
  close = moss.close;
} }));

beforeEach(() => {
  vi.stubEnv("MOSS_ROOM_ENABLED", "");
  vi.stubEnv("MOSS_PROJECT_ID", "test-project");
  vi.stubEnv("MOSS_PROJECT_KEY", "test-key");
  moss.addDocs.mockReset().mockResolvedValue({ added: 1, updated: 0 });
  moss.query.mockReset().mockResolvedValue({ docs: [], query: "" });
  moss.close.mockReset().mockResolvedValue(undefined);
  moss.session.mockReset().mockResolvedValue({ addDocs: moss.addDocs, query: moss.query });
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "user_alice|s1" });
  const bob = t.withIdentity({ subject: "user_bob|s2" });
  const mallory = t.withIdentity({ subject: "user_mallory|s3" });
  const created = value(await alice.mutation(api.rooms.createRoom, { title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alice" })) as { room: { _id: string }; inviteToken: string };
  const roomId = created.room._id as never;
  value(await bob.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: "Bob" }));
  const share = async (who: typeof alice, text: string) => value(await who.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text }));
  return { t, alice, bob, mallory, roomId, share };
}

describe("Moss room recall", () => {
  it("is for members only and accepts only known questions", async () => {
    const { alice, mallory, roomId } = await setup();
    expect(await mallory.action(api.moss.recall.nudge, { roomId, questionIndex: 0 })).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await alice.action(api.moss.recall.nudge, { roomId, questionIndex: 9 })).toMatchObject({ ok: false, error: { code: "validation_failed" } });
  });

  it("returns nothing until another member has shared", async () => {
    const { alice, roomId, share } = await setup();
    await share(alice, "Spends quiet weekends at the farmers market");
    expect(value(await alice.action(api.moss.recall.nudge, { roomId, questionIndex: 0 }))).toBeNull();
  });

  it("with Moss off, word overlap picks a friend's related memory and never a gift idea", async () => {
    const { alice, bob, roomId, share } = await setup();
    await share(bob, "Always cold in the mornings");
    await share(bob, "Spends quiet weekends at the farmers market");
    await share(bob, "Gift idea: a weekend pottery class");
    await share(alice, "Quiet weekend reader");
    const nudge = value(await alice.action(api.moss.recall.nudge, { roomId, questionIndex: 0 }));
    expect(nudge).toMatchObject({ text: "Spends quiet weekends at the farmers market", author: "Bob", match: "keyword" });
    expect(moss.session).not.toHaveBeenCalled();
  });

  it("with Moss on, indexes only friends' published memories under local IDs and closes the session", async () => {
    vi.stubEnv("MOSS_ROOM_ENABLED", "true");
    const { alice, bob, roomId, share } = await setup();
    await share(bob, "Always cold in the mornings");
    await share(bob, "She keeps saving wheel-throwing videos");
    await share(alice, "My own memory");
    // Moss ranks the wheel-throwing memory first even with no shared words.
    moss.query.mockResolvedValue({ docs: [{ id: "d0", score: 0.91 }, { id: "d1", score: 0.2 }], query: "" });
    const nudge = value(await alice.action(api.moss.recall.nudge, { roomId, questionIndex: 1 }));
    expect(nudge).toMatchObject({ text: "She keeps saving wheel-throwing videos", author: "Bob", match: "moss" });
    const indexed = moss.addDocs.mock.calls.flatMap(([docs]) => docs as { id: string; text: string }[]);
    expect(indexed.map((d) => d.text).sort()).toEqual(["Always cold in the mornings", "She keeps saving wheel-throwing videos"]);
    expect(indexed.every((d) => /^d\d+$/.test(d.id))).toBe(true);
    expect(moss.session.mock.calls[0]![0]).toMatch(/^room-[0-9a-f-]{36}$/);
    expect(moss.close).toHaveBeenCalledTimes(1);
  });

  it("falls back to word overlap when Moss fails, and still closes", async () => {
    vi.stubEnv("MOSS_ROOM_ENABLED", "true");
    const { alice, bob, roomId, share } = await setup();
    await share(bob, "Spends quiet weekends at the farmers market");
    moss.query.mockRejectedValue(new Error("native failure"));
    const nudge = value(await alice.action(api.moss.recall.nudge, { roomId, questionIndex: 0 }));
    expect(nudge).toMatchObject({ author: "Bob", match: "keyword" });
    expect(moss.close).toHaveBeenCalledTimes(1);
  });

  it("warms only with synthetic text and only when enabled", async () => {
    const { alice, roomId } = await setup();
    expect(value(await alice.action(api.moss.recall.warm, { roomId }))).toEqual({ warmed: false });
    vi.stubEnv("MOSS_ROOM_ENABLED", "true");
    expect(value(await alice.action(api.moss.recall.warm, { roomId }))).toEqual({ warmed: true });
    const indexed = moss.addDocs.mock.calls.flatMap(([docs]) => docs as { text: string }[]).map((d) => d.text);
    expect(indexed).toEqual(["Likes slow mornings with coffee.", "Plays tennis on weekends."]);
  });
});
