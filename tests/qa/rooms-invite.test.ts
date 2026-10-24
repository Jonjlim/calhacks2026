// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * QA: invite links, joining, and "memory" submission against the real Convex
 * functions (convex-test). Complements convex/backend.test.ts, which already
 * covers auth-required, basic idempotent join, and the clue privacy model;
 * nothing here edits backend code or schema.
 *
 * "Memory submission" has no dedicated backend endpoint. The only contract
 * path for a typed, un-imported memory is `clues.upsertManualPreference`
 * (docs/CONTRACTS.md), so that is what these tests exercise.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Result } from "../../lib/contracts";
import { LIMITS } from "../../lib/validation";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { modules } from "../../convex/test.setup";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
const code = <T>(r: Result<T>) => (r.ok ? null : r.error.code);

function world() {
  const t = convexTest(schema, modules);
  const as = (name: string) => t.withIdentity({ subject: `user_${name}|session_${name}` });
  return { t, as };
}
type World = ReturnType<typeof world>;

async function newRoom(w: World, organizer = "alice") {
  const created = unwrap(
    await w.as(organizer).mutation(api.rooms.createRoom, {
      title: "Maya's birthday",
      recipientDisplayName: "Maya",
      occasion: "Birthday",
      displayName: "Alice",
    }),
  );
  return { roomId: created.room._id, token: created.inviteToken, organizerParticipantId: created.participant._id };
}

describe("invite links", () => {
  it("issues a 32-hex-char token that is already URL-safe, with a /join/<token> path", async () => {
    const w = world();
    const { roomId, token } = await newRoom(w);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(encodeURIComponent(token)).toBe(token);
    const invite = unwrap(await w.as("alice").query(api.rooms.getInvite, { roomId }));
    expect(invite).toEqual({ inviteToken: token, joinPath: `/join/${token}` });
  });

  it("gives every room its own token", async () => {
    const w = world();
    const tokens = new Set<string>();
    for (let i = 0; i < 25; i++) tokens.add((await newRoom(w, `org${i}`)).token);
    expect(tokens.size).toBe(25);
  });

  it("lets a signed-out visitor preview the invite but reveals only the documented fields", async () => {
    const w = world();
    const { token, roomId } = await newRoom(w);
    const preview = unwrap(await w.t.query(api.rooms.previewInvite, { inviteToken: token }));
    expect(Object.keys(preview).sort()).toEqual(["alreadyMember", "occasion", "participantCount", "recipientDisplayName", "roomId", "title"]);
    expect(preview).toMatchObject({ roomId, recipientDisplayName: "Maya", occasion: "Birthday", participantCount: 1, alreadyMember: false });
  });

  it("reports alreadyMember and a growing headcount", async () => {
    const w = world();
    const { token } = await newRoom(w);
    await w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "Bob" });
    expect(unwrap(await w.as("bob").query(api.rooms.previewInvite, { inviteToken: token }))).toMatchObject({ alreadyMember: true, participantCount: 2 });
    expect(unwrap(await w.as("carol").query(api.rooms.previewInvite, { inviteToken: token }))).toMatchObject({ alreadyMember: false, participantCount: 2 });
  });

  it("treats unknown, empty, whitespace and oversized tokens as not_found (never an exception)", async () => {
    const w = world();
    await newRoom(w);
    for (const bad of ["", "   ", "nope", "x".repeat(128), "x".repeat(129), "../../etc/passwd", "%00"]) {
      expect(code(await w.t.query(api.rooms.previewInvite, { inviteToken: bad })), JSON.stringify(bad)).toBe("not_found");
      expect(code(await w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: bad, displayName: "Bob" })), JSON.stringify(bad)).toBe("not_found");
    }
  });

  it("trims whitespace around a valid token but is case-sensitive", async () => {
    const w = world();
    const { token } = await newRoom(w);
    expect(code(await w.t.query(api.rooms.previewInvite, { inviteToken: `  ${token}\n` }))).toBeNull();
    expect(code(await w.t.query(api.rooms.previewInvite, { inviteToken: token.toUpperCase() }))).toBe("not_found");
  });

  it("hides the invite from non-members and from signed-out callers", async () => {
    const w = world();
    const { roomId } = await newRoom(w);
    expect(code(await w.as("eve").query(api.rooms.getInvite, { roomId }))).toBe("unauthorized");
    expect(code(await w.t.query(api.rooms.getInvite, { roomId }))).toBe("unauthorized");
  });

  it("returns not_found for getInvite on a deleted room", async () => {
    const w = world();
    const { roomId } = await newRoom(w);
    await w.t.run(async (ctx) => ctx.db.delete(roomId));
    expect(code(await w.as("alice").query(api.rooms.getInvite, { roomId }))).toBe("not_found");
  });
});

