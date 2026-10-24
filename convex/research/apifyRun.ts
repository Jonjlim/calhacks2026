/** Shared bounded Apify run client. One POST per start; no automatic retries. */
import { z } from "zod";
import type { ProviderResult } from "./provider";
import { PROVIDER_MAX_RESPONSE_BYTES } from "./provider";

export const apifyIdSchema = z.string().regex(/^[a-zA-Z0-9]{1,100}$/);
const runSchema = z.object({ data: z.object({ id: apifyIdSchema, status: z.enum([
  "READY", "RUNNING", "SUCCEEDED", "FAILED", "TIMING-OUT", "TIMED-OUT", "ABORTING", "ABORTED",
]), defaultDatasetId: apifyIdSchema.optional() }) });
export type ApifyRun = z.infer<typeof runSchema>["data"];

/** `label` names the source in user-facing errors, e.g. "Fashion source". */
export function createApifyRunClient(token: string, label: string, fetcher: typeof fetch = fetch) {
  async function request(path: string, body?: unknown): Promise<ProviderResult<unknown>> {
    if (!/^[\x21-\x7e]{1,1024}$/.test(token)) return { kind: "failed", message: `${label} credentials are not configured correctly.` };
    try {
      const response = await fetcher(`https://api.apify.com/v2/${path}`, {
        method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) return { kind: response.status >= 500 || [408, 409, 429].includes(response.status) ? "uncertain" : "failed", message: `${label} returned HTTP ${response.status}.` };
      const reader = response.body?.getReader();
      if (!reader) return { kind: "uncertain", message: `${label} returned no response body.` };
      let size = 0, text = "";
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > PROVIDER_MAX_RESPONSE_BYTES) { await reader.cancel(); return { kind: "uncertain", message: `${label} response exceeded its supported size.` }; }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return { kind: "ok", value: JSON.parse(text + decoder.decode()) as unknown };
    } catch { return { kind: "uncertain", message: `${label} response was interrupted. Reconcile the existing run before retrying.` }; }
  }
  async function run(path: string, body?: unknown, expectedId?: string): Promise<ProviderResult<ApifyRun>> {
    const result = await request(path, body);
    if (result.kind !== "ok") return result;
    const parsed = runSchema.safeParse(result.value);
    if (!parsed.success || (expectedId && parsed.data.data.id !== expectedId)) return { kind: "uncertain", message: `${label} returned an invalid or mismatched run.` };
    return { kind: "ok", value: parsed.data.data };
  }
  return {
    startRun(path: string, body: unknown): Promise<ProviderResult<ApifyRun>> { return run(path, body); },
    getRun(id: string): Promise<ProviderResult<ApifyRun>> {
      return apifyIdSchema.safeParse(id).success ? run(`actor-runs/${id}`, undefined, id)
        : Promise.resolve({ kind: "failed" as const, message: "Invalid source run ID." });
    },
    getDataset(id: string, limit: number): Promise<ProviderResult<unknown>> {
      return apifyIdSchema.safeParse(id).success ? request(`datasets/${id}/items?clean=true&limit=${limit}`)
        : Promise.resolve({ kind: "failed" as const, message: "Invalid source dataset ID." });
    },
  };
}
