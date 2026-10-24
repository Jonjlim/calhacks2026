// @vitest-environment edge-runtime
/// <reference types="vite/client" />
/**
 * AI Council ingest: auth, validation, idempotency, ordering, decorations,
 * and research reuse. Runs against the real schema with convex-test.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decorationsFrom, reduceCouncil, type CouncilEvent } from "../lib/council/contracts";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const SECRET = "test-ingest-secret-0123456789";
const auth = { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

let seq = 0;
function event(runId: string, actor: CouncilEvent["actor"], status: CouncilEvent["status"], extra: Partial<CouncilEvent> = {}): CouncilEvent {
  const task = { archivist: "analyze_memories", muse: "design_decoration", scout: "research_gifts", keeper: "check_constraints", courier: "deliver_recommendations" }[actor] as CouncilEvent["task"];
  return { eventId: `ev_${actor}_${status}_${seq}`, runId, actor, task, status, sequence: seq++, timestamp: 1_700_000_000_000 + seq, ...extra };
}

const pottery = { memoryId: "mem_pottery01", jar: "wish", assetId: "ceramic_charm", color: "terracotta", placement: "front_ribbon", label: "Pottery" };

describe("council ingest", () => {
  beforeEach(() => {
    vi.stubEnv("COUNCIL_INGEST_SECRET", SECRET);
    seq = 0;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function setup() {
    const t = convexTest(schema, modules);
    const post = (path: string, body: unknown, headers: Record<string, string> = auth) =>
      t.fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
    const res = await post("/council/runs", { runId: "run_demo000001", source: "web", demoKey: "demo_key0001" });
    expect(res.status).toBe(200);
    return { t, post };
  }

  it("rejects callers without the shared secret", async () => {
    const t = convexTest(schema, modules);
    const attempts: Record<string, string>[] = [{ "Content-Type": "application/json" }, { Authorization: "Bearer wrong-secret-0123456789", "Content-Type": "application/json" }];
    for (const headers of attempts) {
      const res = await t.fetch("/council/runs", { method: "POST", headers, body: JSON.stringify({ runId: "run_demo000001", source: "web" }) });
      expect(res.status).toBe(401);
    }
  });

  it("validates events and refuses unapproved decorations", async () => {
    const { post } = await setup();
    expect((await post("/council/events", { ...event("run_demo000001", "muse", "started"), actor: "wizard" })).status).toBe(400);
    const bad = event("run_demo000001", "muse", "completed", { result: { decorations: [{ ...pottery, assetId: "dragon_statue" }] } });
    expect((await post("/council/events", bad)).status).toBe(400);
    expect((await post("/council/events", { ...event("run_demo000001", "scout", "started"), rawMemory: "secret" })).status).toBe(400);
    // Events for an unknown run are refused with a non-retryable 409.
    expect((await post("/council/events", event("run_unknown001", "scout", "started"))).status).toBe(409);
  });

  it("stores a full run idempotently and derives per-actor state in any arrival order", async () => {
    const { t, post } = await setup();
    const run = "run_demo000001";
    const evs = [
      event(run, "courier", "started"),
      event(run, "archivist", "started"),
      event(run, "archivist", "completed", { result: { summary: "loves: pottery; budget $80" } }),
      event(run, "muse", "started"),
      event(run, "scout", "started"),
      event(run, "muse", "completed", { result: { summary: "Pottery charm", decorations: [pottery] } }),
      event(run, "scout", "failed", { result: { error: "Research timed out." } }),
      event(run, "keeper", "started"),
      event(run, "keeper", "completed", { result: { summary: "0 fit, 0 excluded" } }),
      event(run, "courier", "completed", { result: { summary: "Delivered 0 recommendations" } }),
    ];
    // Deliver shuffled, with duplicates (retries).
    for (const e of [...evs].reverse()) await post("/council/events", e);
    const dup = await post("/council/events", evs[5]);
    expect(await dup.json()).toMatchObject({ status: "duplicate" });

    const state = await t.query(api.council.demoState, { demoKey: "demo_key0001" });
    expect(state?.run?.status).toBe("completed");
    expect(state?.events.map((e) => e.sequence)).toEqual(evs.map((e) => e.sequence)); // sequence order, deduped
    const members = reduceCouncil(state!.events as CouncilEvent[]);
    expect(members.archivist.status).toBe("completed");
    expect(members.scout.status).toBe("failed");
    expect(members.courier.status).toBe("completed");
    expect(decorationsFrom(state!.events as CouncilEvent[])).toEqual([pottery]);
  });

  it("never duplicates a charm and resolves placement collisions", async () => {
    const { t, post } = await setup();
    const run = "run_demo000001";
    await post("/council/events", event(run, "muse", "completed", { result: { decorations: [pottery] } }));
    // Reconnect / re-run of the same memory: new event id, same memory.
    await post("/council/events", event(run, "muse", "completed", { result: { decorations: [{ ...pottery, label: "Pottery!" }] } }));
    // A different memory asking for the same slot gets the next free one.
    await post("/council/events", event(run, "muse", "completed", { result: { decorations: [{ ...pottery, memoryId: "mem_reading01", assetId: "book_charm", color: "plum", label: "Reading" }] } }));
    // A second run for the same demo key keeps (and reconstructs) earlier charms.
    await post("/council/runs", { runId: "run_demo000002", source: "web", demoKey: "demo_key0001" });
    const state = await t.query(api.council.demoState, { demoKey: "demo_key0001" });
    expect(state?.run?.runId).toBe("run_demo000002");
    expect(state?.decorations).toEqual([
      pottery,
      { memoryId: "mem_reading01", jar: "wish", assetId: "book_charm", color: "plum", placement: "top_knot", label: "Reading" },
    ]);
  });

  it("does not let a late event reopen a finished run", async () => {
    const { t, post } = await setup();
    const run = "run_demo000001";
    await post("/council/events", event(run, "courier", "failed", { result: { error: "Run failed" } }));
    await post("/council/events", event(run, "courier", "started"));
    const state = await t.query(api.council.demoState, { demoKey: "demo_key0001" });
    expect(state?.run?.status).toBe("failed");
  });

  it("researches through the existing provider, normaliser and ranker", async () => {
    vi.stubEnv("APIFY_TOKEN", "apify-test-token");
    const page = {
      search_parameters: { gl: "us" },
      shopping_results: [
        { title: "Handmade Stoneware Pottery Mug", product_link: "https://shop.example.com/mug", price: "$34.00", extracted_price: 34, source: "Etsy" },
        { title: "Pottery Starter Kit for Beginners", product_link: "https://shop.example.com/kit", price: "$29.99", extracted_price: 29.99, source: "Amazon" },
        { title: "Pottery Wheel Class Voucher", product_link: "https://shop.example.com/class", price: "$10–$90" },
      ],
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: { id: "run1", status: "RUNNING", defaultDatasetId: "ds1" } }))
      .mockResolvedValueOnce(Response.json({ data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" } }))
      .mockResolvedValueOnce(Response.json([page]));
    vi.stubGlobal("fetch", fetcher);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { post } = await setup();
    const pending = post("/council/research", { queryTerms: ["pottery class"], mustExclude: ["starter kit"], budgetMinor: 8000 });
    await vi.advanceTimersByTimeAsync(3500);
    const res = await pending;
    vi.useRealTimers();
    const body = await res.json();
    expect(res.status).toBe(200);
    const titles = body.listings.map((l: { title: string }) => l.title);
    expect(titles).not.toContain("Pottery Starter Kit for Beginners"); // owned → filtered by the real ranker
    const voucher = body.listings.find((l: { title: string }) => l.title.includes("Voucher"));
    expect(voucher).toMatchObject({ price_status: "unknown", price_minor: null }); // ranges are never prices
    const mug = body.listings.find((l: { title: string }) => l.title.includes("Mug"));
    expect(mug).toMatchObject({ source_url: "https://shop.example.com/mug", price_minor: 3400, price_status: "observed" });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("google-shopping");
  });
});
