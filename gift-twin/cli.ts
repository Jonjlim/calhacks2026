#!/usr/bin/env node
/**
 * Unwrap Gift Twin: the recipient's Mac companion. It pairs this Mac with a
 * gift room, then, with the recipient's one-time permission, uploads the
 * messages they sent to a temporary vault in Unwrap. The cloud twin agent
 * reads them there, posts gift ideas, and votes on the room's ideas until
 * the vault expires (24 hours) or the recipient runs `forget`.
 *
 *   npm run twin -- pair <CODE>        connect this Mac to a gift room
 *   npm run twin -- share [--fixture]  ask for permission and upload once
 *   npm run twin -- forget             delete the uploaded messages now
 *   npm run twin -- status | doctor | unpair
 *
 * Only the most recent 3 MB of iMessage content is read (--max-mb to
 * change), and only messages the recipient sent are uploaded: never other
 * people's messages, phone numbers, emails, chat names, or attachments.
 */
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import type { TwinVaultView } from "../lib/agentCollaborators/contracts.ts";
import { deviceApi } from "./src/api.ts";
import { clearState, loadConfig, saveConfig, type TwinConfig } from "./src/config.ts";
import { fixtureMessages } from "./src/fixture.ts";
import { DEFAULT_MAX_BYTES, readMessages, type ReadResult } from "./src/imessage.ts";
import type { LocalMessage } from "./src/types.ts";
import { planUpload } from "./src/upload.ts";

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    fixture: { type: "boolean", default: false },
    days: { type: "string" },
    "max-mb": { type: "string" },
    yes: { type: "boolean", short: "y", default: false },
    "dry-run": { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const say = (line = "") => process.stdout.write(`${line}\n`);
const fail = (line: string): never => {
  process.stderr.write(`✗ ${line}\n`);
  process.exit(1);
};

function requireConfig(): TwinConfig {
  return loadConfig() ?? fail("This Mac is not paired yet. Run: npm run twin -- pair <CODE>");
}

function unwrap<T>(res: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!res.ok) return fail(res.error.message);
  return res.value;
}

function loadMessages(): ReadResult {
  if (flags.fixture) return { ok: true, messages: fixtureMessages(), stats: { bytesRead: 0, rowsScanned: 0, truncated: false } };
  const maxMb = flags["max-mb"] === undefined ? DEFAULT_MAX_BYTES / (1024 * 1024) : Number(flags["max-mb"]);
  if (!Number.isFinite(maxMb) || maxMb <= 0) fail("--max-mb must be a positive number.");
  const days = flags.days === undefined ? undefined : Number(flags.days);
  if (days !== undefined && (!Number.isFinite(days) || days <= 0)) fail("--days must be a positive number.");
  return readMessages({
    maxBytes: Math.round(maxMb * 1024 * 1024),
    ...(days !== undefined ? { sinceMs: Date.now() - days * 86_400_000 } : {}),
  });
}

function describeRead(result: Extract<ReadResult, { ok: true }>): string {
  if (flags.fixture) return "sample messages";
  const mb = (result.stats.bytesRead / (1024 * 1024)).toFixed(1);
  return `the most recent ${mb} MB of Messages${result.stats.truncated ? " (older history skipped)" : ""}`;
}

function requireMessages(): LocalMessage[] {
  const result = loadMessages();
  if (!result.ok) return fail(`${result.message}\n  Tip: add --fixture to try the demo with sample messages.`);
  say(`Read ${result.messages.length} messages from ${describeRead(result)}.`);
  return result.messages;
}

async function confirm(question: string): Promise<boolean> {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) fail("Run interactively to give permission, or pass --yes.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function describeVault(vault: TwinVaultView | undefined): string {
  if (!vault) return "nothing uploaded";
  switch (vault.status) {
    case "uploading":
      return `upload in progress (${vault.messageCount} messages so far)`;
    case "processing":
      return `${vault.messageCount} messages, twin is reading them`;
    case "ready":
      return `${vault.messageCount} messages, deleted ${vault.expiresAt ? new Date(vault.expiresAt).toLocaleString() : "soon"}`;
    case "expired":
      return "messages deleted";
  }
}

async function pair(code: string | undefined) {
  if (!code) fail("Usage: npm run twin -- pair <CODE>");
  const url = flags.url ?? process.env.GIFT_TWIN_CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return fail("Pass --url https://<deployment>.convex.cloud (or set GIFT_TWIN_CONVEX_URL).");
  const deviceToken = randomBytes(32).toString("base64url");
  const http = new ConvexHttpClient(url);
  const session = unwrap(await http.mutation(deviceApi.pair, { pairingCode: code!, deviceToken, deviceLabel: hostname().replace(/\.local$/, "") }));
  saveConfig({
    convexUrl: url,
    deviceToken,
    collaboratorId: session.collaboratorId,
    recipientName: session.recipientDisplayName,
    occasion: session.occasion,
    pairedAt: Date.now(),
  });
  say(`✓ Connected. This Mac is now ${session.recipientDisplayName}'s Gift Twin (${session.occasion}).`);
  say("  Next: npm run twin -- share    (add --fixture to use sample messages)");
}

