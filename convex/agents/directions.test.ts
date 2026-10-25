// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "../../lib/contracts";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { modules } from "../test.setup";
import fixture from "../research/fixtures/johnvc-shopping.json";

const research = internal.research.research;
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code + ": " + result.error.message);
  return result.value;
}

async function setup() {
  const t = convexTest(schema, modules);
  const alex = t.withIdentity({ subject: "user_alex|session1" });
  const roomId = unwrap(await alex.mutation(api.rooms.createRoom, {
    title: "Maya", recipientDisplayName: "Maya", occasion: "Birthday", budgetMinor: 8000,
  })).room._id;
  const pottery = unwrap(await alex.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text: "interested in pottery" }))._id;
  const tools = unwrap(await alex.mutation(api.clues.upsertManualPreference, { roomId, kind: "explicit_wish", text: "pottery tools" }))._id;
  const room = (await t.run((ctx) => ctx.db.get(roomId)))!;
  const direction = (label: string, query: string) => t.run((ctx) => ctx.db.insert("mapDirections", {
    roomId, label, query, why: "Joins her pottery with her wish for tools.", clueIds: [pottery, tools], broad: false,
    source: "preset", knowledgeRevision: room.knowledgeRevision, createdAt: Date.now(),
  }));
  const search = async (directionId: Id<"mapDirections"> | undefined, key: string) => {
    const { jobId } = unwrap(await alex.mutation(api.research.research.startResearch, {
      roomId, publishedClueIds: [pottery, tools], idempotencyKey: key, ...(directionId ? { directionId } : {}),
    }));
    return jobId;
  };
  const finish = async (jobId: Id<"researchJobs">) => {
    await t.mutation(research.claimJob, { jobId });
    await t.mutation(research.completeJob, { jobId, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
  };
  return { t, alex, roomId, pottery, tools, direction, search, finish };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("searching one direction", () => {
  it("uses the direction's search and requires its memories", async () => {
    const s = await setup();
    const d = await s.direction("Pottery tools", "pottery trimming tools");
    const jobId = await s.search(d, "d1");
    const job = (await s.t.run((ctx) => ctx.db.get(jobId)))!;
    expect(job.brief?.queryTerms).toEqual(["pottery trimming tools"]);
    expect(job.directionId).toBe(d);
    const missing = await s.alex.mutation(api.research.research.startResearch, {
      roomId: s.roomId, publishedClueIds: [s.pottery], idempotencyKey: "d2", directionId: d,
    });
    expect(missing.ok).toBe(false);
  });

  it("runs directions side by side; only a newer search in the same direction replaces one", async () => {
    const s = await setup();
    const a = await s.direction("Pottery tools", "pottery trimming tools");
    const b = await s.direction("Glaze kit", "pottery glaze kit");
    const first = await s.search(a, "a1");
    const other = await s.search(b, "b1");
    const general = await s.search(undefined, "g1");
    await s.finish(first);
    await s.finish(other);
    await s.finish(general);
    const statuses = await s.t.run((ctx) => Promise.all([first, other, general].map(async (id) => (await ctx.db.get(id))!.status)));
    expect(statuses).toEqual(["succeeded", "succeeded", "succeeded"]);
    const again = await s.search(a, "a2");
    await s.t.mutation(research.claimJob, { jobId: again });
    // Identical inputs would reuse the open job; a changed search in the same direction is a genuinely newer one.
    await s.t.run((ctx) => ctx.db.patch(a, { query: "pottery carving tools" }));
    const replaced = await s.search(a, "a3");
    expect(replaced).not.toBe(again);
    await s.t.mutation(research.claimJob, { jobId: replaced });
    await s.t.mutation(research.completeJob, { jobId: again, raw: fixture.pages, retrievedAt: fixture.retrievedAt });
    expect((await s.t.run((ctx) => ctx.db.get(again)))!.status).toBe("stale");
  });

  it("shows two gifts per direction, each saying which direction found it", async () => {
    const s = await setup();
    const a = await s.direction("Pottery tools", "pottery trimming tools");
    await s.finish(await s.search(a, "a1"));
    await s.finish(await s.search(undefined, "g1"));
    const view = unwrap(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId }));
    const fromA = view.recommendations.filter((r) => r.foundBy?.directionId === a);
    expect(fromA).toHaveLength(2);
    expect(fromA[0]?.foundBy).toMatchObject({ source: "direction", query: "pottery trimming tools" });
    expect(view.recommendations.length).toBeLessThanOrEqual(4);
    expect(view.searchPools?.find((p) => p.directionId === a)).toMatchObject({ query: "pottery trimming tools", shown: 2 });
  });

  it("lets a direction go once the room passes on it, gifts and all", async () => {
    const s = await setup();
    const a = await s.direction("Pottery tools", "pottery trimming tools");
    await s.finish(await s.search(a, "a1"));
    unwrap(await s.alex.mutation(api.mapSignals.setDirection, { roomId: s.roomId, targetKind: "direction", targetId: a, value: -1 }));
    const view = unwrap(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId }));
    expect(view.recommendations.filter((r) => r.foundBy?.directionId === a)).toEqual([]);
  });
});

