"use node";

/** Recipient-only memory. No public callable retrieval function is exported. */
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { configuredModel } from "../agents/model";
import { type TwinVoteCast, type VaultMessage } from "../../lib/agentCollaborators/contracts";
import { modelConfigured, mossConfigured } from "./lib";
import { recallIdeaEvidence } from "./memoryRecall";
import { castVotes } from "./vote";
import { loadVaultMessages } from "./vaultMessages";

function prepareModelCache() {
  // Convex's Node filesystem is read-only outside /tmp. This is the native
  // SDK's model-artifact cache (not a persisted recipient-memory index).
  // Convex replaces JS process.env with per-invocation variables; native
  // getenv() does not see assignments to that object. Node's native env loader
  // sets the SDK's actual process environment. This file contains only a
  // nonsecret /tmp model-cache path and is immediately removed.
  const directory = mkdtempSync(join(tmpdir(), "unwrap-moss-config-"));
  try {
    const config = join(directory, "runtime.env");
    writeFileSync(config, `MOSS_MODEL_CACHE_DIR=${join(tmpdir(), "unwrap-moss-models")}\n`, { mode: 0o600 });
    loadEnvFile(config);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Internal operational probe: synthetic text only, never recipient data. */
export const smoke = internalAction({
  args: {},
  handler: async () => {
    if (!process.env.MOSS_PROJECT_ID || !process.env.MOSS_PROJECT_KEY) {
      return { ok: false as const, reason: "missing_configuration" };
    }
    let client: import("@moss-js/moss").MossClient | undefined;
    let stage = "import";
    try {
      const start = performance.now();
      prepareModelCache();
      const { MossClient } = await import("@moss-js/moss");
      stage = "initialize";
      client = new MossClient(process.env.MOSS_PROJECT_ID, process.env.MOSS_PROJECT_KEY, {
        cachePath: join(tmpdir(), "unwrap-moss"),
      });
      stage = "session";
      const session = await client.session(`twin-smoke-${randomUUID()}`);
      const setupMs = performance.now() - start;
      const indexingStart = performance.now();
      stage = "index";
      await session.addDocs([
        { id: "pottery", text: "I'd love to learn wheel throwing and make bowls out of clay." },
        { id: "tennis", text: "I've been playing tennis every weekend." },
        { id: "running", text: "I'm training for a trail marathon." },
      ]);
      const indexingMs = performance.now() - indexingStart;
      const queryStart = performance.now();
      stage = "query";
      const result = await session.query("ceramics workshop", { topK: 1, alpha: 0.8 });
      return { ok: true as const, passed: result.docs[0]?.id === "pottery", setupMs, indexingMs, queryMs: performance.now() - queryStart };
    } catch (error) {
      const detail = error instanceof Error ? `${error.message} ${"detail" in error ? String(error.detail) : ""}` : "";
      const category = /read.only|permission|cache|directory/i.test(detail) ? "filesystem"
        : /unauthorized|credentials|401|403/i.test(detail) ? "authentication"
        : /download|network|http|timed/i.test(detail) ? "network"
        : /onnx|runtime|symbol|library/i.test(detail) ? "native_runtime" : "unknown";
      return { ok: false as const, reason: "moss_unavailable", stage, category };
    } finally {
      if (client) await client.close().catch(() => undefined);
    }
  },
});

export const vote = internalAction({
  args: { collaboratorId: v.id("agentCollaborators"), uploadId: v.string(), refs: v.optional(v.array(v.string())) },
  handler: async (ctx, args): Promise<TwinVoteCast[]> => {
    const snap = await ctx.runQuery(internal.giftTwin.agent.snapshot, args);
    if (!snap || snap.ideas.length === 0) return [];
    const messages = await loadVaultMessages(ctx, { collaboratorId: args.collaboratorId, uploadId: args.uploadId }, snap.chunkIds);
    if (messages.length === 0) return [];
    let recalled: ReadonlyMap<string, VaultMessage[]> | undefined;
    if (mossConfigured()) {
      // Native SDK stays out of Convex's default runtime and client bundles.
      let client: import("@moss-js/moss").MossClient | undefined;
      try {
        const setupStart = performance.now();
        prepareModelCache();
        const { MossClient } = await import("@moss-js/moss");
        client = new MossClient(process.env.MOSS_PROJECT_ID!, process.env.MOSS_PROJECT_KEY!, {
          cachePath: join(tmpdir(), "unwrap-moss"),
        });
        // Session names appear in provider usage telemetry. Never use identity,
        // room IDs, upload IDs, or private text. Never push/save the session.
        const session = await client.session(`twin-${randomUUID()}`);
        const setupMs = performance.now() - setupStart;
        const result = await recallIdeaEvidence(session, snap.ideas, messages, snap.recipientName);
        recalled = result.evidence;
        console.info("gift_twin_memory", {
          provider: "moss", setupMs, indexingMs: result.indexingMs,
          messageCount: messages.length, indexedMessages: result.indexedMessages, queryMs: result.queryMs, failedQueries: result.failedQueries,
        });
      } catch {
        console.info("gift_twin_memory", { provider: "keyword", reason: "moss_unavailable" });
      } finally {
        // Closing the client also closes every session, including on failures.
        // Cleanup errors must not stop the room's existing evaluation path.
        if (client) await client.close().catch(() => {
          console.info("gift_twin_memory", { reason: "cleanup_failed" });
        });
      }
    }
    // Consent may have expired or been revoked during embedding. Recheck before
    // the model request; recordFindings fences the later write as well.
    const current = await ctx.runQuery(internal.giftTwin.agent.snapshot, args);
    if (!current) return [];
    const unchanged = new Map(snap.ideas.map((idea) => [idea.ref, idea.text]));
    const ideas = current.ideas.filter((idea) => unchanged.get(idea.ref) === idea.text);
    return castVotes(ideas, messages, current.recipientName, modelConfigured() ? configuredModel() : undefined, recalled);
  },
});
