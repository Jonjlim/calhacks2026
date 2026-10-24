/** Local studio-price spike (Dev 4). Reads public studio websites from a places spike; no Convex writes; never retries a paid start. */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const CRAWL_ACTOR = "apify~website-content-crawler";
// No "latest" tag exists for this Actor; the default build is used and the run's buildNumber is recorded.
export const CRAWL_BUILD = "default";
// Pay-per-usage Actor: spend is bounded by timeout x memory (1 GB x 180 s = 0.05 compute units).
// The raw HTTP crawler is used deliberately: a browser crawl read 8 pages in 300 s on this set.
export const CRAWL_TIMEOUT_SECS = 180;
export const CRAWL_MEMORY_MB = 1024;
export const CRAWL_MAX_PAGES = 120;

type Row = Record<string, unknown>;
const record = (value: unknown): Row | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined;

export type OfferKind = "class" | "private_event" | "membership" | "gift_card";
export interface PriceOffer { amountMinor: number; currency: "USD"; kind: OfferKind; snippet: string; sourceUrl: string }
export interface StudioPrices {
  studio: string; website: string; googleMapsUrl: string; pagesRead: number;
  status: "priced" | "no_price_found" | "not_crawled"; fromPriceMinor?: number; offers: PriceOffer[]; retrievedAt: string;
}

const PRICE = /\$\s?(\d{1,4}(?:,\d{3})?)(?:\.(\d{2}))?(?!\d)/g;
const OFFER_WORDS = /\b(class(?:es)?|workshops?|lessons?|sessions?|courses?|wheel|throwing|hand[\s-]?building|date night|intro(?:duction)?|beginners?|private|part(?:y|ies)|team|group|gift cards?|gift certificates?|members?hip|monthly)\b/i;
// Amounts that are fees or supplies, not something a friend group would gift.
const NOT_AN_OFFER = /\b(shipping|tax(?:es)?|deposit|per (?:pound|lb|bag)|clay bag|bag of clay|glaze fee|firing fee|kiln|late fee|cancell?ation|refund\w*|processing|administration|free of charge|scholarships?|residency|valued? at)\b/i;

function kindOf(window: string, sourceUrl: string): OfferKind {
  if (/\bgift (?:cards?|certificates?)\b/i.test(window)) return "gift_card";
  if (/\b(members?hip|monthly|\/\s?mo(?:nth)?)\b/i.test(window)) return "membership";
  if (/\b(private|part(?:y|ies)|team|corporate|group)\b/i.test(window) || /(group|corporate|team|private|part(?:y|ies))[-_]?events?|parties/i.test(sourceUrl)) return "private_event";
  return "class";
}

