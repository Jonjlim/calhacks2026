import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";


/** Only serves the pinned local reader. No recipient files reach this route. */
export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  if (asset !== "sql-wasm.js" && asset !== "sql-wasm.wasm") return new Response(null, { status: 404 });
  const data = asset === "sql-wasm.js"
    ? await readFile(join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.js"))
    : await readFile(join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"));
  return new Response(data, { headers: {
    "Content-Type": asset.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  } });
}