async function share(config: TwinConfig) {
  const plan = planUpload(requireMessages());
  const kb = Math.max(1, Math.round(plan.chars / 1024));
  say("");
  say(`Your Gift Twin would upload ${plan.messages.length} messages you sent (${kb} KB of text) to Unwrap.`);
  say("  • Only messages you sent. Never other people's messages, phone numbers, emails, chat names, or attachments.");
  say("  • Kept in a private vault for 24 hours, then deleted. Nobody in the gift room can read them.");
  say("  • Your twin, an AI agent acting for you, reads them with Unwrap's AI model provider. It adds gift ideas to the");
  say("    room as short notes and votes up or down on your friends' ideas, including new ones, until the vault closes.");
  say("  • Delete them sooner with: npm run twin -- forget");
  if (flags.verbose) for (const m of plan.messages.slice(-5)) say(`    e.g. ${m.text.slice(0, 80)}`);
  if (plan.messages.length === 0) return say("\nNo messages you sent were found, so there is nothing to upload.");
  if (flags["dry-run"]) return say("\n(dry run: nothing was uploaded)");
  if (!(await confirm("\nUpload these messages to your Gift Twin for 24 hours?"))) return say("Nothing was uploaded.");

  const http = new ConvexHttpClient(config.convexUrl);
  const started = unwrap(await http.mutation(deviceApi.startUpload, { deviceToken: config.deviceToken, consent: true }));
  for (const [index, batch] of plan.batches.entries()) {
    unwrap(await http.mutation(deviceApi.uploadMessages, { deviceToken: config.deviceToken, uploadId: started.uploadId, messages: batch }));
    if (plan.batches.length > 1) say(`  uploaded ${index + 1}/${plan.batches.length}`);
  }
  const done = unwrap(await http.mutation(deviceApi.finishUpload, { deviceToken: config.deviceToken, uploadId: started.uploadId }));
  saveConfig({ ...config, lastSharedAt: Date.now() });
  say(`✓ Uploaded ${done.messageCount} messages. Your twin is reading them now and will vote on new room ideas until ${new Date(done.expiresAt).toLocaleString()}.`);
}

async function forget(config: TwinConfig) {
  const http = new ConvexHttpClient(config.convexUrl);
  unwrap(await http.mutation(deviceApi.forget, { deviceToken: config.deviceToken }));
  say("✓ Your uploaded messages are deleted. Notes already in the room stay; the twin stays connected.");
}

async function status() {
  const config = loadConfig();
  if (!config) return say("Not paired.");
  const http = new ConvexHttpClient(config.convexUrl);
  const res = await http.query(deviceApi.session, { deviceToken: config.deviceToken });
  say(`${config.recipientName}'s Gift Twin · ${config.occasion}`);
  say(`  deployment: ${config.convexUrl}`);
  say(`  paired:     ${new Date(config.pairedAt).toLocaleString()}`);
  say(`  connection: ${res.ok ? "active" : res.error.message}`);
  if (res.ok) say(`  vault:      ${describeVault(res.value.vault)}`);
}

async function unpair() {
  const config = loadConfig();
  if (config) {
    const http = new ConvexHttpClient(config.convexUrl);
    await http.mutation(deviceApi.disconnect, { deviceToken: config.deviceToken }).catch(() => undefined);
  }
  clearState();
  say("✓ Disconnected, deleted your uploaded messages, and removed local Gift Twin data.");
}

function doctor() {
  const [major] = process.versions.node.split(".").map(Number);
  say(`node ${process.versions.node} ${major! >= 23 ? "✓" : "✗ (needs 23.6+ for TypeScript and node:sqlite)"}`);
  const result = readMessages({ maxBytes: 256 * 1024 });
  say(result.ok ? `messages ✓ (${result.messages.length} recent messages readable)` : `messages ✗ ${result.message}`);
  say(loadConfig() ? "paired ✓" : "paired ✗ (run: npm run twin -- pair <CODE>)");
}

async function main() {
  const [command, arg] = positionals;
  if (flags.help || !command) {
    say("Usage: npm run twin -- <pair CODE | share | forget | status | doctor | unpair> [--fixture] [--max-mb 3] [--days N] [--yes] [--dry-run] [--verbose]");
    return;
  }
  switch (command) {
    case "pair":
      return pair(arg);
    case "share":
    case "run": // older name
      return share(requireConfig());
    case "forget":
      return forget(requireConfig());
    case "status":
      return status();
    case "doctor":
      return doctor();
    case "unpair":
      return unpair();
    default:
      fail(`Unknown command "${command}".`);
  }
}

await main();