/** Literal dollar amounts near offer words only. Never infers a price that is not on the page. */
export function extractOffers(text: string, sourceUrl: string): PriceOffer[] {
  const flat = text.replace(/[ \t\r]+/g, " ");
  const offers: PriceOffer[] = [];
  for (const match of flat.matchAll(PRICE)) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    // Context is the price's own sentence or line, so neighbouring offers and fees do not bleed in.
    const before = flat.slice(Math.max(0, index - 120), index);
    const cut = Math.max(...[...before.matchAll(/[.!?•](?=\s|$)|\n/g)].map(m => (m.index ?? -1) + 1), 0);
    const after = flat.slice(end, end + 60);
    const stop = after.search(/[.!?•|](?=\s|$)|\n/);
    const window = (before.slice(cut) + match[0] + (stop >= 0 ? after.slice(0, stop) : after)).trim();
    if (!OFFER_WORDS.test(window) || NOT_AN_OFFER.test(window)) continue;
    const dollars = Number(match[1]!.replace(/,/g, ""));
    const amountMinor = dollars * 100 + Number(match[2] ?? 0);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1000 || amountMinor > 100000) continue;
    offers.push({ amountMinor, currency: "USD", kind: kindOf(window, sourceUrl), snippet: window.trim().slice(0, 180), sourceUrl });
  }
  const seen = new Set<string>();
  return offers.filter(o => { const k = `${o.amountMinor}:${o.kind}:${o.sourceUrl}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

export async function main() {
  const args = process.argv.slice(2);
  const resumeIndex = args.indexOf("--resume");
  const resumeDir = resumeIndex >= 0 ? args[resumeIndex + 1] : undefined;
  const placesDir = resumeDir ? undefined : args[0];
  if (!resumeDir && !placesDir) throw new Error("Usage: apify-studio-prices-spike.mts <places spike dir> | --resume <dir>");
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error("Missing APIFY_TOKEN in ignored .env.local.");
  const outputDir = resumeDir ? resolve(resumeDir) : resolve("work/research-spike", "studio-prices-" + new Date().toISOString().replaceAll(":", "-"));
  await mkdir(outputDir, { recursive: true });
  let report: Row;
  if (resumeDir) report = JSON.parse(await readFile(resolve(outputDir, "report.json"), "utf8")) as Row;
  else {
    const places = JSON.parse(await readFile(resolve(placesDir!, "usable.json"), "utf8")) as Row[];
    const studios: Row[] = [];
    for (const p of places) {
      const website = String(p.website ?? "");
      if (!/^https?:\/\//.test(website) || studios.some(s => host(String(s.website)) === host(website))) continue;
      // Crawl from the site root so every studio page is in scope at depth 1.
      const root = new URL(website); root.pathname = "/"; root.search = ""; root.hash = "";
      studios.push({ studio: p.title, website: root.href, googleMapsUrl: p.googleMapsUrl });
    }
    report = {
      actor: CRAWL_ACTOR, build: CRAWL_BUILD, placesDir: resolve(placesDir!), studios, startedAt: Date.now(), status: "pending",
      input: {
        startUrls: studios.map(s => ({ url: s.website })), crawlerType: "cheerio", maxCrawlDepth: 1, maxCrawlPages: CRAWL_MAX_PAGES,
        // Pages that never carry giftable prices; keeps large sites from using the whole page budget.
        excludeUrlGlobs: ["**/blog/**", "**/cart**", "**/account**", "**/login**", "**/*.{jpg,jpeg,png,gif,pdf,mp4}",
          "**/careers**", "**/instructors**", "**/tutorials**", "**/about**", "**/kids**", "**/youth**", "**/*scholarship*",
          "**/*residency*", "**/emptybowls**", "**/*woodshop*", "**/waitlist**", "**/faq**", "**/rules**", "**/*polic*",
          "**/copy-of-*", "**/contact**", "**/press**", "**/*student-resources*"].map(glob => ({ glob })),
        respectRobotsTxtFile: true, saveMarkdown: false, saveHtml: false, saveFiles: false, saveScreenshots: false,
        removeCookieWarnings: true, maxConcurrency: 10, proxyConfiguration: { useApifyProxy: true },
      },
    };
  }
  const save = () => writeFile(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await save();
  const request = async (path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch("https://api.apify.com/v2/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const detail = record(record(await response.json().catch(() => null))?.error);
      throw new Error("Apify HTTP " + response.status + (detail ? ` (${String(detail.type)}: ${String(detail.message).slice(0, 200)})` : "") + "; inspect saved report/Console.");
    }
    return response.json() as Promise<unknown>;
  };
  const terminal = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
  try {
    let run: Row | undefined;
    if (typeof report.runId === "string" && /^[a-zA-Z0-9]+$/.test(report.runId)) run = record(record(await request("actor-runs/" + report.runId))?.data);
    else if (resumeDir) throw new Error("Saved report has no valid run ID; inspect the Apify Console before starting anything new.");
    // Single paid POST. If its response is lost, do not start another run blindly.
    else run = record(record(await request(`acts/${CRAWL_ACTOR}/runs?timeout=${CRAWL_TIMEOUT_SECS}&memory=${CRAWL_MEMORY_MB}`, report.input))?.data);
    if (typeof run?.id !== "string") throw new Error("Missing run ID. Inspect Console before retrying.");
    report.runId = run.id; report.consoleUrl = "https://console.apify.com/actors/runs/" + run.id; report.status = run.status;
    await save();
    console.log("Run:", report.consoleUrl);
    const deadline = Date.now() + (CRAWL_TIMEOUT_SECS + 40) * 1000;
    while (!terminal.has(String(run?.status)) && Date.now() < deadline) {
      await delay(5_000);
      run = record(record(await request("actor-runs/" + report.runId))?.data);
      report.status = run?.status; await save();
    }
    report.elapsedMs = Date.now() - Number(report.startedAt);
    report.buildNumber = run?.buildNumber; report.usageTotalUsd = run?.usageTotalUsd; report.status = run?.status;
    // A timed-out crawl still has a valid partial dataset; report it as partial.
    if (!["SUCCEEDED", "TIMED-OUT"].includes(String(run?.status)) || typeof run?.defaultDatasetId !== "string") throw new Error("Crawl did not produce a dataset; inspect Console.");
    const raw = await request(`datasets/${run.defaultDatasetId}/items?clean=true&limit=${CRAWL_MAX_PAGES}&fields=url,text`);
    if (!Array.isArray(raw)) throw new Error("Dataset is not an array.");
    const retrievedAt = new Date().toISOString();
    report.retrievedAt = retrievedAt; report.datasetId = run.defaultDatasetId; report.partial = run.status === "TIMED-OUT";
    const pages = raw.map(record).filter((r): r is Row => !!r && typeof r.url === "string" && typeof r.text === "string");
    await writeFile(resolve(outputDir, "pages.json"), JSON.stringify(pages.map(p => ({ url: p.url, chars: String(p.text).length })), null, 2) + "\n");
    // Public page text only, kept under ignored work/ so extraction can be re-checked offline without another paid crawl.
    await writeFile(resolve(outputDir, "pages-text.json"), JSON.stringify(pages.map(p => ({ url: p.url, text: p.text })), null, 2) + "\n");
    const results: StudioPrices[] = (report.studios as Row[]).map(s => {
      const mine = pages.filter(p => host(String(p.url)) === host(String(s.website)));
      const offers = mine.flatMap(p => extractOffers(String(p.text), String(p.url)));
      const classes = offers.filter(o => o.kind === "class").map(o => o.amountMinor);
      return { studio: String(s.studio), website: String(s.website), googleMapsUrl: String(s.googleMapsUrl), pagesRead: mine.length,
        status: !mine.length ? "not_crawled" : offers.length ? "priced" : "no_price_found",
        ...(classes.length ? { fromPriceMinor: Math.min(...classes) } : {}), offers: offers.slice(0, 8), retrievedAt };
    });
    await writeFile(resolve(outputDir, "prices.json"), JSON.stringify(results, null, 2) + "\n");
    report.status = "succeeded";
    report.inspection = {
      pagesRead: pages.length, studios: results.length,
      priced: results.filter(r => r.status === "priced").length,
      withClassPrice: results.filter(r => r.fromPriceMinor !== undefined).length,
      summary: results.map(r => ({ studio: r.studio, status: r.status, pagesRead: r.pagesRead, fromPrice: r.fromPriceMinor === undefined ? "unknown" : `$${(r.fromPriceMinor / 100).toFixed(2)}` })),
    };
    await save();
    console.log(JSON.stringify({ status: report.status, partial: report.partial, elapsedMs: report.elapsedMs, usageTotalUsd: report.usageTotalUsd, inspection: report.inspection }, null, 2));
    console.log("Saved:", outputDir);
  } catch (error) {
    if (!terminal.has(String(report.status)) && report.status !== "succeeded") report.status = "uncertain";
    await save();
    console.error("Report saved:", outputDir);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error && error.message.startsWith("Apify HTTP") ? error.message : "Studio price spike failed; inspect the saved report and resume instead of repeating a paid start.");
    process.exitCode = 1;
  });
}
