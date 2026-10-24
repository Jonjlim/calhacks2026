/**
 * Live photo-clue check against the dev deployment. Uploads two copies of a local scene image
 * (path in PHOTO_FILE), lets the extractor read them, and prints what was proposed.
 * Synthetic/no people. Run: PHOTO_FILE=/path.jpg scripts/run-e2e-photo.sh
 */
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const url = process.env.NEXT_PUBLIC_CONVEX_URL!;
const file = process.env.PHOTO_FILE!;
if (!url || !file) throw new Error("NEXT_PUBLIC_CONVEX_URL and PHOTO_FILE required");
const api = anyApi;
const client = new ConvexHttpClient(url);
const auth = await client.action(api.auth.signIn, { provider: "anonymous" });
client.setAuth(auth.tokens.token);
async function must(p: Promise<any>, label: string) {
  const r = await p;
  if (!r.ok) throw new Error(`${label}: ${JSON.stringify(r.error)}`);
  return r.value;
}
const room = await must(client.mutation(api.rooms.createRoom, {
  title: "Photo E2E", recipientDisplayName: "Maya", occasion: "Birthday", displayName: "Alice",
}), "createRoom");
const roomId = room.room._id;
const bytes = await readFile(file);
const ids: string[] = [];
for (let i = 0; i < 2; i++) {
  const { uploadUrl } = await must(client.mutation(api.media.generateEvidenceUploadUrl, { roomId }), "uploadUrl");
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: bytes });
  ids.push((await res.json()).storageId);
}
const { source } = await must(client.mutation(api.media.importMediaEvidence, {
  roomId, kind: "photo", label: "scene", files: ids.map((storageId) => ({ storageId })),
}), "importMediaEvidence");
await must(client.mutation(api.agents.extract.extractClues, { sourceId: source._id }), "extractClues");
let done: any;
for (let i = 0; i < 45 && !done; i++) {
  await delay(2000);
  const act = await must(client.query(api.agents.buyer.listActivity, { roomId }), "activity");
  done = act.jobs.find((j: any) => j.kind === "extract" && !["pending", "running"].includes(j.status));
  if (done) console.log("events:", act.events.map((e: any) => `${e.actor}/${e.kind}: ${e.summary}`));
}
console.log("job:", done?.status, done?.modelUsage);
const clues = await must(client.query(api.clues.listMyProposedClues, { roomId }), "clues");
console.log("proposed:", clues.map((c: any) => `${c.kind} (${c.confidence}, ${c.sourceMessageIds.length} photos): ${c.text}`));
const sources = await must(client.query(api.clues.listMyEvidence, { roomId }), "evidence");
console.log("media status:", sources.map((s: any) => s.media?.status));
