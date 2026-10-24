/** Re-evaluate saved public trend data locally. No token, network or paid run. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverShoppingQueries, normalizeTrendDataset } from "../lib/research/trends.ts";
import type { TrendContext } from "../lib/contracts/index.ts";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node scripts/trends-replay.mts work/research-spike/trends-TIMESTAMP");
const outputDir = resolve(directory);
const report = JSON.parse(await readFile(resolve(outputDir, "report.json"), "utf8")) as Record<string, unknown>;
const raw: unknown = JSON.parse(await readFile(resolve(outputDir, "raw.json"), "utf8"));
// Runtime validation in normalizer rejects invalid context; never replace it with defaults.
const context = { seedTerm: report.query, geo: report.geo, timeRange: report.timeRange, retrievedAt: report.retrievedAt } as TrendContext;
const observations = normalizeTrendDataset(raw, context);
const discoveries = discoverShoppingQueries(observations);
await writeFile(resolve(outputDir, "observations.json"), JSON.stringify(observations, null, 2) + "\n");
await writeFile(resolve(outputDir, "discoveries.json"), JSON.stringify(discoveries, null, 2) + "\n");
const summary = {
  actor: report.actor, runId: report.runId, originalRetrievedAt: report.retrievedAt,
  replayedAt: Date.now(), observationCount: observations.length, discoveryCount: discoveries.length,
  discoveries,
};
await writeFile(resolve(outputDir, "replay.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
if (!observations.length || !discoveries.length) process.exitCode = 1;
