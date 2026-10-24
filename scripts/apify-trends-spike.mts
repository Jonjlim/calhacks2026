/** Local RC-014 experiment. No Convex writes; never automatically retries a paid start. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { discoverShoppingQueries, normalizeTrendDataset } from "../lib/research/trends.ts";

export const TREND_ACTOR = "apify~google-trends-scraper";
export const TREND_BUILD = "0.0.141";
export const ALTERNATE_ACTOR = "agenscrape~google-trends-scraper";
export const ALTERNATE_BUILD = "1.0.21";
type Row = Record<string, unknown>;
function record(value: unknown): Row | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
}

export async function main() {
  const args = process.argv.slice(2);
  const alternate = args.includes("--alternate");
  if (alternate) args.splice(args.indexOf("--alternate"), 1);
  const resumeIndex = args.indexOf("--resume");
  const resumeDir = resumeIndex >= 0 ? args[resumeIndex + 1] : undefined;
  if (resumeIndex >= 0 && !resumeDir) throw new Error("--resume requires a saved report directory.");
  const query = resumeDir ? undefined : args.join(" ").trim() || "pottery";
  if (query && (query.length > 100 || query.startsWith("--"))) throw new Error("Use one public category phrase under 100 characters.");
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error("Missing APIFY_TOKEN in ignored .env.local.");
  const outputDir = resumeDir ? resolve(resumeDir) : resolve("work/research-spike", "trends-" + new Date().toISOString().replaceAll(":", "-"));
  await mkdir(outputDir, { recursive: true });
  const report: Row = resumeDir ? JSON.parse(await readFile(resolve(outputDir, "report.json"), "utf8")) as Row : {
    actor: alternate ? ALTERNATE_ACTOR : TREND_ACTOR, build: alternate ? ALTERNATE_BUILD : TREND_BUILD, query, geo: "US", timeRange: "today 3-m",
    startedAt: Date.now(), status: "pending", maxTotalChargeUsd: 0.20,
  };
  if (resumeDir && (![TREND_ACTOR, ALTERNATE_ACTOR].includes(String(report.actor)) || typeof report.runId !== "string" || !/^[a-zA-Z0-9]+$/.test(report.runId))) {
    throw new Error("Resume report needs this actor and a valid run ID; inspect Console if start was uncertain.");
  }
  const save = () => writeFile(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await save();
  const request = async (path: string, body?: unknown): Promise<Row> => {
    const response = await fetch("https://api.apify.com/v2/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error("Apify HTTP " + response.status + "; inspect saved report/Console.");
    return { payload: await response.json() as unknown };
  };
  const terminal = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
  try {
    let run: Row | undefined;
    if (resumeDir) {
      run = record(record((await request("actor-runs/" + report.runId)).payload)?.data);
    } else {
      // Single paid POST. If its response is lost, do not start another run blindly.
      const input = report.actor === ALTERNATE_ACTOR ? {
        keywords: [query], geo: report.geo, timeRange: report.timeRange, category: 0,
        includeRelatedSearches: true, includeRelatedTopics: false, useBrowserForTopics: false,
        includeGeoData: false, includeInterestOverTime: false,
      } : {
        searchTerms: [query], geo: report.geo, timeRange: report.timeRange,
        isMultiple: false, skipDebugScreen: true,
      };
      run = record(record((await request("acts/" + report.actor + "/runs?build=" + report.build + "&timeout=180&memory=1024&maxTotalChargeUsd=0.20", input)).payload)?.data);
    }
    if (typeof run?.id !== "string") throw new Error("Missing run ID. Inspect Console before retrying.");
    report.runId = run.id;
    report.consoleUrl = "https://console.apify.com/actors/runs/" + run.id;
    report.status = run.status;
    await save();
    console.log("Run:", report.consoleUrl);
    const deadline = Date.now() + 200_000;
    while (!terminal.has(String(run?.status)) && Date.now() < deadline) {
      await delay(5_000);
      run = record(record((await request("actor-runs/" + report.runId)).payload)?.data);
      if (typeof run?.status !== "string") throw new Error("Missing run status.");
      report.status = run.status;
      await save();
    }
    report.elapsedMs = Date.now() - Number(report.startedAt);
    report.buildId = run?.buildId;
    report.usageTotalUsd = run?.usageTotalUsd;
    report.status = run?.status;
    if (run?.status !== "SUCCEEDED") throw new Error("Actor did not succeed; resume or inspect Console before a new run.");
    if (typeof run.defaultDatasetId !== "string") throw new Error("Missing dataset ID.");
    const raw = (await request("datasets/" + run.defaultDatasetId + "/items?clean=true&limit=10")).payload;
    if (!Array.isArray(raw)) throw new Error("Dataset is not an array.");
    await writeFile(resolve(outputDir, "raw.json"), JSON.stringify(raw, null, 2) + "\n");
    report.datasetId = run.defaultDatasetId;
    report.retrievedAt = Date.now();
    report.status = "succeeded";
    const observations = normalizeTrendDataset(raw, {
      seedTerm: String(report.query), geo: "US", timeRange: "today 3-m", retrievedAt: Number(report.retrievedAt),
    });
    const discoveries = discoverShoppingQueries(observations);
    await writeFile(resolve(outputDir, "observations.json"), JSON.stringify(observations, null, 2) + "\n");
    await writeFile(resolve(outputDir, "discoveries.json"), JSON.stringify(discoveries, null, 2) + "\n");
    report.inspection = {
      observationCount: observations.length, discoveryCount: discoveries.length,
      verdict: observations.length && discoveries.length ? "candidate_pass_needs_relevance_review" : "no_usable_discovery",
      discoveries,
    };
    await save();
    console.log(JSON.stringify({ status: report.status, elapsedMs: report.elapsedMs, inspection: report.inspection }, null, 2));
    console.log("Saved:", outputDir);
    if (!observations.length || !discoveries.length) process.exitCode = 1;
  } catch (error) {
    if (!terminal.has(String(report.status)) && report.status !== "succeeded") report.status = "uncertain";
    await save();
    console.error("Report saved:", outputDir);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error && error.message.startsWith("Apify HTTP") ? error.message : "Trend spike failed; inspect the saved report and resume instead of repeating a paid start.");
    process.exitCode = 1;
  });
}
