// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * QA: frontend <-> Convex contract checks. Everything the UI currently uses
 * (mock actions, Zod schemas, fixtures, routes) is compared with what the real
 * backend returns. Owners' schemas/functions are only read, never changed.
 *
 * Suites named "known gaps" are CHARACTERIZATION tests: they pass today because
 * they pin down a gap that exists today. When a teammate closes the gap the test
 * fails on purpose; update it (and docs/QA.md) rather than deleting the check.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { Result } from "../../lib/contracts";
import { mockParticipants, mockRoom } from "../../lib/mocks/fixtures";
import { createRoomDraftSchema, joinRoomDraftSchema, mockLandingActions } from "../../lib/mocks/landing";
import { roomQuery } from "../../lib/mocks/queries";
import { LIMITS } from "../../lib/validation";
import { api } from "../../convex/_generated/api";
import { joinPath } from "../../convex/rooms";
import schema from "../../convex/schema";
import { modules } from "../../convex/test.setup";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

// Mirrors lib/contracts `Room` / `Participant` (compile-time shape is enforced by
// toRoom/toParticipant; this checks the runtime payload the browser receives).
const ROOM_REQUIRED = ["id", "title", "recipientDisplayName", "occasion", "currency", "knowledgeRevision", "inviteToken", "createdBy", "createdAt"];
const ROOM_ALLOWED = [...ROOM_REQUIRED, "deadlineAt", "budgetMinor", "currentRevisionId", "currentSelectionId", "latestMessageId"];
const PARTICIPANT_KEYS = ["id", "roomId", "userId", "displayName", "role", "joinedAt"];

function world() {
  const t = convexTest(schema, modules);
  return { t, as: (n: string) => t.withIdentity({ subject: `user_${n}|s_${n}` }) };
}

