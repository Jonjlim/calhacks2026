/** Synthetic local-session spike. Never reads a recipient vault or pushes an index. */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MossClient } from "@moss-js/moss";

async function main() {
  if (!process.argv.includes("--run")) {
    console.log("Run with --run and MOSS_PROJECT_ID/MOSS_PROJECT_KEY, or add --convex-env to read the current dev deployment's secrets in memory. Uses synthetic text only; no cloud index is created.");
    return;
  }
  let projectId = process.env.MOSS_PROJECT_ID;
  let projectKey = process.env.MOSS_PROJECT_KEY;
  if (process.argv.includes("--convex-env")) {
    const read = (name: string) => execFileSync(process.execPath, ["node_modules/convex/bin/main.js", "env", "get", name], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000,
    }).trim();
    projectId = read("MOSS_PROJECT_ID");
    projectKey = read("MOSS_PROJECT_KEY");
  }
  if (!projectId || !projectKey) throw new Error("missing_credentials");
  const client = new MossClient(projectId, projectKey, { cachePath: join(tmpdir(), "unwrap-moss-smoke") });
  try {
    const setupStart = performance.now();
    const session = await client.session(`twin-smoke-${randomUUID()}`);
    const setupMs = performance.now() - setupStart;
    const indexingStart = performance.now();
    await session.addDocs([
      { id: "pottery", text: "I'd love to learn wheel throwing and make my own bowls out of clay." },
      { id: "owns", text: "I already have a Kindle Paperwhite, so I don't need another e-reader." },
      { id: "dislike", text: "I can't stand scented candles. Please don't buy me any." },
      { id: "tennis", text: "I've been playing tennis every weekend." },
      { id: "coffee", text: "I love making espresso with freshly ground coffee beans." },
      { id: "running", text: "I'm training for a trail marathon and need a hydration vest." },
      { id: "knitting", text: "I've been knitting a wool scarf." },
      { id: "camera", text: "My camera needs a new tripod for landscape photography." },
    ]);
    const indexingMs = performance.now() - indexingStart;
    const checks = [
      { name: "semantic_paraphrase", query: "ceramics workshop", expectedId: "pottery" },
      { name: "ownership", query: "Kindle Paperwhite", expectedId: "owns" },
      { name: "dislike", query: "scented candle gift", expectedId: "dislike" },
    ];
    const results = [];
    for (const check of checks) {
      const started = performance.now();
      const result = await session.query(check.query, { topK: 3, alpha: 0.8 });
      results.push({ name: check.name, passed: result.docs[0]?.id === check.expectedId,
        queryMs: performance.now() - started, hitIds: result.docs.map((doc) => doc.id) });
    }
    console.log(JSON.stringify({ provider: "moss", setupMs, indexingMs, results }, null, 2));
    if (results.some((result) => !result.passed)) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch(() => {
  // SDK/CLI errors can contain credentials. Print only an allowlisted message.
  console.error("Moss smoke failed: check credentials, network access and native SDK/model support. Provider details withheld.");
  process.exitCode = 1;
});
