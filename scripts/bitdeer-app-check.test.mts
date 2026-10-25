import { test } from "node:test";
import assert from "node:assert/strict";
import { bitdeerAppEnvironment } from "./bitdeer-app-check.mts";

test("scopes Bitdeer to the child test process and removes inherited provider options", () => {
  const original = { BITDEER_API_KEY:"fixture-secret", LLM_BASE_URL:"https://other.example/v1", LLM_API_KEY:"other-secret", LLM_REASONING_EFFORT:"high" };
  const result = bitdeerAppEnvironment(original);
  assert.equal(result.LLM_BASE_URL,"https://api-inference.bitdeer.ai/v1");
  assert.equal(result.LLM_MODEL,"zai-org/GLM-5.3-Flash");
  assert.equal(result.LLM_API_KEY,"fixture-secret");
  assert.equal(result.LLM_REASONING_EFFORT,"");
  assert.equal(result.LLM_MAX_OUTPUT_TOKENS,"2400");
  assert.equal(original.LLM_API_KEY,"other-secret");
  assert.equal(result.UNWRAP_BITDEER_APP_SMOKE,"1");
  assert.equal(result.UNWRAP_LIVE_AGENT_SMOKE,"1");
});
test("refuses missing credentials and unexpected models without exposing values", () => {
  assert.throws(()=>bitdeerAppEnvironment({}),/No request was sent/);
  assert.throws(()=>bitdeerAppEnvironment({BITDEER_API_KEY:"private-value",BITDEER_MODEL:"unknown"}), error => error instanceof Error && !error.message.includes("private-value"));
});