describe("joining", () => {
  it("is idempotent for the same user and keeps the original display name", async () => {
    const w = world();
    const { token, roomId } = await newRoom(w);
    const first = unwrap(await w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "Bob" }));
    const again = unwrap(await w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "Robert" }));
    expect(again.participant._id).toBe(first.participant._id);
    expect(again.participant.displayName).toBe("Bob");
    expect(unwrap(await w.as("alice").query(api.rooms.getRoom, { roomId })).participants).toHaveLength(2);
  });

  it("creates exactly one participant when the same user double-submits at once", async () => {
    const w = world();
    const { token, roomId } = await newRoom(w);
    const results = await Promise.all([1, 2, 3].map(() => w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "Bob" })));
    expect(new Set(results.map((r) => unwrap(r).participant._id)).size).toBe(1);
    expect(unwrap(await w.as("alice").query(api.rooms.getRoom, { roomId })).participants).toHaveLength(2);
  });

  it("admits many different people joining simultaneously without losing anyone", async () => {
    const w = world();
    const { token, roomId } = await newRoom(w);
    const names = ["bob", "carol", "dan", "erin", "frank", "gia"];
    const results = await Promise.all(names.map((n) => w.as(n).mutation(api.rooms.joinRoom, { inviteToken: token, displayName: n })));
    results.forEach((r) => expect(r.ok).toBe(true));
    const view = unwrap(await w.as("alice").query(api.rooms.getRoom, { roomId }));
    expect(view.participants).toHaveLength(names.length + 1);
    expect(new Set(view.participants.map((p) => p.userId)).size).toBe(names.length + 1);
    expect(view.participants.filter((p) => p.role === "organizer")).toHaveLength(1);
  });

  it("keeps the organizer role when the organizer opens their own invite", async () => {
    const w = world();
    const { token, organizerParticipantId } = await newRoom(w);
    const res = unwrap(await w.as("alice").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "Someone else" }));
    expect(res.participant._id).toBe(organizerParticipantId);
    expect(res.participant.role).toBe("organizer");
  });

  it("requires a name from a new member but not from an existing one", async () => {
    const w = world();
    const { token } = await newRoom(w);
    expect(code(await w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "   " }))).toBe("validation_failed");
    await w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "Bob" });
    expect(code(await w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "" }))).toBeNull();
  });

  it("enforces the 40-character display-name limit and trims", async () => {
    const w = world();
    const { token } = await newRoom(w);
    expect(code(await w.as("a").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "x".repeat(LIMITS.displayNameMaxChars + 1) }))).toBe("validation_failed");
    const ok = unwrap(await w.as("b").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: `  ${"y".repeat(LIMITS.displayNameMaxChars)}  ` }));
    expect(ok.participant.displayName).toHaveLength(LIMITS.displayNameMaxChars);
  });

  it("stores markup in a display name verbatim (no server-side sanitising: the UI must keep escaping it)", async () => {
    const w = world();
    const { token } = await newRoom(w);
    const name = "<img src=x onerror=alert(1)>";
    expect(unwrap(await w.as("mallory").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: name })).participant.displayName).toBe(name);
  });

  it("accepts emoji and non-latin names", async () => {
    const w = world();
    const { token } = await newRoom(w);
    expect(unwrap(await w.as("z").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "松本 🎁" })).participant.displayName).toBe("松本 🎁");
  });

  it("only lists rooms the caller belongs to in listMyRooms", async () => {
    const w = world();
    const a = await newRoom(w, "alice");
    await newRoom(w, "zed");
    await w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: a.token, displayName: "Bob" });
    const mine = unwrap(await w.as("bob").query(api.rooms.listMyRooms, {}));
    expect(mine.map((r) => r.roomId)).toEqual([a.roomId]);
    expect(mine[0]?.role).toBe("contributor");
  });

  it("rejects room reads for people who only hold the token (token is not membership)", async () => {
    const w = world();
    const { roomId } = await newRoom(w);
    expect(code(await w.as("bob").query(api.rooms.getRoom, { roomId }))).toBe("unauthorized");
  });
});

