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

## Candidate result reported by Alex

Alex ran the candidate check and supplied `allPassed: true` for
`zai-org/GLM-5.3-Flash`: source-linked extraction 1315 ms, grounded selection
1036 ms, image discrimination 827 ms. Reported usage totaled 555 input and 422
output tokens. This is user-supplied run evidence, not an independently executed
live call by this agent; no bill/cost or broader reliability claim follows.

## Next check — actual Unwrap adapter and schemas

From the same worktree and existing `.env.bitdeer.local`, run:

```sh
node --env-file=.env.bitdeer.local scripts/bitdeer-app-check.mts --run
```

The runner scopes Bitdeer's key/endpoint/model to the child test process only.
It runs Dev 3's existing live tests without modifying them: extraction with
application source references, grounded buyer recommendation, and permitted
recipient response. One additional opt-in check calls the real `readPhoto` and
`proposePhotoClues` functions with a generated unmarked image, validating the
real photo schema, no unmarked recipient activity and uncertain clue handling.
A blank/no-gift-relevant observation is legitimate for this shape fixture. This
is **not** a test of real-photo activity/style accuracy; a consented or suitable
synthetic scene should still be exercised in the app before the demo.

There are four checks and at most eight paid requests including the existing
single schema-repair retry. Each request uses the app's normal 20-second timeout
and a 2400-token requested limit. No Convex, Apify, Stripe, real-user-data or
application state writes occur. No deployment/environment file is changed.

Unlike the first standalone check, this uses the **unchanged application
transport**, including `max_completion_tokens`. No test-only token-parameter
translation is hidden in the runner. A full pass would establish that this model
accepts those current requests; if it fails, inspect sanitized failures with Dev 3
before changing the provider adapter or shared deployment. Do not assume the
parameter must change merely because the documentation examples differ.

Offline verification of the new runner: two Node tests passed (isolated config,
missing credentials/model refusal); invoking without `--run` sent no requests;
the four live checks skip by default. Frontend and Convex TypeScript checks pass.
No live application-level Bitdeer check has been run by this agent.
