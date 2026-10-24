/** Offline analysis of an existing public TikTok sample; no network or token. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverFashionIdeas, normalizeTikTokPosts } from "../lib/research/tiktok.ts";
import type { FashionSampleContext } from "../lib/contracts/index.ts";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node scripts/tiktok-replay.mts work/research-spike/tiktok-TIMESTAMP");
const outputDir = resolve(directory);
const report = JSON.parse(await readFile(resolve(outputDir, "report.json"), "utf8")) as Record<string, unknown>;
const raw: unknown = JSON.parse(await readFile(resolve(outputDir, "raw.json"), "utf8"));
const context = { seedTerm: report.query, windowStart: report.windowStart, windowEnd: report.windowEnd, retrievedAt: report.retrievedAt } as FashionSampleContext;
const posts = normalizeTikTokPosts(raw, context);
const discoveries = discoverFashionIdeas(posts, context);
const summary = {
  actor: report.actor, build: report.build, runId: report.runId, context, region: "unknown",
  rawPostCount: Array.isArray(raw) ? raw.length : 0, validRecentPosts: posts.length,
  distinctCreators: new Set(posts.map(post => post.creatorKey)).size,
  flaggedAdPosts: posts.filter(post => post.advertising === "flagged").length,
  discoveryCount: discoveries.length, discoveries,
  verdict: discoveries.length ? "candidate_pass_needs_relevance_review" : "insufficient_corroborated_mentions",
};
await writeFile(resolve(outputDir, "posts.json"), JSON.stringify(posts, null, 2) + "\n");
await writeFile(resolve(outputDir, "discoveries.json"), JSON.stringify(discoveries, null, 2) + "\n");
await writeFile(resolve(outputDir, "replay.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
