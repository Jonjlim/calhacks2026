"use node";

/**
 * Moss, the room guide, recalling friends' memories (MAP-024). Owner: Dev 3.
 *
 * Each call builds a throwaway Moss session from the room's published memories
 * (see ./context), asks it one guide question, maps the hit IDs back to memories
 * this member may already see, and closes the session. Without Moss, or if Moss
 * fails or is slow, word overlap ranks instead. Nothing is saved or published.
 * Gift Twin's private sessions (convex/giftTwin/memory.ts) are separate.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import type { Result } from "../../lib/contracts";
import { MOSS_QUESTIONS } from "../../lib/room/guide";
import { keywordRank, pickNudge, type MossNudgeView, type RecallDoc } from "../../lib/room/mossRecall";
import { err, memberError, ok } from "../lib/result";

/** Past this, the guide answers from word overlap rather than keep someone waiting. */
const MOSS_BUDGET_MS = 5000;
/** Batch size for indexing, matching Gift Twin's bound on native work per call. */
const BATCH = 128;

export function roomMossEnabled(): boolean {
  return process.env.MOSS_ROOM_ENABLED === "true" && Boolean(process.env.MOSS_PROJECT_ID && process.env.MOSS_PROJECT_KEY);
}

let cacheReady = false;
/**
 * Convex's filesystem is writable only under /tmp, and the native SDK reads its
 * model cache path from the real process environment, which JS assignments to
 * process.env don't reach. Same approach as Gift Twin (D26): a nonsecret env
 * file with only the cache path, loaded natively, then deleted.
 */
function prepareModelCache() {
  if (cacheReady) return;
  const directory = mkdtempSync(join(tmpdir(), "unwrap-moss-room-"));
  try {
    const config = join(directory, "runtime.env");
    writeFileSync(config, `MOSS_MODEL_CACHE_DIR=${join(tmpdir(), "unwrap-moss-models")}\n`, { mode: 0o600 });
    loadEnvFile(config);
    cacheReady = true;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("moss_timeout")), ms))]);
}

/** Ranks docs with a throwaway Moss session. IDs sent to Moss are local (d0, d1…); the session name is random. */
async function mossRank(query: string, docs: readonly RecallDoc[]): Promise<string[]> {
  let client: import("@moss-js/moss").MossClient | undefined;
  try {
    prepareModelCache();
    const { MossClient } = await import("@moss-js/moss");
    client = new MossClient(process.env.MOSS_PROJECT_ID!, process.env.MOSS_PROJECT_KEY!, { cachePath: join(tmpdir(), "unwrap-moss") });
    const session = await client.session(`room-${randomUUID()}`);
    const local = docs.map((d, i) => ({ id: `d${i}`, text: d.text }));
    for (let start = 0; start < local.length; start += BATCH) await session.addDocs(local.slice(start, start + BATCH));
    const result = await session.query(query, { topK: 6, alpha: 0.8 });
    return result.docs.flatMap((hit) => {
      const index = Number(hit.id.slice(1));
      return hit.id.startsWith("d") && Number.isInteger(index) && docs[index] && Number.isFinite(hit.score) ? [docs[index]!.id] : [];
    });
  } finally {
    // Closing the client closes its sessions too. Errors may hold private text: never log them.
    if (client) await client.close().catch(() => undefined);
  }
}

export const nudge = action({
  args: { roomId: v.id("rooms"), questionIndex: v.number() },
  handler: async (ctx, { roomId, questionIndex }): Promise<Result<MossNudgeView | null>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return err("unauthorized", "Sign in first.");
    const question = Number.isInteger(questionIndex) ? MOSS_QUESTIONS[questionIndex] : undefined;
    if (!question) return err("validation_failed", "Unknown question.");
    const room = await ctx.runQuery(internal.moss.context.roomMemories, { roomId, userId });
    if (room === "not_found" || room === "unauthorized") return memberError(room);
    const friends = room.docs.filter((d) => d.authorId !== room.askerId);
    if (!friends.length) return ok(null);

    const query = `${question.label}. ${question.title} ${question.prompt}`;
    const start = performance.now();
    let ranked: string[] | null = null;
    if (roomMossEnabled()) {
      try {
        ranked = await withTimeout(mossRank(query, friends), MOSS_BUDGET_MS);
        console.info("room_moss", { provider: "moss", docs: friends.length, ms: Math.round(performance.now() - start), hits: ranked.length });
      } catch {
        console.info("room_moss", { provider: "keyword", reason: "moss_unavailable" });
      }
    }
    const picked = ranked?.length ? pickNudge(ranked, friends, room.askerId, "moss") : pickNudge(keywordRank(query, friends), friends, room.askerId, "keyword");
    if (!picked) return ok(null);
    return ok({ clueId: picked.doc.id, text: picked.doc.text, author: picked.doc.author, match: picked.match, ms: Math.round(performance.now() - start) });
  },
});

/** Loads the model once with synthetic text so the first real nudge is fast. Never reads room text. */
export const warm = action({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }): Promise<Result<{ warmed: boolean }>> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return err("unauthorized", "Sign in first.");
    const room = await ctx.runQuery(internal.moss.context.roomMemories, { roomId, userId });
    if (room === "not_found" || room === "unauthorized") return memberError(room);
    if (!roomMossEnabled()) return ok({ warmed: false });
    try {
      await withTimeout(mossRank("a quiet weekend", [
        { id: "warm-a", text: "Likes slow mornings with coffee.", authorId: "", author: "" },
        { id: "warm-b", text: "Plays tennis on weekends.", authorId: "", author: "" },
      ]), 30_000);
      return ok({ warmed: true });
    } catch {
      return ok({ warmed: false });
    }
  },
});
