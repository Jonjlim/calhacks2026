/**
 * Apify adapter. Server actions only; token never belongs in Convex documents.
 * No POST retries: a transport timeout may have created a paid run.
 */
import { z } from "zod";
import type { SearchBrief } from "../../lib/contracts";

/**
 * automation-lab's Google Shopping scraper (D24): one row per product with the store's own link.
 * Replaced johnvc's actor, whose free-plan monthly allowance ($1) ran out mid-session.
 * Unverified until a live run succeeds; no build is pinned yet, so the actor's default build runs.
 */
export const VERIFIED_ACTOR = "automation-lab~google-shopping-scraper";
/** Products asked for per search; the run's charge cap below covers this many. */
export const SHOPPING_MAX_RESULTS = 20;
export const PROVIDER_DEADLINE_MS = 180_000;
export const PROVIDER_MAX_RESPONSE_BYTES = 750_000;
export type ProviderResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "failed" | "uncertain"; message: string };

const providerId = z.string().regex(/^[a-zA-Z0-9]{1,100}$/);
const runSchema = z.object({
  id: providerId,
  status: z.string(),
  defaultDatasetId: providerId.optional(),
});
export type ProviderRun = z.infer<typeof runSchema>;
const envelopeSchema = z.object({ data: runSchema });

export function createProvider(token: string, fetcher: typeof fetch = fetch) {
  async function request(path: string, method = "GET", body?: unknown): Promise<ProviderResult<unknown>> {
    if (!token.trim()) return { kind: "failed", message: "Product source credentials are not configured." };
    if (!/^[\x21-\x7e]{1,1024}$/.test(token)) return { kind: "failed", message: "Product source credentials are invalid." };
    try {
      const response = await fetcher("https://api.apify.com/v2/" + path, {
        method, redirect: "error",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return {
        kind: response.status >= 500 || response.status === 408 ? "uncertain" : "failed",
        message: "Product source returned HTTP " + response.status + ".",
      };
      const reader = response.body?.getReader();
      if (!reader) return { kind: "uncertain", message: "Product source returned an empty response." };
      const decoder = new TextDecoder();
      let size = 0, text = "";
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > PROVIDER_MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return { kind: "uncertain", message: "Product source response exceeded its supported size." };
        }
        text += decoder.decode(part.value, { stream: true });
      }
      try { return { kind: "ok", value: JSON.parse(text + decoder.decode()) as unknown }; }
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
      // One complete direction per run; do not combine unrelated hobbies/styles.
      const q = (brief.queryTerms.map(term => term.trim()).find(Boolean) ?? "").slice(0, 200);
      if (!q) return Promise.resolve({ kind: "failed", message: "Publish an interest or wish before searching." });
      // About $0.04 per run plus about $0.011 per product: 20 products stay under the $0.40 cap.
      return runRequest("acts/" + VERIFIED_ACTOR + "/runs?timeout=120&maxTotalChargeUsd=0.40",
      "POST", {
        queries: [q], country: "us", language: "en", maxResults: SHOPPING_MAX_RESULTS,
        ...(brief.budgetMinor !== undefined && brief.budgetMinor > 0
          ? { maxPrice: brief.budgetMinor / 100 } : {}),
      });
    },
    async getRun(runId: string): Promise<ProviderResult<ProviderRun>> {
      if (!providerId.safeParse(runId).success) return { kind: "failed", message: "Invalid product source run ID." };
      const result = await runRequest("actor-runs/" + runId);
      return result.kind === "ok" && result.value.id !== runId
        ? { kind: "uncertain", message: "Product source returned a different run." }
        : result;
    },
    getDataset(datasetId: string): Promise<ProviderResult<unknown>> {
      if (!providerId.safeParse(datasetId).success) return Promise.resolve({ kind: "failed", message: "Invalid product source dataset ID." });
      return request("datasets/" + datasetId + "/items?clean=true&limit=50");
    },
  };
}
