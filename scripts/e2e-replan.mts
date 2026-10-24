/**
 * Live replan check on the dev deployment using the demo fixture pool (no product search).
 * Flow: clues -> seed -> ask -> new ownership clue (trace + re-evaluation) -> follow-up reply.
 * Run: scripts/run-e2e-replan.sh
 */
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { setTimeout as delay } from "node:timers/promises";

const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
const api = anyApi;
const client = new ConvexHttpClient(url);
client.setAuth((await client.action(api.auth.signIn, { provider: "anonymous" })).tokens.token);
async function must(p: Promise<any>, label: string) {
  const r = await p;
  if (!r.ok) throw new Error(`${label}: ${JSON.stringify(r.error)}`);
  return r.value;
}
const room = await must(client.mutation(api.rooms.createRoom, {
  title: "Replan", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alice", budgetMinor: 8000,
}), "createRoom");
const roomId = room.room._id;
await must(client.mutation(api.clues.upsertManualPreference, { roomId, kind: "interest", text: "Wants to try pottery" }), "clue1");
await must(client.mutation(api.agents.recipient ? api.clues.upsertManualPreference : api.clues.upsertManualPreference, { roomId, kind: "explicit_wish", text: "Wants a hands-on pottery class or kit" }), "clue2");
console.log("seed:", await must(client.mutation(api.demo.seedFixturePool, { roomId }), "seed"));

async function say(body: string, label: string) {
  await must(client.mutation(api.messages.sendMessage, { roomId, body, clientIdempotencyKey: `${label}-${Date.now()}` }), "send");
}
async function waitFor(label: string, pred: (msgs: any[], act: any) => boolean, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const msgs = await must(client.query(api.messages.listMessages, { roomId }), "msgs");
    const act = await must(client.query(api.agents.buyer.listActivity, { roomId }), "act");
    if (pred(msgs, act)) return { msgs, act };
    await delay(2000);
  }
  throw new Error("timeout: " + label);
}
const agentCount = (m: any[]) => m.filter((x) => x.authorKind === "buyer_agent").length;

await say("@unwrap what do you recommend?", "ask");
let r = await waitFor("recommendation", (m) => agentCount(m) >= 1);
console.log("\n--- RECOMMENDATION ---\n" + r.msgs.filter((x: any) => x.authorKind === "buyer_agent").at(-1).body);

const before = agentCount(r.msgs);
await must(client.mutation(api.clues.upsertManualPreference, { roomId, kind: "ownership", text: "Already owns a starter kit" }), "ownership");
r = await waitFor("re-evaluation", (m, a) => agentCount(m) > before && a.events.some((e: any) => e.summary.startsWith("Dropped")));
console.log("\n--- AFTER NEW CLUE ---\n" + r.msgs.filter((x: any) => x.authorKind === "buyer_agent").at(-1).body);
console.log("\ntrace:", r.act.events.filter((e: any) => e.summary.startsWith("Dropped")).map((e: any) => e.summary));

const before2 = agentCount(r.msgs);
await say("@unwrap why did the kit disappear, and which of the rest is cheapest?", "why");
r = await waitFor("reply", (m) => agentCount(m) > before2);
console.log("\n--- REPLY ---\n" + r.msgs.filter((x: any) => x.authorKind === "buyer_agent").at(-1).body);
const stats = await must(client.query(api.agents.stats.getRoomStats, { roomId }), "stats");
console.log("\nstats:", JSON.stringify(stats));