describe("room payload shape", () => {
  it("backend getRoom returns the same RoomView shape the mock roomQuery returns (but wrapped in a Result)", async () => {
    const { as } = world();
    const created = unwrap(await as("alice").mutation(api.rooms.createRoom, { title: "T", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alice" }));
    const raw = await as("alice").query(api.rooms.getRoom, { roomId: created.room._id });

    // The mock is a bare RoomView; the backend wraps it in { ok, value }. Components swapping
    // roomQuery() for useQuery(api.rooms.getRoom) must unwrap Result AND handle `undefined` while loading.
    expect(Object.keys(roomQuery("x")).sort()).toEqual(["me", "participants", "room"]);
    expect(raw).toHaveProperty("ok", true);
    const view = unwrap(raw);
    expect(Object.keys(view).sort()).toEqual(["me", "participants", "room"]);

    const roomKeys = Object.keys(view.room);
    for (const key of ROOM_REQUIRED) expect(roomKeys, `room.${key}`).toContain(key);
    for (const key of roomKeys) expect(ROOM_ALLOWED, `unexpected room.${key}`).toContain(key);
    expect(Object.keys(view.me).sort()).toEqual([...PARTICIPANT_KEYS].sort());
    expect(Object.keys(view.participants[0]!).sort()).toEqual([...PARTICIPANT_KEYS].sort());
    // Fixtures stay representative of the real thing.
    for (const key of ROOM_REQUIRED) expect(Object.keys(mockRoom)).toContain(key);
    expect(Object.keys(mockParticipants[0]!).sort()).toEqual([...PARTICIPANT_KEYS].sort());
  });
});

describe("UI validation vs backend validation (same boundaries)", () => {
  type Case = { label: string; value: string; ui: boolean; backendOk: boolean };

  async function backendAccepts(field: "displayName" | "recipientDisplayName" | "occasion", value: string): Promise<boolean> {
    const { as } = world();
    const base = { title: "Title", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alice" };
    const res = await as("alice").mutation(api.rooms.createRoom, { ...base, [field]: value });
    return res.ok;
  }

  const lengths = (max: number) => [
    { label: "blank", value: "   " },
    { label: "1 char", value: "a" },
    { label: `${max} chars`, value: "a".repeat(max) },
    { label: `${max + 1} chars`, value: "a".repeat(max + 1) },
  ];

  it.each([
    ["your name", "displayName", LIMITS.displayNameMaxChars],
    ["recipient name", "recipientDisplayName", LIMITS.displayNameMaxChars],
    ["occasion", "occasion", 80],
  ] as const)("create-room %s: UI and backend accept/reject the same inputs", async (_label, field, max) => {
    const base = { recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alice" };
    const results: Case[] = [];
    for (const { label, value } of lengths(max)) {
      const ui = createRoomDraftSchema.safeParse({ ...base, [field]: value }).success;
      results.push({ label, value, ui, backendOk: await backendAccepts(field, value) });
    }
    for (const r of results) expect(r.ui, `${field} ${r.label}: UI=${r.ui} backend=${r.backendOk}`).toBe(r.backendOk);
  });

  it("join display name: UI and backend agree at the boundaries", async () => {
    const { as } = world();
    const room = unwrap(await as("alice").mutation(api.rooms.createRoom, { title: "T", recipientDisplayName: "Maya", occasion: "B", displayName: "Alice" }));
    let n = 0;
    for (const { label, value } of lengths(LIMITS.displayNameMaxChars)) {
      const ui = joinRoomDraftSchema.safeParse({ inviteToken: room.inviteToken, displayName: value }).success;
      const backend = (await as(`joiner${n++}`).mutation(api.rooms.joinRoom, { inviteToken: room.inviteToken, displayName: value })).ok;
      expect(ui, `join name ${label}`).toBe(backend);
    }
  });

  it("every token the backend issues passes the UI's invite-code validation", async () => {
    const { as } = world();
    for (let i = 0; i < 10; i++) {
      const { inviteToken } = unwrap(await as(`o${i}`).mutation(api.rooms.createRoom, { title: "T", recipientDisplayName: "M", occasion: "B" }));
      expect(joinRoomDraftSchema.safeParse({ inviteToken, displayName: "Sam" }).success).toBe(true);
    }
  });

  it("the UI invite-code limit (64) is stricter than the backend's (128): harmless, but the two should not drift further", async () => {
    const { as } = world();
    const token = "t".repeat(100);
    expect(joinRoomDraftSchema.safeParse({ inviteToken: token, displayName: "Sam" }).success).toBe(false);
    // The backend would treat it as a well-formed but unknown code.
    const res = await as("bob").mutation(api.rooms.joinRoom, { inviteToken: token, displayName: "Sam" });
    expect(res.ok ? null : res.error.code).toBe("not_found");
  });
});

describe("routes", () => {
  it("backend joinPath() produces a URL served by the app/join/[token] route", async () => {
    expect(joinPath("abc123")).toBe("/join/abc123");
    const pages = Object.keys(import.meta.glob("../../app/join/*/page.tsx"));
    expect(pages).toEqual(["../../app/join/[token]/page.tsx"]);
  });
});

describe("known gaps (characterization: update when the frontend is wired to Convex)", () => {
  it("GAP: the landing create-room form collects no room title, but backend createRoom requires one", async () => {
    expect(Object.keys(createRoomDraftSchema.shape).sort()).toEqual(["displayName", "occasion", "recipientDisplayName"]);
    const { as } = world();
    // Sending the form's draft as-is is rejected by Convex argument validation (it throws, not a Result).
    await expect(
      // @ts-expect-error `title` is required by api.rooms.createRoom and absent from the UI draft
      as("alice").mutation(api.rooms.createRoom, { recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alex" }),
    ).rejects.toThrow();
  });

  it("GAP: the mock create result carries no invite token, so the UI cannot show a link/QR for a new room", async () => {
    const res = await mockLandingActions.createRoom({ recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alex" });
    expect(unwrap(res)).toEqual({ roomId: "room_demo", source: "mock" });
    // The backend returns { room, participant, inviteToken }; LandingRoomEntry has no place for them.
  });

  it("GAP: mock joinRoom only knows the one fixture token and is blind to real tokens", async () => {
    const { as } = world();
    const real = unwrap(await as("alice").mutation(api.rooms.createRoom, { title: "T", recipientDisplayName: "M", occasion: "B" }));
    const res = await mockLandingActions.joinRoom({ inviteToken: real.inviteToken, displayName: "Sam" });
    expect(res.ok ? null : res.error.code).toBe("not_found");
  });

  const sources = import.meta.glob(["../../components/**/*.{ts,tsx}", "../../app/**/*.{ts,tsx}"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

  it("GAP: no UI module calls a Convex query/mutation", () => {
    const callers = Object.entries(sources)
      .filter(([path]) => !path.endsWith("ConvexClientProvider.tsx"))
      .filter(([, src]) => /\b(useQuery|useMutation|useAction|usePaginatedQuery|useConvex)\s*\(|_generated\/api/.test(src))
      .map(([path]) => path);
    expect(callers).toEqual([]);
  });

  it("GAP: the app is wrapped in a plain ConvexProvider, but the backend requires Convex Auth (anonymous sign-in)", () => {
    const provider = Object.entries(sources).find(([path]) => path.endsWith("ConvexClientProvider.tsx"))?.[1] ?? "";
    expect(provider).toContain("ConvexProvider");
    expect(provider).not.toContain("ConvexAuthProvider");
    expect(provider).not.toContain("signIn");
  });

  it("GAP: /room/[roomId] renders mock data for ANY room id", () => {
    expect(roomQuery("definitely-not-a-real-room").room.title).toBe(mockRoom.title);
    expect(roomQuery("another-id").room.id).toBe("another-id");
  });

  it.todo("UI: create room calls api.rooms.createRoom with a title and shows the returned invite link");
  it.todo("UI: /join/[token] calls api.rooms.previewInvite then api.rooms.joinRoom");
  it.todo("UI: memory submission calls api.clues.upsertManualPreference and enforces 'one memory' itself");
  it.todo("UI: Convex Auth anonymous sign-in happens before the first mutation");
});
