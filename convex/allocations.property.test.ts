// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * Allocation retest (Dev 2, Phase 5). Seeded, deterministic property checks
 * for allocate() against an independent water-filling reference, plus an
 * end-to-end run of the proposal engine under random cap sequences.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../lib/contracts";
import { allocate, type AllocationInput } from "./allocations";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { modules } from "./test.setup";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function intIn(rand: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

const people = (limits: number[]) => limits.map((limitMinor, i) => ({ participantId: `p${i}`, limitMinor }));

/**
 * Independent reference: the highest common level L with sum(min(cap, L)) <= total,
 * then one leftover cent each to the earliest participants whose cap exceeds L.
 */
function reference(total: number, caps: number[]): number[] | null {
  if (caps.reduce((a, b) => a + b, 0) < total) return null;
  const filled = (level: number) => caps.reduce((sum, c) => sum + Math.min(c, level), 0);
  let lo = 0;
  let hi = Math.max(...caps);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (filled(mid) <= total) lo = mid;
    else hi = mid - 1;
  }
  const out = caps.map((c) => Math.min(c, lo));
  let rest = total - filled(lo);
  for (let i = 0; i < caps.length && rest > 0; i++) {
    if (caps[i]! > lo) {
      out[i]! += 1;
      rest -= 1;
    }
  }
  return out;
}

function checkCase(total: number, caps: number[]) {
  const input: AllocationInput = { payableTotalMinor: total, participants: people(caps) };
  const frozen = JSON.stringify(input);
  const result = allocate(input);
  expect(JSON.stringify(input), "input must not be mutated").toBe(frozen);
  expect(allocate(input), "deterministic").toEqual(result);

  const capacity = caps.reduce((a, b) => a + b, 0);
  if (capacity < total) {
    expect(result).toEqual({ feasible: false, reason: "caps_insufficient" });
    return;
  }
  if (!result.feasible) throw new Error(`expected feasible for total=${total} caps=${caps.join(",")}`);
  const got = result.shares.map((s) => s.amountMinor);
  expect(result.shares.map((s) => s.participantId)).toEqual(caps.map((_, i) => `p${i}`));
  expect(got.reduce((a, b) => a + b, 0)).toBe(total);
  got.forEach((amount, i) => {
    expect(Number.isSafeInteger(amount)).toBe(true);
    expect(amount).toBeGreaterThanOrEqual(0);
    expect(amount).toBeLessThanOrEqual(caps[i]!);
  });
  for (let i = 0; i < caps.length; i++) {
    if (got[i]! >= caps[i]!) continue;
    for (let j = 0; j < caps.length; j++) {
      // Fairness: someone with spare capacity is never more than one cent behind anyone.
      expect(got[j]! - got[i]!, `fairness i=${i} j=${j}`).toBeLessThanOrEqual(1);
      // Leftover-cent priority: an earlier participant with spare capacity is never behind a later one.
      if (i < j) expect(got[i]!, `priority i=${i} j=${j}`).toBeGreaterThanOrEqual(got[j]!);
    }
  }
  expect(got).toEqual(reference(total, caps));
}

describe("allocate (exhaustive small domains)", () => {
  it("matches the reference for every cap vector up to 3 people with caps 0..6 and totals 1..20", () => {
    let cases = 0;
    for (let n = 1; n <= 3; n++) {
      const caps = new Array<number>(n).fill(0);
      const total = 7 ** n;
      for (let code = 0; code < total; code++) {
        let rest = code;
        for (let i = 0; i < n; i++) {
          caps[i] = rest % 7;
          rest = Math.floor(rest / 7);
        }
        for (let t = 1; t <= 20; t++) {
          checkCase(t, [...caps]);
          cases++;
        }
      }
    }
    expect(cases).toBe((7 + 49 + 343) * 20);
  });

  it("matches the reference for 4 people with caps 0..4 and totals 1..17", () => {
    for (let code = 0; code < 5 ** 4; code++) {
      const caps = [code % 5, Math.floor(code / 5) % 5, Math.floor(code / 25) % 5, Math.floor(code / 125) % 5];
      for (let t = 1; t <= 17; t++) checkCase(t, caps);
    }
  });
});

