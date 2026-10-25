/** Opt-in: ONE paid synthetic search, capped by the production adapter at $0.40. No Convex/LLM/payment calls. */
import { it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createProvider, VERIFIED_ACTOR } from "./provider";
import { normalizeDataset, providerNotice } from "./normalize";

it.skipIf(process.env.UNWRAP_LIVE_SHOPPING_ACTOR !== "1")("LIVE current shopping actor → actual normalized listings (one paid run)", async () => {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN must be configured privately.");
  const folder = resolve("work/research-spike/shopping-actor-verification");
  await mkdir(folder, { recursive: true });
  const report: Record<string, unknown> = { actor: VERIFIED_ACTOR, query: "hiking backpack", maximumChargeUsd: 0.40,
    startedAt: new Date().toISOString(), status: "pending", paidStartRequests: 0 };
  const save = () => writeFile(resolve(folder, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await save();
  const provider = createProvider(token);
  report.paidStartRequests = 1;
  await save();
  const started = await provider.start({ roomId: "synthetic-actor-check", knowledgeRevision: 0,
    queryTerms: ["hiking backpack"], mustExclude: [], budgetMinor: 8000, listingLimit: 12 });
  if (started.kind !== "ok") {
    Object.assign(report, { status: started.kind, message: started.message }); await save();
    throw new Error(started.message + " No POST retry was attempted.");
  }
  let run = started.value;
  report.runId = run.id; await save();
  const deadline = Date.now() + 150000;
  while (["READY", "RUNNING"].includes(run.status) && Date.now() < deadline) {
    await delay(3000);
    const polled = await provider.getRun(run.id);
    if (polled.kind !== "ok") {
      Object.assign(report, { status: polled.kind, message: polled.message }); await save();
      throw new Error(polled.message + " Resume this run rather than starting another.");
    }
    run = polled.value;
  }
  report.providerStatus = run.status; report.datasetId = run.defaultDatasetId;
  if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
    report.status = ["READY", "RUNNING"].includes(run.status) ? "uncertain" : "failed"; await save();
    throw new Error("The existing run ended or paused at " + run.status + "; no new run was started.");
  }
  const dataset = await provider.getDataset(run.defaultDatasetId);
  if (dataset.kind !== "ok") { Object.assign(report, { status: dataset.kind, message: dataset.message }); await save(); throw new Error(dataset.message); }
  const retrievedAt = Date.now();
  await writeFile(resolve(folder, "raw.json"), JSON.stringify({ actor: VERIFIED_ACTOR, runId: run.id, retrievedAt, raw: dataset.value }, null, 2) + "\n");
  const normalized = normalizeDataset(dataset.value, retrievedAt);
  Object.assign(report, { status: normalized.length ? "succeeded" : "failed", retrievedAt, rawCount: Array.isArray(dataset.value) ? dataset.value.length : 0,
    rawKeys: Array.isArray(dataset.value) && dataset.value[0] && typeof dataset.value[0] === "object" ? Object.keys(dataset.value[0]) : [],
    normalizedCount: normalized.length, observedPrices: normalized.filter(l => l.priceStatus === "observed").length,
    images: normalized.filter(l => l.imageUrl).length, notice: providerNotice(dataset.value) });
  await save();
  expect(normalized.length, "See ignored report/raw.json for actual fields; do not start another paid run.").toBeGreaterThan(0);
  expect(normalized.some(l => l.priceStatus === "observed")).toBe(true);
}, 190000);
