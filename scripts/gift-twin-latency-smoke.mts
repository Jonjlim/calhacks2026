/** Live dev check: synthetic messages only; deletes its temporary room in finally. */
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel";
import type { Result } from "../lib/contracts";

async function must<T>(operation: Promise<Result<T>>): Promise<T> {
  const result = await operation;
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

async function main() {
  if (!process.argv.includes("--run")) {
    console.log("Use --run with NEXT_PUBLIC_CONVEX_URL pointing at dev. Creates and deletes a synthetic room; may make small model calls, but never starts shopping/trend research.");
    return;
  }
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("missing_url");
  const member = new ConvexHttpClient(url);
  const login = await member.action(api.auth.signIn, { provider: "anonymous" });
  if (!login.tokens) throw new Error("sign_in_failed");
  member.setAuth(login.tokens.token);
  const title = `Synthetic twin latency ${randomUUID()}`;
  let roomId: Id<"rooms"> | undefined;
  const until = async (predicate: () => Promise<boolean>) => {
    const started = performance.now();
    while (performance.now() - started < 30_000) {
      if (await predicate()) return performance.now() - started;
      await delay(100);
    }
    throw new Error("timeout");
  };
  try {
    const created = await must(member.mutation(api.rooms.createRoom, {
      title, recipientDisplayName: "Maya", occasion: "Synthetic latency check", displayName: "Synthetic tester",
    }));
    roomId = created.room._id;
    const targetRoom = roomId;
    const pairing = await must(member.action(api.giftTwin.room.createPairing, { roomId }));
    const device = new ConvexHttpClient(url);
    const deviceToken = `${randomUUID()}${randomUUID()}`;
    await must(device.mutation(api.giftTwin.device.pair, { pairingCode: pairing.pairingCode, deviceToken, deviceLabel: "Synthetic latency probe" }));
    const upload = await must(device.mutation(api.giftTwin.device.startUpload, { deviceToken, consent: true }));
    await must(device.mutation(api.giftTwin.device.uploadMessages, { deviceToken, uploadId: upload.uploadId, messages: [
      { text: "I really want a hydration vest", sentAt: Date.now() - 3_000 },
      { text: "I love tennis", sentAt: Date.now() - 2_000 },
      { text: "I already have a Kindle", sentAt: Date.now() - 1_000 },
    ] }));
    const initialStart = performance.now();
    await must(device.mutation(api.giftTwin.device.finishUpload, { deviceToken, uploadId: upload.uploadId }));
    await until(async () => {
      const feed = await must(member.query(api.giftTwin.room.getFeed, { roomId: targetRoom }));
      return feed.posts.some((post) => post.status === "added" && post.text.includes("hydration vest"));
    });
    const initialFindingsMs = performance.now() - initialStart;
    const evaluationStart = performance.now();
    // Exclusions never start trend discovery. This contradicts the synthetic
    // recipient's explicit tennis interest and should receive a downvote.
    const clue = await must(member.mutation(api.clues.upsertManualPreference, {
      roomId, kind: "exclusion", text: "Maya doesn't like tennis",
    }));
    await until(async () => {
      const feed = await must(member.query(api.giftTwin.room.getFeed, { roomId: targetRoom }));
      return feed.posts.some((post) => post.ideaRef === `clue:${clue._id}` && post.vote === "down" && post.status !== "suggested");
    });
    console.log(JSON.stringify({ passed: true, initialFindingsMs, newMessageEvaluationMs: performance.now() - evaluationStart }, null, 2));
  } finally {
    if (roomId) {
      await must(member.mutation(api.rooms.deleteRoom, { roomId, confirmTitle: title }));
      console.log("Synthetic room deleted; purge scheduled.");
    }
  }
}

main().catch(() => {
  console.error("Synthetic twin latency check failed; error bodies and credentials withheld.");
  process.exitCode = 1;
});
