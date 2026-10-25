import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { appleDateToMs, decodeAttributedBody, readMessages } from "../src/imessage.ts";

function typedstream(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const prefix = new TextEncoder().encode("\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString");
  const header = [0x01, 0x94, 0x84, 0x01, 0x2b];
  const length = body.length < 0x80 ? [body.length] : [0x81, body.length & 0xff, body.length >> 8];
  return new Uint8Array([...prefix, ...header, ...length, ...body, 0x86, 0x84]);
}

test("decodes short and long attributedBody strings", () => {
  assert.equal(decodeAttributedBody(typedstream("I love matcha")), "I love matcha");
  const long = "trail ".repeat(40).trim();
  assert.equal(decodeAttributedBody(typedstream(long)), long);
  assert.equal(decodeAttributedBody(new Uint8Array([1, 2, 3])), null);
  assert.equal(decodeAttributedBody(null), null);
});

test("converts both Apple date encodings", () => {
  const seconds = 700_000_000;
  assert.equal(appleDateToMs(seconds), (seconds + 978_307_200) * 1000);
  assert.equal(appleDateToMs(BigInt(seconds) * 1_000_000_000n), (seconds + 978_307_200) * 1000);
});

test("reads text and attributedBody rows, skipping tapbacks and old messages", () => {
  const dir = mkdtempSync(join(tmpdir(), "twin-"));
  const path = join(dir, "chat.db");
  try {
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, is_from_me INTEGER, date INTEGER, associated_message_type INTEGER, handle_id INTEGER);
             CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);`);
    const now = Date.now();
    const apple = (ms: number) => BigInt(Math.floor(ms / 1000) - 978_307_200) * 1_000_000_000n;
    const insert = db.prepare("INSERT INTO message (ROWID, text, attributedBody, is_from_me, date, associated_message_type) VALUES (?, ?, ?, ?, ?, ?)");
    insert.run(1, "I love trail running", null, 1, apple(now - 1000), 0);
    insert.run(2, null, typedstream("I just got a new Kindle"), 1, apple(now - 500), 0);
    insert.run(3, "Loved “I love trail running”", null, 0, apple(now - 400), 2000);
    insert.run(4, "ancient", null, 1, apple(now - 400 * 86_400_000), 0);
    db.prepare("INSERT INTO chat_message_join VALUES (?, ?)").run(7, 1);
    db.close();
    const result = readMessages({ path, sinceMs: now - 30 * 86_400_000 });
    assert.ok(result.ok, JSON.stringify(result));
    if (!result.ok) return;
    assert.deepEqual(result.messages.map((m) => [m.text, m.fromMe, m.chatId]), [
      ["I love trail running", true, 7],
      ["I just got a new Kindle", true, 0],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stops at the byte budget, keeping only the newest messages", () => {
  const dir = mkdtempSync(join(tmpdir(), "twin-"));
  const path = join(dir, "chat.db");
  try {
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, is_from_me INTEGER, date INTEGER, associated_message_type INTEGER);
             CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);`);
    const insert = db.prepare("INSERT INTO message (ROWID, text, attributedBody, is_from_me, date, associated_message_type) VALUES (?, ?, NULL, 1, ?, 0)");
    const base = Math.floor(Date.now() / 1000) - 978_307_200 - 10_000;
    for (let i = 1; i <= 100; i++) insert.run(i, `message ${String(i).padStart(3, "0")} ${"x".repeat(88)}`, base + i);
    db.close();
    const result = readMessages({ path, maxBytes: 1_000 });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.messages.length, 10);
    assert.equal(result.stats.truncated, true);
    assert.ok(result.stats.bytesRead <= 1_000);
    assert.match(result.messages[0]!.text, /^message 091/);
    assert.match(result.messages.at(-1)!.text, /^message 100/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reports a missing database without throwing", () => {
  const result = readMessages({ path: "/nonexistent/chat.db" });
  assert.equal(result.ok, false);
});