describe("memory submission (clues.upsertManualPreference)", () => {
  async function twoMembers() {
    const w = world();
    const r = await newRoom(w);
    await w.as("bob").mutation(api.rooms.joinRoom, { inviteToken: r.token, displayName: "Bob" });
    return { ...w, ...r };
  }
  const memory = (roomId: Id<"rooms">, text: string) => ({ roomId, kind: "uncertain" as const, text });

  it("shows a contributor's memory to the other member, attributed to the contributor", async () => {
    const { as, roomId } = await twoMembers();
    const clue = unwrap(await as("bob").mutation(api.clues.upsertManualPreference, memory(roomId, "She laughed until she cried at the pottery studio.")));
    const seen = unwrap(await as("alice").query(api.clues.listPublishedClues, { roomId }));
    expect(seen.map((c) => c._id)).toContain(clue._id);
    const bob = unwrap(await as("alice").query(api.rooms.getRoom, { roomId })).participants.find((p) => p.displayName === "Bob");
    expect(clue.publisherId).toBe(bob?.id);
    expect(clue.sourceKind).toBe("manual");
  });

  it("refuses non-members for both writing and reading", async () => {
    const { as, t, roomId } = await twoMembers();
    expect(code(await as("eve").mutation(api.clues.upsertManualPreference, memory(roomId, "hello there")))).toBe("unauthorized");
    expect(code(await as("eve").query(api.clues.listPublishedClues, { roomId }))).toBe("unauthorized");
    expect(code(await t.mutation(api.clues.upsertManualPreference, memory(roomId, "hello there")))).toBe("unauthorized");
  });

  it("validates text: trims, rejects empty, accepts exactly the limit, rejects one over", async () => {
    const { as, roomId } = await twoMembers();
    const bob = as("bob");
    expect(code(await bob.mutation(api.clues.upsertManualPreference, memory(roomId, "   ")))).toBe("validation_failed");
    expect(unwrap(await bob.mutation(api.clues.upsertManualPreference, memory(roomId, "  trimmed  "))).text).toBe("trimmed");
    expect(code(await bob.mutation(api.clues.upsertManualPreference, memory(roomId, "x".repeat(LIMITS.clueTextMaxChars))))).toBeNull();
    expect(code(await bob.mutation(api.clues.upsertManualPreference, memory(roomId, "x".repeat(LIMITS.clueTextMaxChars + 1))))).toBe("validation_failed");
  });

  it("dedupes a duplicate submission (case-insensitive) and does not bump the knowledge revision twice", async () => {
    const { as, roomId } = await twoMembers();
    const bob = as("bob");
    const first = unwrap(await bob.mutation(api.clues.upsertManualPreference, memory(roomId, "Loves pottery")));
    const revision = unwrap(await bob.query(api.rooms.getRoom, { roomId })).room.knowledgeRevision;
    const dup = unwrap(await bob.mutation(api.clues.upsertManualPreference, memory(roomId, "loves POTTERY")));
    expect(dup._id).toBe(first._id);
    expect(unwrap(await bob.query(api.rooms.getRoom, { roomId })).room.knowledgeRevision).toBe(revision);
  });

  it("creates only one clue when the same memory is submitted concurrently (double tap)", async () => {
    const { as, roomId } = await twoMembers();
    const bob = as("bob");
    await Promise.all([1, 2, 3].map(() => bob.mutation(api.clues.upsertManualPreference, memory(roomId, "Double tap memory"))));
    const all = unwrap(await bob.query(api.clues.listPublishedClues, { roomId }));
    expect(all.filter((c) => c.text === "Double tap memory")).toHaveLength(1);
  });

  it("does NOT limit a person to one memory (a UI that promises 'one memory' must enforce it itself)", async () => {
    const { as, roomId } = await twoMembers();
    const bob = as("bob");
    unwrap(await bob.mutation(api.clues.upsertManualPreference, memory(roomId, "First memory")));
    unwrap(await bob.mutation(api.clues.upsertManualPreference, memory(roomId, "Second memory")));
    expect(unwrap(await bob.query(api.clues.listPublishedClues, { roomId })).filter((c) => c.sourceKind === "manual")).toHaveLength(2);
  });

  it("THROWS (instead of returning a typed error) for an invalid clue kind; the client boundary must catch it", async () => {
    const { as, roomId } = await twoMembers();
    await expect(
      // @ts-expect-error deliberately invalid kind
      as("bob").mutation(api.clues.upsertManualPreference, { roomId, kind: "memory", text: "hello there" }),
    ).rejects.toThrow();
  });
});
