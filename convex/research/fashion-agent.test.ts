// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import schema from "../schema";
import sample from "../../lib/research/fixtures/tiktok-fashion.json";
import type { Result } from "../../lib/contracts";
import type { BuyerSnapshot } from "../agents/engine";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(sample.context.retrievedAt + 1000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fashion discovery → Alan buyer → product worker", () => {
  it("sends bounded recorded context to the buyer and uses its chosen query in the existing shopping provider", async () => {
    vi.stubEnv("DEMO_SEED_ENABLED", "true");
    vi.stubEnv("LLM_BASE_URL", "https://model.example/v1");
    vi.stubEnv("LLM_API_KEY", "synthetic-model-key");
    vi.stubEnv("LLM_MODEL", "synthetic-model");
    vi.stubEnv("APIFY_TOKEN", "synthetic-apify-key");
    const t = convexTest(schema, modules);
    const alex = t.withIdentity({ subject: "fashion-alex" });
    const room = unwrap(await alex.mutation(api.rooms.createRoom, {
      title: "Fashion", recipientDisplayName: "Maya", occasion: "Birthday", budgetMinor: 6000,
    })).room;
    const clue = unwrap(await alex.mutation(api.clues.upsertManualPreference, {
      roomId: room._id, kind: "interest", text: "Likes vintage denim",
    }));
    const excluded = unwrap(await alex.mutation(api.clues.upsertManualPreference, {
      roomId: room._id, kind: "exclusion", text: "No denim jackets",
    }));
    let suppliedSnapshot: BuyerSnapshot | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, options) => {
      if (String(url).includes("model.example")) {
        const request = JSON.parse(String(options?.body)) as { messages: Array<{ content: string }> };
        const input = JSON.parse(request.messages[1]!.content) as { snapshot: BuyerSnapshot };
        suppliedSnapshot = input.snapshot;
        const direction = input.snapshot.fashionDiscovery!.directions[0]!;
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          intent: "search", rationale: "Explore a direction from the recorded sample for the confirmed denim interest.", needsFollowup: false,
          searchBrief: { roomId: room._id, knowledgeRevision: input.snapshot.knowledgeRevision,
            queryTerms: [direction.searchQuery], mustExclude: [], budgetMinor: 1, listingLimit: 12 },
        }) } }] });
      }
      return Response.json({ data: { id: "shoppingRun", status: "RUNNING" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const { jobId } = unwrap(await alex.mutation(api.agents.buyer.requestTurn, { roomId: room._id, mode: "auto" }));
    await t.action(internal.agents.buyer.evaluateThread, { jobId });
    expect(suppliedSnapshot?.fashionDiscovery?.supportingPublishedClueIds).toEqual([clue._id]);
    expect(suppliedSnapshot?.fashionDiscovery?.mode).toBe("recorded_sample");
    const jobs = await t.run(ctx => ctx.db.query("researchJobs").collect());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.brief?.queryTerms).toEqual(["vintage loose fit jeans"]);
    expect(jobs[0]?.brief?.budgetMinor).toBe(6000); // Model cannot replace the room budget.
    expect(jobs[0]?.brief?.mustExclude).toContain(excluded.text);
    await t.action(internal.research.research.runResearch, { jobId: jobs[0]!._id });
    const sourceCalls = fetcher.mock.calls.filter(([url]) => String(url).includes("api.apify.com"));
    expect(sourceCalls).toHaveLength(1);
    expect(JSON.parse(String(sourceCalls[0]?.[1]?.body))).toMatchObject({ queries: ["vintage loose fit jeans"], maxPrice: 60 });
    expect(String(sourceCalls[0]?.[0])).not.toContain("tiktok");
    const current = await t.run(ctx => ctx.db.get(room._id));
    expect(current?.knowledgeRevision).toBe(room.knowledgeRevision + 2);
    expect(await t.run(ctx => ctx.db.query("publishedClues").collect())).toHaveLength(2);
  });
});
