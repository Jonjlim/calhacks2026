/**
 * Apify adapter. Server actions only; token never belongs in Convex documents.
 * No POST retries: a transport timeout may have created a paid run.
 */
import { z } from "zod";
import type { SearchBrief } from "../../lib/contracts";

export const VERIFIED_ACTOR = "johnvc~google-shopping-api-google-shopping-products-prices-deals";
export const VERIFIED_BUILD = "0.0.142";
export const PROVIDER_DEADLINE_MS = 180_000;
export type ProviderResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "failed" | "uncertain"; message: string };

const runSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9]+$/),
  status: z.string(),
  defaultDatasetId: z.string().regex(/^[a-zA-Z0-9]+$/).optional(),
});
export type ProviderRun = z.infer<typeof runSchema>;
const envelopeSchema = z.object({ data: runSchema });

export function createProvider(token: string, fetcher: typeof fetch = fetch) {
  async function request(path: string, method = "GET", body?: unknown): Promise<ProviderResult<unknown>> {
    if (!token.trim()) return { kind: "failed", message: "Product source credentials are not configured." };
    try {
      const response = await fetcher("https://api.apify.com/v2/" + path, {
        method,
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return {
        kind: response.status >= 500 || response.status === 408 ? "uncertain" : "failed",
        message: "Product source returned HTTP " + response.status + ".",
      };
      try { return { kind: "ok", value: await response.json() }; }
      catch { return { kind: "uncertain", message: "Product source response could not be decoded." }; }
    } catch {
      return { kind: "uncertain", message: "Product source request timed out or lost its connection." };
    }
  }
  async function runRequest(path: string, method?: string, body?: unknown): Promise<ProviderResult<ProviderRun>> {
    const result = await request(path, method, body);
    if (result.kind !== "ok") return result;
    const parsed = envelopeSchema.safeParse(result.value);
    return parsed.success ? { kind: "ok", value: parsed.data.data }
      : { kind: "uncertain", message: "Product source returned an invalid run response." };
  }
  return {
    start(brief: SearchBrief): Promise<ProviderResult<ProviderRun>> {
      const q = brief.queryTerms.map(term => term.trim()).filter(Boolean).join(" ").slice(0, 200);
      if (!q) return Promise.resolve({ kind: "failed", message: "Publish an interest or wish before searching." });
      return runRequest("acts/" + VERIFIED_ACTOR
        + "/runs?build=" + VERIFIED_BUILD + "&timeout=120&maxTotalChargeUsd=0.20",
      "POST", {
        q, gl: "us", hl: "en", max_pages: 1,
        ...(brief.budgetMinor !== undefined && brief.budgetMinor > 0
          ? { max_price: brief.budgetMinor / 100 } : {}),
      });
    },
    getRun(runId: string): Promise<ProviderResult<ProviderRun>> {
      return runRequest("actor-runs/" + encodeURIComponent(runId));
    },
    getDataset(datasetId: string): Promise<ProviderResult<unknown>> {
      return request("datasets/" + encodeURIComponent(datasetId) + "/items?clean=true&limit=50");
    },
  };
}
