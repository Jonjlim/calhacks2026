/** Local Google Maps places spike (Dev 4). No Convex writes; never automatically retries a paid start. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const PLACES_ACTOR = "compass~crawler-google-places";
export const PLACES_BUILD = "latest"; // No public build number on the actor pages; the run reports buildId below.
export const PLACES_LOCATION = "San Francisco, CA, USA";
export const PLACES_LANGUAGE = "en";
export const PLACES_MAX_PER_SEARCH = 10;
// The platform rejected maxTotalChargeUsd=0.10 with error "max-total-charge-usd-below-minimum"
// ("Maximum cost per run is less than the allowed minimum of $0.50"), so $0.50 is the smallest
// enforceable abort ceiling for this Actor. Expected spend stays about $0.04 either way:
// at most 10 scraped places (Free-plan rate $4.00/1,000) with every paid add-on disabled below.
export const PLACES_CHARGE_CAP_USD = 0.50;

type Row = Record<string, unknown>;

function record(value: unknown): Row | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" && value.trim() !== "" ? value : "unknown";
}

function numberText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "unknown";
}

export type NormalizedPlace = {
  title: string;
  category: string;
  address: string;
  rating: string;
  reviewsCount: string;
  priceLevel: string;
  website: string;
  googleMapsUrl: string;
  placeId: string;
  permanentlyClosed: boolean;
  temporarilyClosed: boolean;
  retrievedAt: string;
  runId: string;
};

/** Keep only public business fields; anything missing becomes "unknown", never guessed. */
export function normalizePlace(row: Row, retrievedAt: string, runId: string): NormalizedPlace {
  return {
    title: text(row.title),
    category: text(row.categoryName),
    address: text(row.address),
    rating: numberText(row.totalScore),
    reviewsCount: numberText(row.reviewsCount),
    priceLevel: text(row.price),
    website: text(row.website),
    googleMapsUrl: text(row.url),
    placeId: text(row.placeId),
    permanentlyClosed: row.permanentlyClosed === true,
    temporarilyClosed: row.temporarilyClosed === true,
    retrievedAt,
    runId,
  };
}

/** Minimal public search: one term, one organizer-typed city, no personal or paid add-ons. */
export function buildInput(searchTerm: string) {
  return {
    searchStringsArray: [searchTerm],
    locationQuery: PLACES_LOCATION,
    maxCrawledPlacesPerSearch: PLACES_MAX_PER_SEARCH,
    language: PLACES_LANGUAGE,
    skipClosedPlaces: false, // Closed places are filtered locally so the "filter applied" add-on is never charged.
    scrapePlaceDetailPage: false,
    maxReviews: 0,
    scrapeReviewsPersonalData: false,
    maxImages: 0,
    scrapeImageAuthors: false,
    scrapeContacts: false,
    maximumLeadsEnrichmentRecords: 0,
    verifyLeadsEnrichmentEmails: false,
    scrapeSocialMediaProfiles: { facebooks: false, instagrams: false, youtubes: false, tiktoks: false, twitters: false },
    includeWebResults: false,
    scrapeDirectories: false,
    scrapeTableReservationProvider: false,
    scrapeOrderOnline: false,
    maxQuestions: 0,
    enableCompetitorAnalysis: false,
    maxCompetitorsToAnalyze: 0,
  };
}

