/**
 * Dev 4 sandbox connectivity spike: create → retrieve → expire one hosted session.
 * No card entry, authorization, capture or refund. Key stays in memory only.
 * Run: node scripts/stripe-spike.mts --deployment cool-bat-724
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createStripeTestAdapter } from "../convex/payments/stripe.ts";

const deployment = process.argv[process.argv.indexOf("--deployment") + 1];
if (deployment !== "cool-bat-724") throw new Error("This spike is restricted to Alex's cool-bat-724 development deployment.");
let secretKey: string;
try {
  secretKey = execFileSync("npx", ["convex", "env", "get", "STRIPE_SECRET_KEY", "--deployment", deployment], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
} catch { throw new Error("Could not read the configured development Stripe key. No provider call was made."); }
if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured on the selected development deployment. No provider call was made.");
if (!/^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey)) throw new Error("The development key is not a supported Stripe test secret. No provider call was made.");
const runId = randomUUID();
const directory = `work/research-spike/stripe-sandbox/${runId}`;
await mkdir(directory, { recursive: true });
const report: { runId: string; deployment: string; status: string; sessionId?: string; steps: Array<{ name: string; kind: string; status?: string }>; startedAt: string; finishedAt?: string } = {
  runId, deployment, status: "pending", steps: [], startedAt: new Date().toISOString(),
};
const save = () => writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
await save(); // Standalone spike run report exists before the external request.
const adapter = createStripeTestAdapter({ secretKey, frontendOrigin: "http://localhost:3000" });
const created = await adapter.createCheckout({
  roomId: `synthetic-room-${runId}`, revisionId: `synthetic-revision-${runId}`,
  participantId: `synthetic-member-${runId}`, attemptId: `synthetic-attempt-${runId}`,
  amountMinor: 100, currency: "USD", mode: "authorize", idempotencyKey: `stripe-spike:${runId}:create`,
});
report.steps.push({ name: "create", kind: created.kind, ...(created.kind === "ok" ? { status: created.value.status } : {}) });
if (created.kind !== "ok") {
  report.status = created.kind; report.finishedAt = new Date().toISOString(); await save();
  throw new Error(`Sandbox create was ${created.kind}. No automatic retry. Inspect the local run report and Stripe before retrying.`);
}
report.sessionId = created.value.id;
await save();
const retrieved = await adapter.retrieveCheckout(created.value.id);
report.steps.push({ name: "retrieve", kind: retrieved.kind, ...(retrieved.kind === "ok" ? { status: retrieved.value.status } : {}) });
await save();
const expired = await adapter.expireCheckout(created.value.id, `stripe-spike:${runId}:expire`);
report.steps.push({ name: "expire", kind: expired.kind, ...(expired.kind === "ok" ? { status: expired.value.status } : {}) });
report.status = retrieved.kind === "ok" && expired.kind === "ok" && expired.value.status === "expired" ? "succeeded" : "uncertain";
report.finishedAt = new Date().toISOString();
await save();
console.log(JSON.stringify({ status: report.status, deployment, sessionId: report.sessionId, steps: report.steps, report: `${directory}/report.json`, cardsEntered: false, fundsAuthorized: false, fundsCaptured: false }));
if (report.status !== "succeeded") process.exitCode = 1;