describe("allocate (seeded random)", () => {
  it("holds every invariant for 5,000 random rooms", () => {
    const rand = mulberry32(20261024);
    for (let run = 0; run < 5000; run++) {
      const n = intIn(rand, 1, 8);
      const caps = Array.from({ length: n }, () =>
        rand() < 0.15 ? 0 : rand() < 0.5 ? intIn(rand, 0, 50) : intIn(rand, 0, 200_000),
      );
      const capacity = caps.reduce((a, b) => a + b, 0);
      const total = rand() < 0.2 ? Math.max(1, capacity) : rand() < 0.5 ? intIn(rand, 1, Math.max(1, capacity)) : intIn(rand, 1, 400_000);
      checkCase(total, caps);
    }
  });

  it("is feasible exactly when the caps cover the total", () => {
    const rand = mulberry32(7);
    for (let run = 0; run < 2000; run++) {
      const caps = Array.from({ length: intIn(rand, 1, 5) }, () => intIn(rand, 0, 10_000));
      const capacity = caps.reduce((a, b) => a + b, 0);
      if (capacity === 0) continue;
      expect(allocate({ payableTotalMinor: capacity, participants: people(caps) }).feasible).toBe(true);
      expect(allocate({ payableTotalMinor: capacity + 1, participants: people(caps) })).toEqual({
        feasible: false,
        reason: "caps_insufficient",
      });
    }
  });

  it("rejects every malformed input as invalid_input", () => {
    const invalid = { feasible: false, reason: "invalid_input" };
    const bad = [-1, -1000, 0.5, 10.01, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1];
    const rand = mulberry32(99);
    for (const b of bad) {
      expect(allocate({ payableTotalMinor: b, participants: people([100]) })).toEqual(invalid);
      for (let run = 0; run < 50; run++) {
        const caps = Array.from({ length: intIn(rand, 1, 5) }, () => intIn(rand, 0, 1000));
        caps[intIn(rand, 0, caps.length - 1)] = b;
        expect(allocate({ payableTotalMinor: 100, participants: people(caps) })).toEqual(invalid);
      }
    }
    expect(allocate({ payableTotalMinor: 0, participants: people([100]) })).toEqual(invalid);
    expect(allocate({ payableTotalMinor: 100, participants: [] })).toEqual(invalid);
    for (let run = 0; run < 200; run++) {
      const participants = people(Array.from({ length: intIn(rand, 2, 6) }, () => intIn(rand, 0, 1000)));
      const dup = intIn(rand, 1, participants.length - 1);
      participants[dup] = { ...participants[dup]!, participantId: participants[intIn(rand, 0, dup - 1)]!.participantId };
      expect(allocate({ payableTotalMinor: 100, participants })).toEqual(invalid);
    }
  });
});

// ---------- Proposal engine end-to-end ----------

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const PRICE = 3000;
const CAP_CHOICES = [0, 1, 500, 999, 1000, 1001, 1500, 2000, 2999, 3000, 5000];

async function engineRoom() {
  const t = convexTest(schema, modules);
  const users = ["alice", "bob", "carol"].map((name) => t.withIdentity({ subject: `user_${name}|s` }));
  const created = unwrap(
    await users[0]!.mutation(api.rooms.createRoom, {
      title: "Maya",
      recipientDisplayName: "Maya",
      occasion: "Birthday",
      displayName: "Alice",
    }),
  );
  const roomId = created.room._id;
  const participantIds: Id<"participants">[] = [created.participant._id];
  for (const [i, name] of ["Bob", "Carol"].entries()) {
    // Distinct join times keep the organizer-then-join-order priority unambiguous.
    vi.advanceTimersByTime(1000);
    const joined = unwrap(
      await users[i + 1]!.mutation(api.rooms.joinRoom, { inviteToken: created.inviteToken, displayName: name }),
    );
    participantIds.push(joined.participant._id);
  }
  const listingId = await t.run(async (ctx) => {
    const jobId = await ctx.db.insert("researchJobs", {
      roomId,
      knowledgeRevision: 0,
      publishedClueIds: [],
      status: "succeeded",
      inputHash: "h",
      idempotencyKey: "k",
      attempt: 1,
      createdAt: Date.now(),
    });
    return await ctx.db.insert("productListings", {
      roomId,
      jobId,
      source: "manual_fixture",
      sourceUrl: "https://example.com/x",
      title: "Gift",
      currency: "USD",
      priceMinor: PRICE,
      priceStatus: "observed",
      availability: "in_stock",
      shippingStatus: "unknown",
      retrievedAt: Date.now(),
      status: "active",
    });
  });
  unwrap(await users[0]!.mutation(api.proposals.selectGift, { roomId, listingId }));
  return { t, users, roomId, participantIds };
}

interface EngineState {
  current: Doc<"proposalRevisions">;
  revisions: Doc<"proposalRevisions">[];
  approvalsByRevision: Record<string, Doc<"approvals">[]>;
}

