/**
 * Live scenario check: memories in, real trend ideas and products out.
 * Creates a throwaway room on the deployment in .env.local, prints what came back, then deletes the room.
 * Nothing is stored in the app; the memories come from the command line.
 * Cost: one Google Trends lookup per memory (up to $0.20) plus one shopping search (up to $0.20).
 * Run: scripts/run-scenario-check.sh "Plays tennis every weekend" "Collects vinyl records"
 */
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { setTimeout as delay } from "node:timers/promises";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const memories = process.argv.slice(2).map((m) => m.trim()).filter(Boolean);
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL missing (.env.local)");
if (!memories.length || memories.length > 3) {
  console.error('Give 1–3 memories, e.g. scripts/run-scenario-check.sh "Loves trail running" "Into specialty coffee"');
  process.exit(1);
}
const api = anyApi;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = { ok: boolean; value?: any; error?: unknown };
async function must(p: Promise<R>, label: string) {
  const r = await p;
  if (!r.ok) throw new Error(`${label}: ${JSON.stringify(r.error)}`);
  return r.value;
}
const money = (minor?: number) => (minor === undefined ? "price unknown" : `$${(minor / 100).toFixed(2)}`);

const client = new ConvexHttpClient(url);
const auth = await client.action(api.auth.signIn, { provider: "anonymous" });
client.setAuth(auth.tokens.token);

const title = `Scenario check ${new Date().toISOString().slice(11, 19)}`;
const created = await must(client.mutation(api.rooms.createRoom, { title, recipientDisplayName: "Sam", occasion: "Birthday", budgetMinor: 8000 }), "createRoom");
const roomId = created.room._id;
const started = Date.now();
try {
  const clueIds: string[] = [];
  for (const text of memories) clueIds.push((await must(client.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text }), "add memory"))._id);
  console.log(`Room ${roomId}: ${memories.length} memories shared; trend lookups start automatically.\n`);

  // Trend ideas arrive per memory; wait up to 60 s.
  let trends: any = null;
  for (let i = 0; i < 20; i++) {
    trends = await must(client.query(api.research.trendJobs.getDiscovery, { roomId }), "getDiscovery");
    if ((trends.samples?.length ?? 0) >= memories.length || trends.latestJob?.status === "failed") break;
    await delay(3000);
  }
  for (const text of memories) {
    const i = memories.indexOf(text);
    const sample = trends?.samples?.find((s: any) => s.publishedClueId === clueIds[i]);
    console.log(`TRENDS for "${text}"${sample ? ` (seed "${sample.context.seedTerm}")` : ""}:`);
    if (!sample) console.log("  none (no safe seed, still running, or failed)");
    for (const s of sample?.suggestions ?? []) console.log(`  - ${s.query}  [${s.signals.map((x: any) => x.kind + (x.growthPercent ? ` +${x.growthPercent}%` : "")).join(", ")}]`);
  }
  if (trends?.latestJob?.lastError) console.log(`  last trend job: ${trends.latestJob.status}: ${trends.latestJob.lastError}`);

  const { jobId } = await must(client.mutation(api.research.research.startResearch, { roomId, publishedClueIds: clueIds, idempotencyKey: `scenario-${started}` }), "startResearch");
  let recs: any = { recommendations: [], listings: [] };
  for (let i = 0; i < 25; i++) {
    const jobs = await must(client.query(api.jobs.listRoomJobs, { roomId }), "listRoomJobs");
    const job = jobs.researchJobs.find((j: any) => j._id === jobId);
    if (job && ["succeeded", "failed", "stale", "uncertain"].includes(job.status)) {
      console.log(`\nRESEARCH ${job.status}${job.lastError ? `: ${job.lastError}` : ""} after ${Math.round((Date.now() - started) / 1000)} s`);
      break;
    }
    await delay(3000);
  }
  recs = await must(client.query(api.research.research.listRecommendations, { roomId }), "listRecommendations");
  const byId = new Map(recs.listings.map((l: any) => [l.id ?? l._id, l]));
  console.log(`PRODUCTS (${recs.recommendations.length} recommended of ${recs.listings.length} found):`);
  for (const r of recs.recommendations.slice(0, 8)) {
    const l: any = byId.get(r.listingId);
    if (!l) continue;
    console.log(`  - ${l.title} · ${money(l.priceMinor)} · ${l.sellerName ?? "seller unknown"} · photo ${l.imageUrl ? "yes" : "no"} · score ${r.score.toFixed(2)}`);
    console.log(`    ${l.sourceUrl}`);
  }
} finally {
  await client.mutation(api.rooms.deleteRoom, { roomId, confirmTitle: title }).catch(() => undefined);
  console.log("\nThrowaway room deleted.");
}
