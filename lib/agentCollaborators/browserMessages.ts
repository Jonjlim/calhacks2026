import type { SqlJsStatic } from "sql.js";
import { appleDateToMs, decodeAttributedBody } from "./imessageText";
import { TWIN_LIMITS, type VaultMessage } from "./contracts";
import type { LocalMessage } from "../../gift-twin/src/types";
import { planUpload } from "../../gift-twin/src/upload";

const CONTENT_BUDGET = TWIN_LIMITS.messageReadMaxBytes;
export const DATABASE_MAX_BYTES = 512 * 1024 * 1024;
let reader: Promise<SqlJsStatic> | undefined;

export function loadBrowserSqlite(): Promise<SqlJsStatic> {
  if (!reader) reader = new Promise<SqlJsStatic>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/api/gift-twin/sqlite/sql-wasm.js";
    script.onload = () => {
      const init = (window as Window & { initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic> }).initSqlJs;
      if (!init) return reject(new Error("The local message reader could not start. Reload and try again."));
      init({ locateFile: (file) => `/api/gift-twin/sqlite/${file}` }).then(resolve, reject);
    };
    script.onerror = () => reject(new Error("The local message reader could not load. Check your connection and try again."));
    document.head.append(script);
  }).catch((error: unknown) => { reader = undefined; throw error; });
  return reader;
}

/** Matches the CLI read budget, then uses its unchanged upload preparation. */
export function readBrowserMessages(SQL: SqlJsStatic, bytes: Uint8Array): { messages: VaultMessage[]; truncated: boolean } {
  const db = new SQL.Database(bytes);
  try {
    const rows = db.prepare(`SELECT m.ROWID, m.text, m.attributedBody, m.is_from_me,
      CASE WHEN m.date > 1000000000000 THEN m.date / 1000000000 ELSE m.date END AS sent,
      COALESCE(cmj.chat_id, 0)
      FROM message m LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      WHERE COALESCE(m.associated_message_type, 0) = 0 ORDER BY m.ROWID DESC`);
    const messages: LocalMessage[] = [];
    let used = 0;
    let truncated = false;
    try {
      while (rows.step()) {
        const [id, text, body, fromMe, date, chatId] = rows.get();
        const blob = body instanceof Uint8Array ? body : undefined;
        const size = (typeof text === "string" ? new TextEncoder().encode(text).byteLength : 0) + (blob?.byteLength ?? 0);
        if (used + size > CONTENT_BUDGET) { truncated = true; break; }
        used += size;
        const raw = typeof text === "string" ? text : decodeAttributedBody(blob) ?? "";
        const clean = raw.replace(/\uFFFC/g, "").trim().slice(0, 2_000);
        if (clean) messages.push({ id: Number(id), text: clean, fromMe: fromMe === 1, sentAt: appleDateToMs(Number(date)), chatId: Number(chatId) });
      }
    } finally { rows.free(); }
    return { messages: planUpload(messages.reverse()).messages, truncated };
  } finally { db.close(); }
}