describe("signals on directions and trend clouds", () => {
  it("only accepts directions and trend searches that are really on this map", async () => {
    const s = await setup();
    const a = await s.direction("Pottery tools", "pottery trimming tools");
    expect((await s.alex.mutation(api.mapSignals.setDirection, { roomId: s.roomId, targetKind: "direction", targetId: a, value: 1 })).ok).toBe(true);
    expect((await s.alex.mutation(api.mapSignals.setDirection, { roomId: s.roomId, targetKind: "direction", targetId: "nope", value: 1 })).ok).toBe(false);
    expect((await s.alex.mutation(api.mapSignals.setDirection, { roomId: s.roomId, targetKind: "trend", targetId: "nope:hiking boots", value: 1 })).ok).toBe(false);
  });
});

describe("the council proposing directions without a model", () => {
  it("combines a wish with an interest, and looks up trends once for the room", async () => {
    const s = await setup();
    vi.stubEnv("LLM_API_KEY", "");
    const result = unwrap(await s.alex.action(api.agents.directions.propose, { roomId: s.roomId }));
    expect(result).toMatchObject({ source: "preset", asked: false });
    const listed = unwrap(await s.alex.query(api.agents.directions.list, { roomId: s.roomId }));
    expect(listed[0]).toMatchObject({ query: "pottery pottery tools", clueIds: [s.tools, s.pottery], researched: false, stale: false });
    expect(await s.t.run((ctx) => ctx.db.query("trendJobs").collect())).toHaveLength(1);
  });

  it("publishing a memory no longer schedules a trend lookup by itself", async () => {
    const s = await setup();
    await s.alex.mutation(api.clues.upsertManualPreference, { roomId: s.roomId, kind: "interest", text: "tennis" });
    const scheduled = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((f) => f.name.includes("trendJobs"))).toEqual([]);
    expect(await s.t.run((ctx) => ctx.db.query("trendJobs").collect())).toEqual([]);
  });
});

