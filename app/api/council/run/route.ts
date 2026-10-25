/**
 * Starts an AI Council run for the /council page (server-only).
 *
 * Creates the run in Convex, then asks the Fetch.ai coordinator to work on
 * it; progress arrives through Convex events, not this response. Secrets stay
 * on the server. Memory ids are stable per demo session, so resubmitting the
 * same memory reuses its charm instead of adding a duplicate.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const bodySchema = z.strictObject({
  demoKey: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),
  memories: z.array(z.string().trim().min(3).max(600)).min(1).max(6),
});

const AGENT_TIMEOUT_MS = 8_000;

function env() {
  const site = process.env.CONVEX_SITE_URL;
  const ingest = process.env.COUNCIL_INGEST_SECRET;
  const agentUrl = process.env.FETCH_AGENT_URL ?? "http://127.0.0.1:8001";
  const agentSecret = process.env.COUNCIL_AGENT_SECRET;
  return site && ingest && agentSecret ? { site: site.replace(/\/$/, ""), ingest, agentUrl: agentUrl.replace(/\/$/, ""), agentSecret } : null;
}

async function convexPost(site: string, secret: string, path: string, body: unknown) {
  return fetch(`${site}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6_000),
  });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return Response.json({ ok: false, error: "Open a gift room to ask the council." }, { status: 403 });
  const cfg = env();
  if (!cfg) {
    return Response.json(
      { ok: false, error: "The council isn't configured on this server. Set CONVEX_SITE_URL, COUNCIL_INGEST_SECRET and COUNCIL_AGENT_SECRET (see .env.example), or use the sample replay." },
      { status: 503 },
    );
  }
  let parsed: z.infer<typeof bodySchema>;
  try {
    const result = bodySchema.safeParse(await request.json());
    if (!result.success) return Response.json({ ok: false, error: result.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    parsed = result.data;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const runId = "run_" + randomBytes(10).toString("hex");
  const memories = parsed.memories.map((text) => ({
    memoryId: "mem_" + createHash("sha256").update(`${parsed.demoKey}\n${text.toLowerCase()}`).digest("hex").slice(0, 20),
    text,
  }));

  try {
    const created = await convexPost(cfg.site, cfg.ingest, "/council/runs", { runId, source: "web", demoKey: parsed.demoKey });
    if (!created.ok) return Response.json({ ok: false, error: "Convex refused the run. Check COUNCIL_INGEST_SECRET on both sides." }, { status: 502 });
  } catch {
    return Response.json({ ok: false, error: "Couldn't reach Convex. Check the network, or use the sample replay." }, { status: 504 });
  }

  try {
    const res = await fetch(`${cfg.agentUrl}/council/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: cfg.agentSecret, runId, demoKey: parsed.demoKey, ...(/^https:\/\/[a-z0-9-]+\.convex\.site$/.test(cfg.site) && { callbackSite: cfg.site }), memories }),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? `agent HTTP ${res.status}`);
  } catch (err) {
    // Record the failure so the council shows it (and the run never hangs in "running").
    await convexPost(cfg.site, cfg.ingest, "/council/events", {
      eventId: "ev_" + randomBytes(10).toString("hex"),
      runId,
      actor: "courier",
      task: "deliver_recommendations",
      status: "failed",
      sequence: 0,
      timestamp: Date.now(),
      result: { error: "The Fetch.ai coordinator is not reachable. Start it with `python agent.py`." },
    }).catch(() => undefined);
    return Response.json({ ok: false, runId, error: `The Fetch.ai coordinator didn't accept the run (${String((err as Error).message).slice(0, 80)}). Is it running?` }, { status: 502 });
  }

  return Response.json({ ok: true, runId, memoryIds: memories.map((m) => m.memoryId) });
}
