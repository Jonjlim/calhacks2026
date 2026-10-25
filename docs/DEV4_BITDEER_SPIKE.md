# Bitdeer candidate-model check

Status: **prepared and offline-tested; live model capability unverified**.
Owner: Dev 4 standalone spike. Dev 3 owns the application adapter and prompts.
No application configuration or deployment has changed.

## Run locally

From the `dev4/phase2-payments` worktree, create the git-ignored
`.env.bitdeer.local` in an editor:

```dotenv
BITDEER_API_KEY=your_key_entered_privately
BITDEER_MODEL=zai-org/GLM-5.3-Flash
```

Run:

```sh
node --env-file=.env.bitdeer.local scripts/bitdeer-check.mts --run
```

This explicitly starts at most **three paid calls**, serially, with no retries.
Each has a 20-second timeout and requests at most 1600 output tokens. Actual
pricing/usage is the provider's authority. No real user data, room/database writes,
Apify calls, Stripe calls, deployment reads or secret downloads occur. Without
`--run`, the script only prints help and sends no requests. Never commit the key.

Allowed candidates also include `deepseek-ai/DeepSeek-V4.1-Flash-1017` and
`Qwen/Qwen3.8-27B`; change only BITDEER_MODEL for a deliberate comparison.

## Meaning of results

- Text: extracts interest, ownership and exclusion with the supplied source ID.
- Grounding: selects the supplied affordable, relevant synthetic gift instead of
  an owned kit or unaffordable wheel, citing a supplied clue.
- Vision: distinguishes two generated test images (colors and shapes) sent as
  inline PNGs. No private photograph or external image is sent.
- Every case validates strict JSON content and reports elapsed milliseconds and
  usage when available. Raw model output, provider error bodies and keys are not
  printed. Failed/unfinished/oversized/invalid responses do not retry.

All passed means these three candidate-provider examples passed. This is not
proof of general model quality, real-photo activity/style extraction, semantic
privacy handling, full application schemas or deployed room behavior. Test those
with synthetic or consented examples through Dev 3's actual extraction pipeline
before switching the team's deployment.

## Compatibility boundary

Bitdeer's documented base is `https://api-inference.bitdeer.ai/v1`; this script
fixes that HTTPS host and uses `max_tokens`, JSON object output and base64 image
content. Our current application adapter sends `max_completion_tokens` and may
send `reasoning_effort`. This standalone check deliberately does not edit Alan's
adapter or assume those parameters are accepted. Passing results still require
Dev 3's small adapter/config review and existing live schema smoke tests.

References: [API](https://developers.bitdeer.ai/docs/api),
[JSON output](https://developers.bitdeer.ai/docs/guides/llm/structured-outputs),
[image input](https://developers.bitdeer.ai/docs/guides/llm/vision),
[models](https://developers.bitdeer.ai/docs/api/models-catalog).

## Verification performed

`node --test scripts/bitdeer-check.test.mts`: **5 passed** offline, covering valid
requests, fixed host/token parameter, image payloads, malformed answers, sanitized
provider failures, missing credentials and unexpected model IDs. Running the
script without `--run` confirmed that it prints help and makes no requests.
No real key was read and no live Bitdeer call has been made by this work.