describe("the council reacting to passes", () => {
  const scheduledReplacement = (s: Awaited<ReturnType<typeof setup>>) =>
    s.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).find((f) => f.name.includes("directions") && f.name.endsWith("replace")));

  it("retires a passed direction, keeps the reason, and replaces only that one", async () => {
    const s = await setup();
    vi.stubEnv("LLM_API_KEY", "");
    const a = await s.direction("Pottery tools", "pottery trimming tools");
    const b = await s.direction("Glaze kit", "pottery glaze kit");
    unwrap(await s.alex.mutation(api.mapSignals.setDirection, { roomId: s.roomId, targetKind: "direction", targetId: a, value: -1, reason: "vibe" }));
    expect((await s.t.run((ctx) => ctx.db.get(a)))?.retiredAt).toBeTypeOf("number");
    const job = await scheduledReplacement(s);
    expect(job?.args[0]).toMatchObject({ directionId: a, passed: [expect.stringContaining("wrong vibe")] });
    await s.t.action(internal.agents.directions.replace, job!.args[0] as { roomId: Id<"rooms">; directionId: Id<"mapDirections">; participantId: Id<"participants">; passed: string[] });
    const listed = unwrap(await s.alex.query(api.agents.directions.list, { roomId: s.roomId }));
    expect(listed.map((d) => d.id)).toContain(b);
    expect(listed.map((d) => d.id)).not.toContain(a);
    const replacement = (await s.t.run((ctx) => ctx.db.query("mapDirections").collect())).find((d) => d.replaces === a);
    expect(replacement).toBeDefined();
    const trail = unwrap(await s.alex.query(api.trail.list, { roomId: s.roomId }));
    expect(trail.find((e) => e.text.startsWith("Retired “Pottery tools”"))?.text).toContain("wrong vibe");
    expect(trail.find((e) => e.text.startsWith("Suggested"))?.text).toContain("in place of “Pottery tools”");
  });

  it("gives up on a direction once the room lets two of its gifts go", async () => {
    const s = await setup();
    const a = await s.direction("Pottery tools", "pottery trimming tools");
    await s.finish(await s.search(a, "a1"));
    const listings = await s.t.run((ctx) => ctx.db.query("productListings").collect());
    unwrap(await s.alex.mutation(api.votes.castVote, { roomId: s.roomId, listingId: listings[0]!._id, value: "down", reason: "price" }));
    expect((await s.t.run((ctx) => ctx.db.get(a)))?.retiredAt).toBeUndefined();
    unwrap(await s.alex.mutation(api.votes.castVote, { roomId: s.roomId, listingId: listings[1]!._id, value: "down" }));
    expect((await s.t.run((ctx) => ctx.db.get(a)))?.retiredAt).toBeTypeOf("number");
    expect((await scheduledReplacement(s))?.args[0]).toMatchObject({ passed: [expect.stringContaining("too pricey")] });
  });

  it("gives a pulled-in direction a third gift, and puts a pulled gift first", async () => {
    const s = await setup();
    const a = await s.direction("Pottery tools", "pottery trimming tools");
    await s.finish(await s.search(a, "a1"));
    const before = unwrap(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId })).recommendations;
    unwrap(await s.alex.mutation(api.mapSignals.setDirection, { roomId: s.roomId, targetKind: "direction", targetId: a, value: 1 }));
    const after = unwrap(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId })).recommendations;
    expect(after.length).toBe(before.length + 1);
    const last = after.at(-1)!;
    unwrap(await s.alex.mutation(api.votes.castVote, { roomId: s.roomId, listingId: last.listingId as Id<"productListings">, value: "up" }));
    const pulled = unwrap(await s.alex.query(api.research.research.listRecommendations, { roomId: s.roomId })).recommendations;
    expect(pulled[0]?.listingId).toBe(last.listingId);
  });
});

