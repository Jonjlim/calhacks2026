/** Fixed public-style Apify source. No recipient/account/profile queries. */
import { z } from "zod";
import type { ProviderResult } from "./provider";
import { PROVIDER_MAX_RESPONSE_BYTES } from "./provider";
import { STYLE_SEED_TERMS } from "../../lib/research/styleCategories";

export const FASHION_ACTOR = "xmolodtsov~tiktok-search-scraper";
export const FASHION_BUILD = "0.1.39";
export const FASHION_DEADLINE_MS = 210_000;
const idSchema = z.string().regex(/^[a-zA-Z0-9]{1,100}$/);
const runSchema = z.object({ data: z.object({ id: idSchema, status: z.enum([
  "READY", "RUNNING", "SUCCEEDED", "FAILED", "TIMING-OUT", "TIMED-OUT", "ABORTING", "ABORTED",
]), defaultDatasetId: idSchema.optional() }) });
export type FashionRun = z.infer<typeof runSchema>["data"];

export function createFashionProvider(token: string, fetcher: typeof fetch = fetch) {
  async function request(path: string, body?: unknown): Promise<ProviderResult<unknown>> {
    if (!/^[\x21-\x7e]{1,1024}$/.test(token)) return { kind: "failed", message: "Fashion source credentials are not configured correctly." };
    try {
      const response = await fetcher(`https://api.apify.com/v2/${path}`, {
        method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) return { kind: response.status >= 500 || [408, 409, 429].includes(response.status) ? "uncertain" : "failed", message: `Fashion source returned HTTP ${response.status}.` };
      const reader = response.body?.getReader();
      if (!reader) return { kind: "uncertain", message: "Fashion source returned no response body." };
      let size = 0, text = "";
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > PROVIDER_MAX_RESPONSE_BYTES) { await reader.cancel(); return { kind: "uncertain", message: "Fashion source response exceeded its supported size." }; }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return { kind: "ok", value: JSON.parse(text + decoder.decode()) as unknown };
    } catch { return { kind: "uncertain", message: "Fashion source response was interrupted. Reconcile the existing run before retrying." }; }
  }
  async function run(path: string, body?: unknown, expectedId?: string): Promise<ProviderResult<FashionRun>> {
    const result = await request(path, body);
    if (result.kind !== "ok") return result;
    const parsed = runSchema.safeParse(result.value);
    if (!parsed.success || (expectedId && parsed.data.data.id !== expectedId)) return { kind: "uncertain", message: "Fashion source returned an invalid or mismatched run." };
    return { kind: "ok", value: parsed.data.data };
  }
  return {
    start(seedTerm: string): Promise<ProviderResult<FashionRun>> {
      if (!STYLE_SEED_TERMS.has(seedTerm)) return Promise.resolve({ kind: "failed", message: "Only reviewed public style searches are enabled." });
      return run(`acts/${FASHION_ACTOR}/runs?build=${FASHION_BUILD}&timeout=180&memory=1024&maxTotalChargeUsd=0.50`, {
        keywords: [seedTerm], maxItems: 20, maxItemsPerKeyword: 20, sortType: "DATE_POSTED",
        uniqueAuthors: true, expansion: [], commentsPerPost: 0, includeAuthorProfile: false,
      });
    },
    getRun(id: string) {
      return idSchema.safeParse(id).success ? run(`actor-runs/${id}`, undefined, id)
        : Promise.resolve({ kind: "failed" as const, message: "Invalid fashion run ID." });
    },
    getDataset(id: string) {
      return idSchema.safeParse(id).success ? request(`datasets/${id}/items?clean=true&limit=20`)
        : Promise.resolve({ kind: "failed" as const, message: "Invalid fashion dataset ID." });
    },
  };
}
