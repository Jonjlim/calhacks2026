/** Explicit one-run acceptance on Alex's personal dev; no shopping, model or Stripe calls.
 * node --env-file=.env.local scripts/fashion-smoke.mts --start
 * node --env-file=.env.local scripts/fashion-smoke.mts --resume work/research-spike/fashion-live/UUID
 */
import { ConvexHttpClient } from "convex/browser";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import type { Result } from "../lib/contracts/index.ts";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (url !== "https://cool-bat-724.convex.cloud") throw new Error("This acceptance script is restricted to cool-bat-724 personal development.");
const args = process.argv.slice(2);
const resume = args[0] === "--resume" && args.length === 2;
if (!resume && !(args[0] === "--start" && args.length === 1)) throw new Error("Use --start for one capped run, or --resume <existing report directory>. No request made.");
const root = resolve("work/research-spike/fashion-live");
const directory = resume ? resolve(args[1]!) : resolve(root, randomUUID());
const child = relative(root, directory);
if (!/^[0-9a-f-]{36}$/.test(child)) throw new Error("Use an existing UUID report directory under work/research-spike/fashion-live.");
const reportSchema = z.object({
  runId: z.string().uuid(), status: z.string(), roomId: z.string().optional(), jobId: z.string().optional(),
  idempotencyKey: z.string(), startedAt: z.number(), finishedAt: z.number().optional(),
  providerRunId: z.string().optional(), directionQueries: z.array(z.string()).optional(), sourceUrls: z.array(z.string()).optional(),
});
type Report = z.infer<typeof reportSchema>;
await mkdir(directory, { recursive: true });
const report: Report = resume ? reportSchema.parse(JSON.parse(await readFile(resolve(directory, "report.json"), "utf8"))) : {
  runId: child, status: "pending", idempotencyKey: `fashion-acceptance:${child}`, startedAt: Date.now(),
};
const save = () => writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
await save();
const client = new ConvexHttpClient(url);
function must<T>(r: Result<T>): T { if (!r.ok) throw new Error(`Request refused (${r.error.code}).`); return r.value; }
try {
  const auth = z.object({ tokens: z.object({ token: z.string() }) }).parse(await client.action(api.auth.signIn, { provider: "anonymous" }));
  client.setAuth(auth.tokens.token); // In memory only; no API/auth tokens are saved or printed.
  if (resume) {
    const local = z.object({ inviteToken: z.string() }).parse(JSON.parse(await readFile(resolve(directory, "private-room.json"), "utf8")));
    const joined = must(await client.mutation(api.rooms.joinRoom, { inviteToken: local.inviteToken, displayName: "Dev4 acceptance resume" }));
    if (joined.room._id !== report.roomId) throw new Error("Resume room does not match the report.");
  } else {
    const created = must(await client.mutation(api.rooms.createRoom, {
      title: `TEST ONLY fashion acceptance ${child.slice(0, 8)}`, recipientDisplayName: "Synthetic denim recipient",
      occasion: "Development test", budgetMinor: 8000, displayName: "Dev4 acceptance",
    }));
    report.roomId = created.room._id;
    // Local ignored synthetic-room capability enables resumption without storing an auth token.
    await writeFile(resolve(directory, "private-room.json"), JSON.stringify({ inviteToken: created.inviteToken }), { mode: 0o600 });
    await save();
    must(await client.mutation(api.clues.upsertManualPreference, { roomId: created.room._id, kind: "interest", text: "Likes vintage denim" }));
  }
  if (!report.roomId) throw new Error("Report has no saved room. No provider start made.");
  const roomId = report.roomId as Id<"rooms">;
  if (!report.jobId) {
    // A lost mutation response is safe to resume with this same durable request key.
    const started = must(await client.mutation(api.research.fashion.startDiscovery, { roomId, idempotencyKey: report.idempotencyKey }));
    report.jobId = started.jobId;
    await save();
  }
  let view = must(await client.query(api.research.fashion.getDiscovery, { roomId }));
  if (resume && view.latestJob?.id === report.jobId && view.latestJob.canResume)
    must(await client.mutation(api.research.fashion.resumeDiscovery, { roomId, jobId: report.jobId as Id<"fashionJobs"> }));
  const deadline = Date.now() + 235_000;
  while (Date.now() < deadline) {
    view = must(await client.query(api.research.fashion.getDiscovery, { roomId }));
    if (view.latestJob?.id !== report.jobId) throw new Error("Acceptance job is not the room's latest request.");
    report.status = view.latestJob.status;
    await save();
    if (!["pending", "running"].includes(report.status)) break;
    await delay(2000);
  }
  if (["pending", "running"].includes(report.status)) report.status = "uncertain";
  if (view.sample?.jobId === report.jobId) {
    report.providerRunId = view.sample.providerRunId;
    report.directionQueries = view.sample.directions.map(d => d.searchQuery);
    report.sourceUrls = [...new Set(view.sample.directions.flatMap(d => d.postUrls))];
  }
  report.finishedAt = Date.now();
  await save();
  console.log(JSON.stringify({ ...report, report: resolve(directory, "report.json"), maxSourceChargeUsd: 0.50, shoppingRuns: 0, stripeCalls: 0, modelCalls: 0 }));
  if (report.status !== "succeeded") process.exitCode = 1;
} catch {
  report.status = "uncertain"; report.finishedAt = Date.now(); await save();
  console.error(`Acceptance unresolved. Resume this report; do not repeat --start: ${resolve(directory, "report.json")}`);
  process.exitCode = 1;
}
