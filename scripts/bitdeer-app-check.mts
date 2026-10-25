/** Explicit local checks of Unwrap's unmodified model adapter and application schemas. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const defaultModel = "zai-org/GLM-5.3-Flash";
const models = new Set([defaultModel, "deepseek-ai/DeepSeek-V4.1-Flash-1017", "Qwen/Qwen3.8-27B"]);
export function bitdeerAppEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const key = input.BITDEER_API_KEY?.trim();
  const model = input.BITDEER_MODEL ?? defaultModel;
  if (!key || !models.has(model)) throw new Error("Set BITDEER_API_KEY privately and select a supported BITDEER_MODEL. No request was sent.");
  return { ...input,
    UNWRAP_LIVE_AGENT_SMOKE: "1", UNWRAP_BITDEER_APP_SMOKE: "1",
    LLM_BASE_URL: "https://api-inference.bitdeer.ai/v1", LLM_API_KEY: key, LLM_MODEL: model,
    LLM_MAX_OUTPUT_TOKENS: "2400", LLM_REASONING_EFFORT: "",
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--run")) {
    console.log("Unwrap + Bitdeer application check. Uses credits: 4 tests, at most 8 model requests including schema repair.\nRun: node --env-file=.env.bitdeer.local scripts/bitdeer-app-check.mts --run\nNo requests were sent.");
  } else {
    try {
      const env = bitdeerAppEnvironment(process.env);
      console.log(`Checking ${env.LLM_MODEL} through Unwrap's unchanged application adapter.\nText extraction, grounded recommendation, recipient answer, and synthetic-image photo-schema checks.\nAt most 8 paid requests; no deployment, Convex, Apify, Stripe or real user-data calls.\n`);
      const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)),
        "run", "convex/agents/live-smoke.test.ts", "convex/research/bitdeer-photo-live.test.ts", "--reporter=verbose"], {
        cwd: fileURLToPath(new URL("../", import.meta.url)), env, stdio: "inherit",
      });
      if (result.error) { console.error("Local test runner could not start. Check repository dependencies."); process.exitCode = 1; }
      else process.exitCode = result.status ?? 1;
    } catch { console.error("Set BITDEER_API_KEY privately and select a supported BITDEER_MODEL. No request was sent."); process.exitCode = 1; }
  }
}
