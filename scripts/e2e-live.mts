/**
 * Live two-user check against the dev deployment (NEXT_PUBLIC_CONVEX_URL from .env.local).
 * Synthetic data only. Makes a handful of small model calls; may start one research job.
 * Run: node --env-file=.env.local scripts/e2e-live.mts
 */
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { setTimeout as delay } from "node:timers/promises";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL missing");
const api = anyApi;

async function user(name: string) {
  const client = new ConvexHttpClient(url!);
  const res = await client.action(api.auth.signIn, { provider: "anonymous" });
  client.setAuth(res.tokens.token);
  return { name, client };
}
type Client = Awaited<ReturnType<typeof user>>["client"];
async function must<T>(p: Promise<{ ok: boolean; value?: T; error?: unknown }>, label: string): Promise<T> {
  const r = (await p) as any;
  if (!r.ok) throw new Error(`${label}: ${JSON.stringify(r.error ?? r)}`);
  return r.value as T;
}
async function until<T>(label: string, fn: () => Promise<T | null>, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await delay(2000);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const alice = await user("alice");
const bob = await user("bob");

const created = await must<any>(
  alice.client.mutation(api.rooms.createRoom, {
    title: "E2E Maya birthday", recipientDisplayName: "Maya", occasion: "Birthday",
    budgetMinor: 6000, displayName: "Alice",
  }), "createRoom");
const roomId = created.room._id;
const invite = await must<any>(alice.client.query(api.rooms.getInvite, { roomId }), "getInvite");
await must(bob.client.mutation(api.rooms.joinRoom, { inviteToken: invite.inviteToken, displayName: "Bob" }), "joinRoom");
console.log("room ready", roomId);

// Alice: private import -> extract -> publish
const imp = await must<any>(alice.client.mutation(api.clues.importEvidence, {
  roomId, kind: "paste", label: "texts with Maya",
  rawText: "Maya: I have always wanted to try a beginner pottery class\nMaya: no more candles please, I have so many",
}), "importEvidence");
await must(alice.client.mutation(api.agents.extract.extractClues, { sourceId: imp.source._id }), "extractClues");
const proposed = await until("proposed clues", async () => {
  const rows = await must<any[]>(alice.client.query(api.clues.listMyProposedClues, { roomId }), "listProposed");
  return rows.length ? rows : null;
});
console.log("proposed:", proposed.map((c) => `${c.kind}: ${c.text}`));
const bobSees = await must<any[]>(bob.client.query(api.clues.listMyProposedClues, { roomId }), "bob proposed");
if (bobSees.length) throw new Error("PRIVACY: bob can see alice's proposed clues");
for (const c of proposed) await must(alice.client.mutation(api.clues.publishClue, { proposedClueId: c._id }), "publishClue");

// Bob adds context and asks Unwrap
await must(bob.client.mutation(api.messages.sendMessage, {
  roomId, body: "@unwrap she already owns a starter pottery kit, what do you suggest under $60?",
  clientIdempotencyKey: `e2e-${Date.now()}`,
}), "sendMessage");

const agentMsg = await until("agent reply", async () => {
  const msgs = await must<any[]>(bob.client.query(api.messages.listMessages, { roomId }), "listMessages");
  return msgs.find((m) => m.authorKind === "buyer_agent" || m.author === "buyer_agent" || m.kind === "agent") ?? null;
}, 120_000).catch(() => null);
const activity = await must<any>(bob.client.query(api.agents.buyer.listActivity, { roomId }), "listActivity");
console.log("agent message:", agentMsg ? agentMsg.body ?? JSON.stringify(agentMsg) : "(none yet)");
console.log("activity:", activity.events?.map((e: any) => `${e.actor}/${e.kind}: ${e.summary}`));
console.log("jobs:", activity.jobs?.map((j: any) => `${j.kind}:${j.status}`));