describe("how we got here", () => {
  it("records each step as one readable line, for members only", async () => {
    const s = await setup();
    vi.stubEnv("LLM_API_KEY", "");
    unwrap(await s.alex.action(api.agents.directions.propose, { roomId: s.roomId }));
    const [d] = unwrap(await s.alex.query(api.agents.directions.list, { roomId: s.roomId }));
    await s.finish(await s.search(d!.id as Id<"mapDirections">, "a1"));
    unwrap(await s.alex.mutation(api.mapSignals.setDirection, { roomId: s.roomId, targetKind: "direction", targetId: d!.id, value: -1 }));
    const trail = unwrap(await s.alex.query(api.trail.list, { roomId: s.roomId }));
    expect(trail.map((e) => e.stage)).toEqual(expect.arrayContaining(["council", "search", "steering"]));
    expect(trail.find((e) => e.stage === "council" && e.outcome === "kept")).toMatchObject({ actor: "council", directionId: d!.id });
    expect(trail.find((e) => e.stage === "search")?.text).toMatch(/^Searched Google Shopping for “pottery pottery tools”: \d+ results came back/);
    expect(trail.find((e) => e.stage === "steering")).toMatchObject({ outcome: "rejected", who: expect.any(String) });
    expect(trail.find((e) => e.stage === "steering")?.text).toContain("passed on the direction");
    const eve = s.t.withIdentity({ subject: "user_eve|session2" });
    expect((await eve.query(api.trail.list, { roomId: s.roomId })).ok).toBe(false);
  });

  it("names shares on approval but never anyone's private maximum", async () => {
    const s = await setup();
    await s.finish(await s.search(undefined, "g1"));
    const listing = (await s.t.run((ctx) => ctx.db.query("productListings").first()))!;
    unwrap(await s.alex.mutation(api.proposals.selectGift, { roomId: s.roomId, listingId: listing._id }));
    unwrap(await s.alex.mutation(api.proposals.setContributionLimit, { roomId: s.roomId, amountMinor: 987_654 }));
    const proposal = unwrap(await s.alex.query(api.proposals.getProposal, { roomId: s.roomId }));
    unwrap(await s.alex.mutation(api.proposals.approveRevision, { revisionId: proposal.revision!.id as Id<"proposalRevisions"> }));
    const trail = unwrap(await s.alex.query(api.trail.list, { roomId: s.roomId }));
    expect(trail.find((e) => e.stage === "choice")?.text).toContain("in the box");
    expect(trail.filter((e) => e.stage === "money").map((e) => e.text).join(" ")).toMatch(/approved the \$[\d.,]+ version/);
    expect(JSON.stringify(trail)).not.toMatch(/9,?876\.54|987654/);
  });
});

describe("answers and reactions stay out of the memory list", () => {
  it("a preset sharpen answer is a vote, not a memory", async () => {
    const s = await setup();
    await s.finish(await s.search(undefined, "g1"));
    const [a, b] = (await s.t.run((ctx) => ctx.db.query("productListings").collect())).map((l) => l._id);
    const me = (await s.t.run((ctx) => ctx.db.query("participants").first()))!._id;
    const sharpenId = await s.t.run((ctx) => ctx.db.insert("mapSharpens", {
      roomId: s.roomId, question: "Which feels more like Maya?", options: [{ label: "A", clue: "", listingIds: [a!] }, { label: "B", clue: "", listingIds: [b!] }],
      finalistIds: [a!, b!], source: "preset", askedBy: me, status: "open", knowledgeRevision: 0, createdAt: Date.now(),
    }));
    const before = (await s.t.run((ctx) => ctx.db.query("publishedClues").collect())).length;
    unwrap(await s.alex.mutation(api.agents.themes.answerSharpen, { sharpenId, option: 0 }));
    expect((await s.t.run((ctx) => ctx.db.query("publishedClues").collect())).length).toBe(before);
    expect(await s.t.run((ctx) => ctx.db.query("votes").collect())).toMatchObject([{ listingId: a, value: "up" }]);
  });

  it("“she already has it” names the kind of thing, not the listing", async () => {
    const s = await setup();
    await s.finish(await s.search(undefined, "g1"));
    const listing = (await s.t.run((ctx) => ctx.db.query("productListings").first()))!;
    unwrap(await s.alex.mutation(api.map.setFeedback, { roomId: s.roomId, listingId: listing._id, kind: "owned" }));
    const owned = (await s.t.run((ctx) => ctx.db.query("publishedClues").collect())).find((c) => c.kind === "ownership")!;
    expect(owned.text.startsWith("Already owns ")).toBe(true);
    expect(owned.text).not.toBe(`Already owns ${listing.title}`);
    expect(owned.text.split(" ").length).toBeLessThanOrEqual(4);
  });
});
