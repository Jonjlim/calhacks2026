/** Public style discovery only. Node 22.18+, local .env.local, no Convex calls. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const ACTOR = "clockworks~tiktok-scraper";
const BUILD = "0.0.620";
const ALTERNATE_ACTOR = "xmolodtsov~tiktok-search-scraper";
const ALTERNATE_BUILD = "0.1.39";
type Row = Record<string, unknown>;
const record = (value: unknown): Row | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;

async function main() {
  const args = process.argv.slice(2);
  const alternate = args.includes("--alternate");
  if (alternate) args.splice(args.indexOf("--alternate"), 1);
  const resume = args[0] === "--resume";
  if (resume && !args[1]) throw new Error("Expected report directory.");
  const query = resume ? undefined : args.join(" ").trim() || "vintage denim outfit";
  if (query && (query.length > 100 || query.startsWith("--"))) throw new Error("Use one public style phrase.");
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error("Missing APIFY_TOKEN in ignored .env.local.");
  const directory = resume ? resolve(args[1]!) : resolve("work/research-spike", "tiktok-" + new Date().toISOString().replaceAll(":", "-"));
  await mkdir(directory, { recursive: true });
  const startedAt = Date.now();
  const report: Row = resume ? JSON.parse(await readFile(resolve(directory, "report.json"), "utf8")) as Row : {
    actor: alternate ? ALTERNATE_ACTOR : ACTOR, build: alternate ? ALTERNATE_BUILD : BUILD, query, status: "pending", startedAt,
    windowStart: startedAt - 30 * 86400000, windowEnd: startedAt,
    region: "unknown", requestedPostLimit: 20, maxTotalChargeUsd: 0.50,
  };
  if (resume && (![ACTOR, ALTERNATE_ACTOR].includes(String(report.actor)) || typeof report.runId !== "string" || !/^[a-zA-Z0-9]+$/.test(report.runId))) throw new Error("Invalid resume report.");
  const save = () => writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await save();
  const request = async (path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch("https://api.apify.com/v2/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error("Apify HTTP " + response.status);
    return response.json();
  };
  const terminal = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
  try {
    const input = report.actor === ALTERNATE_ACTOR ? {
      keywords: [query], maxItems: 20, maxItemsPerKeyword: 20, sortType: "DATE_POSTED",
      uniqueAuthors: true, expansion: [], commentsPerPost: 0, includeAuthorProfile: false,
    } : { searchQueries: [query], searchSection: "/video", resultsPerPage: 20,
      videoSearchDateFilter: "PAST_MONTH", videoSearchSorting: "MOST_RELEVANT",
      scrapeRelatedVideos: false, scrapeAdditionalAuthorMeta: false, scrapeRelatedSearchWords: false,
      shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSlideshowImages: false,
      shouldDownloadSubtitles: false, shouldDownloadAvatars: false, shouldDownloadMusicCovers: false,
    };
    let run = record(record(await request(resume ? "actor-runs/" + report.runId
      : "acts/" + report.actor + "/runs?build=" + report.build + "&timeout=180&memory=1024&maxTotalChargeUsd=0.50", resume ? undefined : input))?.data);
    if (typeof run?.id !== "string") throw new Error("Missing run ID; inspect Console before another start.");
    report.runId = run.id;
    report.status = run.status;
    report.consoleUrl = "https://console.apify.com/actors/runs/" + run.id;
    await save();
    console.log("Run:", report.consoleUrl);
    const deadline = Date.now() + 200000;
    while (!terminal.has(String(run?.status)) && Date.now() < deadline) {
      await delay(5000);
      run = record(record(await request("actor-runs/" + report.runId))?.data);
      if (typeof run?.status !== "string") throw new Error("Missing status.");
      report.status = run.status;
      await save();
    }
    report.status = run?.status;
    report.elapsedMs = Date.now() - Number(report.startedAt);
    report.usageTotalUsd = run?.usageTotalUsd;
    report.buildId = run?.buildId;
    report.chargedEventCounts = run?.chargedEventCounts;
    if (run?.status !== "SUCCEEDED" || typeof run.defaultDatasetId !== "string") throw new Error("No successful dataset; inspect saved run.");
    const raw = await request("datasets/" + run.defaultDatasetId + "/items?clean=true&limit=20");
    if (!Array.isArray(raw)) throw new Error("Invalid dataset.");
    await writeFile(resolve(directory, "raw.json"), JSON.stringify(raw, null, 2) + "\n");
    report.status = "succeeded";
    report.datasetId = run.defaultDatasetId;
    report.retrievedAt = Date.now();
    report.rowCount = raw.length;
    await save();
    // Do not dump creator profiles or captions into the terminal.
    console.log(JSON.stringify({ status: report.status, rowCount: report.rowCount, elapsedMs: report.elapsedMs, reportedUsageUsd: report.usageTotalUsd, firstRowFields: Object.keys(record(raw[0]) ?? {}) }, null, 2));
    console.log("Saved:", directory);
  } catch (error) {
    if (!terminal.has(String(report.status)) && report.status !== "succeeded") report.status = "uncertain";
    await save();
    console.error("Report saved:", directory);
    throw error;
  }
}

main().catch(() => {
  console.error("TikTok spike failed. Inspect the saved report/Console; resume the same run instead of repeating a paid start.");
  process.exitCode = 1;
});
