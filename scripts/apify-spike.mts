/**
 * RC-002: standalone source feasibility check, not the production Convex adapter.
 * Node 22.18+; no installed dependencies required.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const ACTOR = "johnvc~google-shopping-api-google-shopping-products-prices-deals";

type Row = Record<string, unknown>;
function record(value: unknown): Row | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Row : undefined;
}
function httpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

/** Diagnostics only. Actual currency/availability normalization belongs to RC-003. */
export function inspectDataset(payload: unknown) {
  if (!Array.isArray(payload)) throw new Error("Dataset response is not an array.");
  const products = payload.flatMap((page: unknown) => {
    const rows = record(page)?.shopping_results;
    return Array.isArray(rows) ? rows : [];
  }).map(record).filter((row): row is Row => !!row);
  const linked = products.filter(row =>
    typeof row.title === "string" && row.title.trim() && httpUrl(row.product_link));
  const priced = linked.filter(row => typeof row.extracted_price === "number"
    && Number.isFinite(row.extracted_price) && row.extracted_price >= 0);
  return {
    pageCount: payload.length,
    productCount: products.length,
    linkedProductCount: linked.length,
    pricedProductCount: priced.length,
    imageCount: linked.filter(row => httpUrl(row.thumbnail)).length,
    verdict: priced.length > 0 ? "candidate_pass_needs_link_and_currency_review" : "fail",
    sample: linked.slice(0, 5).map(row => ({
      title: row.title, price: row.price ?? null,
      extractedPrice: row.extracted_price ?? null,
      sourceUrl: row.product_link, seller: row.source ?? null,
      imageUrl: row.thumbnail ?? null,
    })),
  };
}

export async function main() {
  const query = process.argv.slice(2).join(" ").trim() || "pottery tools";
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error("Missing APIFY_TOKEN. Add it to ignored .env.local, then rerun.");
  if (query.length > 200) throw new Error("Keep the public product query under 200 characters.");
  const started = Date.now();
  const outputDir = resolve("work/research-spike", new Date().toISOString().replaceAll(":", "-"));
  await mkdir(outputDir, { recursive: true });
  const report: Row = {
    actor: ACTOR, query, startedAt: new Date(started).toISOString(),
    status: "pending", maxTotalChargeUsd: 0.20,
  };
  const save = async () => writeFile(resolve(outputDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n");
  await save(); // Persist before any external request.
  const request = async (path: string, method = "GET", body?: unknown): Promise<unknown> => {
    const response = await fetch("https://api.apify.com/v2/" + path, {
      method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    // Never print provider error bodies, headers, or the token.
    if (!response.ok) throw new Error("Apify HTTP " + response.status + ". Check account credits, Actor access, and token permissions.");
    return response.json();
  };
  try {
    // No automatic retries on POST: a timeout may still have started a paid run.
    let run = record(record(await request(
      "acts/" + ACTOR + "/runs?timeout=120&maxTotalChargeUsd=0.20",
      "POST", { q: query, gl: "us", hl: "en", max_pages: 1 },
    ))?.data);
    if (typeof run?.id !== "string") throw new Error("Start response missing run ID.");
    report.runId = run.id;
    report.consoleUrl = "https://console.apify.com/actors/runs/" + run.id;
    report.status = run.status;
    await save();
    console.log("Run:", report.consoleUrl);
    const terminal = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
    while (!terminal.has(String(run?.status)) && Date.now() - started < 150_000) {
      await delay(5_000);
      run = record(record(await request("actor-runs/" + report.runId))?.data);
      if (!run || typeof run.status !== "string") throw new Error("Invalid run status response.");
      report.status = run.status;
      await save();
      console.log("Status:", run.status);
    }
    report.elapsedMs = Date.now() - started;
    report.buildId = run?.buildId;
    report.buildNumber = run?.buildNumber;
    report.usageTotalUsd = run?.usageTotalUsd;
    if (run?.status !== "SUCCEEDED") {
      if (!terminal.has(String(run?.status))) report.status = "uncertain";
      await save();
      throw new Error("No successful result. Inspect the saved run before starting another.");
    }
    if (typeof run.defaultDatasetId !== "string") throw new Error("Missing result dataset.");
    const raw = await request("datasets/" + run.defaultDatasetId + "/items?clean=true&limit=50");
    await writeFile(resolve(outputDir, "raw.json"), JSON.stringify(raw, null, 2) + "\n");
    report.datasetId = run.defaultDatasetId;
    report.retrievedAt = Date.now();
    report.inspection = inspectDataset(raw);
    report.status = "succeeded";
    await save();
    console.log(JSON.stringify(report.inspection, null, 2));
    console.log("Saved:", outputDir);
    console.log("Open sample links and confirm USD prices before accepting the source.");
    if ((report.inspection as ReturnType<typeof inspectDataset>).verdict === "fail") process.exitCode = 1;
  } catch (error) {
    if (!["FAILED", "ABORTED", "TIMED-OUT", "succeeded"].includes(String(report.status))) {
      report.status = "uncertain";
    }
    report.elapsedMs = Date.now() - started;
    await save();
    console.error("Report saved:", outputDir);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Avoid dumping network exceptions, which may contain request details.
    console.error(error instanceof Error && !["TypeError", "TimeoutError", "AbortError"].includes(error.name)
      ? error.message : "Network request failed or timed out; inspect saved run before retrying.");
    process.exitCode = 1;
  });
}
