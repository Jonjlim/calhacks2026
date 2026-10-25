import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMessages } from "../../gift-twin/src/imessage";
import { planUpload } from "../../gift-twin/src/upload";
import { beforeAll, describe, expect, it } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { readBrowserMessages } from "./browserMessages";

let SQL: SqlJsStatic;
beforeAll(async () => { SQL = await initSqlJs(); });

function database() {
  const db = new SQL.Database();
  db.run("CREATE TABLE message (text TEXT, attributedBody BLOB, date INTEGER, is_from_me INTEGER, associated_message_type INTEGER)");
  db.run("CREATE TABLE chat_message_join (message_id INTEGER, chat_id INTEGER)");
  return db;
}

describe("recipient browser Messages reader", () => {
  it("returns only sent text and time, excluding incoming messages and tapbacks", () => {
    const db = database();
    try {
      db.run("INSERT INTO message VALUES (?, NULL, ?, ?, ?)", ["I want a pottery class", 700_000_000, 1, 0]);
      db.run("INSERT INTO message VALUES (?, NULL, ?, ?, ?)", ["someone else's secret", 700_000_001, 0, 0]);
      db.run("INSERT INTO message VALUES (?, NULL, ?, ?, ?)", ["Liked a message", 700_000_002, 1, 2000]);
      const result = readBrowserMessages(SQL, db.export());
      expect(result.messages).toEqual([{ text: "I want a pottery class", sentAt: (700_000_000 + 978_307_200) * 1000 }]);
      expect(result.truncated).toBe(false);
    } finally { db.close(); }
  });

  it("bounds recent content, truncates individual text, and preserves chronological order", () => {
    const db = database();
    try {
      const insert = db.prepare("INSERT INTO message VALUES (?, NULL, ?, 1, 0)");
      for (let i = 0; i < 5; i++) insert.run([`${i}${"x".repeat(600_000)}`, 700_000_000 + i]);
      insert.free();
      const result = readBrowserMessages(SQL, db.export());
      expect(result.truncated).toBe(true);
      expect(result.messages.map((message) => message.text[0])).toEqual(["4"]);
      expect(result.messages.every((message) => message.text.length === 2000)).toBe(true);
    } finally { db.close(); }
  });

  it("matches the actual CLI upload, counting incoming bytes in the same 1 MiB budget", () => {
    const db = database();
    const dir = mkdtempSync(join(tmpdir(), "unwrap-browser-parity-"));
    try {
      db.run("INSERT INTO message VALUES (?, NULL, ?, 1, 0)", ["old ".repeat(40_000), 700_000_000]);
      db.run("INSERT INTO message VALUES (?, NULL, ?, 1, 0)", ["my therapist mentioned pottery " + "x".repeat(300_000), 700_000_001]);
      db.run("INSERT INTO message VALUES (?, NULL, ?, 0, 0)", ["incoming ".repeat(77_777), 700_000_002]);
      const bytes = db.export();
      const path = join(dir, "chat.db");
      writeFileSync(path, bytes);
      const cli = readMessages({ path });
      expect(cli.ok).toBe(true);
      if (!cli.ok) throw new Error(cli.message);
      const browser = readBrowserMessages(SQL, bytes);
      expect(browser.truncated).toBe(cli.stats.truncated);
      expect(browser.messages).toEqual(planUpload(cli.messages).messages);
      expect(browser.messages).toHaveLength(1);
      // Sensitive text is sent unchanged to the private vault, as in the CLI.
      // Screening applies later to agent notes shared with the room.
      expect(browser.messages[0]?.text).toContain("my therapist mentioned pottery");
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("rejects unrelated databases without returning any data", () => {
    const db = new SQL.Database();
    try { expect(() => readBrowserMessages(SQL, db.export())).toThrow(); }
    finally { db.close(); }
  });
});