export async function main() {
  const args = process.argv.slice(2);
  const resumeIndex = args.indexOf("--resume");
  const resumeDir = resumeIndex >= 0 ? args[resumeIndex + 1] : undefined;
  if (resumeIndex >= 0) {
    if (!resumeDir) throw new Error("--resume requires a saved report directory.");
    args.splice(resumeIndex, 2);
  }
  const positionalTerm = args.join(" ").trim();
  const searchTerm = positionalTerm || "pottery studio";
  if (searchTerm.length > 100 || searchTerm.startsWith("--")) throw new Error("Use one public activity phrase under 100 characters.");
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error("Missing APIFY_TOKEN in ignored .env.local.");
  const outputDir = resumeDir ? resolve(resumeDir) : resolve("work/research-spike", "places-" + new Date().toISOString().replaceAll(":", "-"));
  await mkdir(outputDir, { recursive: true });
  const report: Row = resumeDir
    ? JSON.parse(await readFile(resolve(outputDir, "report.json"), "utf8")) as Row
    : {
        actor: PLACES_ACTOR,
        build: PLACES_BUILD,
        searchTerm,
        location: PLACES_LOCATION,
        language: PLACES_LANGUAGE,
        maxCrawledPlacesPerSearch: PLACES_MAX_PER_SEARCH,
        input: buildInput(searchTerm),
        startedAt: Date.now(),
        status: "pending",
        maxTotalChargeUsd: PLACES_CHARGE_CAP_USD,
      };
  if (String(report.actor) !== PLACES_ACTOR) throw new Error("Report is for a different actor; start a fresh spike run instead.");
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
    if (typeof report.runId === "string" && /^[a-zA-Z0-9]+$/.test(report.runId)) {
      run = record(record((await request("actor-runs/" + report.runId)).payload)?.data);
    } else if (resumeDir) {
      throw new Error("Saved report has no valid run ID; inspect the Apify Console before starting anything new.");
    } else {
      // Single paid POST. If its response is lost, do not start another run blindly.
      const started = await request(
        "acts/" + PLACES_ACTOR + "/runs?build=" + PLACES_BUILD + "&timeout=180&memory=1024&maxTotalChargeUsd=" + PLACES_CHARGE_CAP_USD,
        report.input,
      );
      run = record(record(started.payload)?.data);
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
    report.buildNumber = run?.buildNumber;
    report.usageTotalUsd = run?.usageTotalUsd; // Run-reported usage only; not a settled invoice.
    report.usage = record(run?.usage);
    report.payPerEventUsage = record(run?.payPerEventUsage);
    report.status = run?.status;
    if (run?.status !== "SUCCEEDED") throw new Error("Actor did not succeed; resume or inspect Console before a new run.");
    if (typeof run.defaultDatasetId !== "string") throw new Error("Missing dataset ID.");
    const raw = (await request("datasets/" + run.defaultDatasetId + "/items?clean=true&limit=50")).payload;
    if (!Array.isArray(raw)) throw new Error("Dataset is not an array.");
    await writeFile(resolve(outputDir, "raw.json"), JSON.stringify(raw, null, 2) + "\n");
    report.datasetId = run.defaultDatasetId;
    const retrievedAt = new Date().toISOString();
    report.retrievedAt = retrievedAt;
    report.status = "succeeded";
    const rows = raw.map(record).filter((row): row is Row => row !== undefined);
    const places = rows.map(row => normalizePlace(row, retrievedAt, String(report.runId)));
    const usable = places.filter(place => !place.permanentlyClosed && !place.temporarilyClosed);
    await writeFile(resolve(outputDir, "places.json"), JSON.stringify(places, null, 2) + "\n");
    await writeFile(resolve(outputDir, "usable.json"), JSON.stringify(usable, null, 2) + "\n");
    const fieldNames = ["title", "category", "address", "rating", "reviewsCount", "priceLevel", "website", "googleMapsUrl", "placeId"] as const;
    report.inspection = {
      returnedCount: raw.length,
      normalizedCount: places.length,
      usableCount: usable.length,
      closedCount: places.length - usable.length,
      unknownFieldCounts: Object.fromEntries(fieldNames.map(name => [name, places.filter(place => place[name] === "unknown").length])),
      examples: usable.slice(0, 5).map(place => ({ title: place.title, category: place.category, rating: place.rating, priceLevel: place.priceLevel })),
      verdict: usable.length ? "candidate_pass_needs_relevance_review" : "no_usable_place",
    };
    await save();
    console.log(JSON.stringify({ status: report.status, elapsedMs: report.elapsedMs, usageTotalUsd: report.usageTotalUsd, inspection: report.inspection }, null, 2));
    console.log("Saved:", outputDir);
    if (!usable.length) process.exitCode = 1;
  } catch (error) {
    if (!terminal.has(String(report.status)) && report.status !== "succeeded") report.status = "uncertain";
    await save();
    console.error("Report saved:", outputDir);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error && error.message.startsWith("Apify HTTP") ? error.message : "Places spike failed; inspect the saved report and resume instead of repeating a paid start.");
    process.exitCode = 1;
  });
}