async function readState(t: Awaited<ReturnType<typeof engineRoom>>["t"], roomId: Id<"rooms">): Promise<EngineState> {
  return await t.run(async (ctx) => {
    const room = (await ctx.db.get(roomId))!;
    const revisions = await ctx.db
      .query("proposalRevisions")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();
    const approvalsByRevision: Record<string, Doc<"approvals">[]> = {};
    for (const r of revisions) {
      approvalsByRevision[r._id] = await ctx.db
        .query("approvals")
        .withIndex("by_revision", (q) => q.eq("revisionId", r._id))
        .collect();
    }
    const current = revisions.find((r) => r._id === room.currentRevisionId);
    if (!current) throw new Error("room has no current revision");
    return { current, revisions, approvalsByRevision };
  });
}

describe("proposal engine under random cap sequences", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`keeps revision invariants (seed ${seed})`, async () => {
      const rand = mulberry32(seed * 7919);
      const { t, users, roomId, participantIds } = await engineRoom();
      const caps: Array<number | undefined> = [undefined, undefined, undefined];
      let prev = await readState(t, roomId);
      const seen = { minted: 0, unchanged: 0, approvals: 0 };

      for (let step = 0; step < 40; step++) {
        const who = intIn(rand, 0, 2);
        const action = rand();
        let approved = false;
        if (action < 0.6) {
          // Sometimes repeat the existing cap to exercise the no-op path.
          const amount = rand() < 0.2 && caps[who] !== undefined ? caps[who]! : CAP_CHOICES[intIn(rand, 0, CAP_CHOICES.length - 1)]!;
          unwrap(await users[who]!.mutation(api.proposals.setContributionLimit, { roomId, amountMinor: amount }));
          caps[who] = amount;
        } else {
          const result = await users[who]!.mutation(api.proposals.approveRevision, { revisionId: prev.current._id });
          if (prev.current.status === "infeasible") {
            expect(result).toMatchObject({ ok: false, error: { code: "infeasible" } });
          } else {
            expect(result).toMatchObject({ ok: true });
            approved = true;
            seen.approvals++;
          }
        }

        const next = await readState(t, roomId);
        const expected = allocate({
          payableTotalMinor: PRICE,
          participants: participantIds.map((id, i) => ({ participantId: id, limitMinor: caps[i] ?? 0 })),
        });
        const expectedShares = expected.feasible ? expected.shares : [];
        const sharesNow = next.current.shares.map((s) => ({ participantId: s.participantId, amountMinor: s.amountMinor }));
        expect(sharesNow, `step ${step} shares`).toEqual(expectedShares);
        expect(next.current.status === "infeasible", `step ${step} feasibility`).toBe(!expected.feasible);
        expect(next.current.payableTotalMinor).toBe(PRICE);

        const prevShares = prev.current.shares.map((s) => ({ participantId: s.participantId, amountMinor: s.amountMinor }));
        const sameDeal =
          (prev.current.status === "infeasible") === (next.current.status === "infeasible") &&
          JSON.stringify(prevShares) === JSON.stringify(sharesNow);
        seen[sameDeal ? "unchanged" : "minted"]++;
        if (sameDeal) {
          expect(next.current._id, `step ${step}: unchanged deal must not mint a revision`).toBe(prev.current._id);
          expect(next.revisions.length).toBe(prev.revisions.length);
          if (!approved) {
            expect(next.approvalsByRevision[next.current._id]).toEqual(prev.approvalsByRevision[prev.current._id]);
          }
        } else {
          expect(next.current._id, `step ${step}: changed shares must mint a revision`).not.toBe(prev.current._id);
          expect(next.current.revisionNumber).toBe(prev.current.revisionNumber + 1);
          const old = next.revisions.find((r) => r._id === prev.current._id)!;
          expect(old.status).toBe("superseded");
          for (const a of next.approvalsByRevision[old._id] ?? []) {
            expect(["invalidated", "withdrawn"], `step ${step}: stale approval ${a.status}`).toContain(a.status);
          }
        }

        // Global invariants.
        const numbers = next.revisions.map((r) => r.revisionNumber).sort((a, b) => a - b);
        expect(numbers).toEqual(numbers.map((_, i) => i + 1));
        for (const r of next.revisions) {
          if (r._id !== next.current._id) expect(r.status).toBe("superseded");
        }
        const live = next.approvalsByRevision[next.current._id] ?? [];
        if (next.current.status === "infeasible") {
          expect(live).toEqual([]);
        } else {
          expect(live.map((a) => a.participantId).sort()).toEqual([...participantIds].sort());
          const allApproved = live.every((a) => a.status === "approved");
          expect(next.current.status).toBe(allApproved ? "approved_pledged" : "awaiting_approval");
        }
        prev = next;
      }
      // Guards against a seed that never exercises one of the paths.
      expect(seen.minted).toBeGreaterThan(0);
      expect(seen.unchanged).toBeGreaterThan(0);
      expect(seen.approvals).toBeGreaterThan(0);
    });
  }
});
