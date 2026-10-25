/*
 * Dates are converted to seconds in SQL: modern nanosecond values exceed
 * Number.MAX_SAFE_INTEGER and node:sqlite refuses to return them as numbers.
 */
/**
 * Read-only access to the local Messages database (~/Library/Messages/chat.db).
 * Requires Full Disk Access for the terminal that runs the companion. Only
 * message text, direction, time and an opaque chat number are read; handles
 * (phone numbers, emails) and attachments are never selected.
 */
import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LocalMessage } from "./types.ts";

const APPLE_EPOCH_S = 978_307_200;
const MAX_TEXT_CHARS = 2_000;

export function defaultChatDbPath(): string {
  return join(homedir(), "Library", "Messages", "chat.db");
}

/** Messages stores either seconds or nanoseconds since 2001-01-01 depending on macOS version. */
export function appleDateToMs(value: number | bigint): number {
  const n = typeof value === "bigint" ? Number(value) : value;
  const seconds = n > 1e12 ? n / 1e9 : n;
  return Math.round((seconds + APPLE_EPOCH_S) * 1000);
}

const NSSTRING = new TextEncoder().encode("NSString");

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Newer macOS versions leave `message.text` empty and keep the body in a
 * typedstream `attributedBody` blob. The plain string follows the NSString
 * class marker, five header bytes, and a length prefix (one byte, or 0x81
 * followed by a little-endian uint16).
 */
export function decodeAttributedBody(blob: Uint8Array | null | undefined): string | null {
  if (!blob || blob.length === 0) return null;
  const at = indexOf(blob, NSSTRING);
  if (at < 0) return null;
  let i = at + NSSTRING.length + 5;
  if (i >= blob.length) return null;
  let length = blob[i]!;
  i += 1;
  if (length === 0x81) {
    if (i + 2 > blob.length) return null;
    length = blob[i]! | (blob[i + 1]! << 8);
    i += 2;
  } else if (length === 0x82) {
    if (i + 3 > blob.length) return null;
    length = blob[i]! | (blob[i + 1]! << 8) | (blob[i + 2]! << 16);
    i += 3;
  }
  if (length <= 0 || i + length > blob.length) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(blob.subarray(i, i + length));
}

/** Demo budget: only the most recent 3 MB of message content is read. */
export const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;

export interface ReadOptions {
  path?: string;
  /** Optional extra cutoff; the byte budget is the main limit. */
  sinceMs?: number;
  /** Stored content (text plus attributedBody) read, newest first, before stopping. */
  maxBytes?: number;
}

export interface ReadStats {
  bytesRead: number;
  rowsScanned: number;
  /** True when the byte budget stopped the scan before older messages. */
  truncated: boolean;
}

export type ReadResult =
  | { ok: true; messages: LocalMessage[]; stats: ReadStats }
  | { ok: false; reason: "no_access" | "not_found" | "unreadable"; message: string };

const NO_ACCESS = "macOS blocked access to Messages. Give your terminal Full Disk Access in System Settings → Privacy & Security, then try again.";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

/** SQLite reports a privacy (TCC) block as "unable to open", so check with fs first to tell it apart from a missing file. */
function probe(path: string): ReadResult | null {
  try {
    accessSync(path, constants.R_OK);
    return null;
  } catch (error) {
    const code = errorCode(error);
    if (code === "EPERM" || code === "EACCES") return { ok: false, reason: "no_access", message: NO_ACCESS };
    try {
      readdirSync(dirname(path));
    } catch (dirError) {
      const dirCode = errorCode(dirError);
      if (dirCode === "EPERM" || dirCode === "EACCES") return { ok: false, reason: "no_access", message: NO_ACCESS };
    }
    return { ok: false, reason: "not_found", message: `No Messages database at ${path}. Is iMessage set up on this Mac?` };
  }
}

export function readMessages(options: ReadOptions): ReadResult {
  const path = options.path ?? defaultChatDbPath();
  const blocked = probe(path);
  if (blocked) return blocked;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/authoriz|permission|not permitted|EPERM/i.test(text))
      return { ok: false, reason: "no_access", message: NO_ACCESS };
    if (/unable to open|no such file|ENOENT/i.test(text))
      return { ok: false, reason: "not_found", message: `No Messages database at ${path}. Is iMessage set up on this Mac?` };
    return { ok: false, reason: "unreadable", message: "The Messages database could not be opened." };
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  try {
    // ROWID order streams newest-first from the primary key, so iteration can
    // stop at the byte budget without SQLite sorting the whole history first.
    const rows = db
      .prepare(
        `SELECT m.ROWID AS id, m.text AS text, m.attributedBody AS body, m.is_from_me AS fromMe,
                (CASE WHEN m.date > 1000000000000 THEN m.date / 1000000000 ELSE m.date END) AS date,
                COALESCE(cmj.chat_id, 0) AS chatId
           FROM message m
           LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
          WHERE COALESCE(m.associated_message_type, 0) = 0
          ORDER BY m.ROWID DESC`,
      )
      .iterate() as unknown as IterableIterator<{
        id: number;
        text: string | null;
        body: Uint8Array | null;
        fromMe: number;
        date: number;
        chatId: number;
      }>;
    const sinceMs = options.sinceMs ?? 0;
    const messages: LocalMessage[] = [];
    const stats: ReadStats = { bytesRead: 0, rowsScanned: 0, truncated: false };
    for (const row of rows) {
      const size = (row.text ? Buffer.byteLength(row.text, "utf8") : 0) + (row.body?.byteLength ?? 0);
      if (stats.bytesRead + size > maxBytes) {
        stats.truncated = true;
        break;
      }
      stats.bytesRead += size;
      stats.rowsScanned += 1;
      const sentAt = appleDateToMs(row.date);
      // ROWID is only roughly chronological (synced history can arrive late), so skip rather than stop.
      if (sentAt < sinceMs) continue;
      const text = (row.text ?? decodeAttributedBody(row.body) ?? "").replace(/\uFFFC/g, "").trim();
      if (!text) continue;
      messages.push({ id: row.id, text: text.slice(0, MAX_TEXT_CHARS), fromMe: row.fromMe === 1, sentAt, chatId: row.chatId });
    }
    return { ok: true, messages: messages.reverse(), stats };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (process.env.GIFT_TWIN_DEBUG) process.stderr.write(`readMessages: ${text}\n`);
    if (/authoriz|permission/i.test(text))
      return { ok: false, reason: "no_access", message: NO_ACCESS };
    return { ok: false, reason: "unreadable", message: "The Messages database has an unexpected format." };
  } finally {
    db.close();
  }
}
