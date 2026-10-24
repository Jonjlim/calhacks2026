# Agent model setup and cost

Recommendation recorded October 24, 2026: start with **GPT-5.4 mini** for all roles, subject to the credentialed smoke test. The model supports Chat Completions and structured outputs; reasoning effort can be `none`. The existing adapter needs no additional SDK, model vendor, database, or agent hosting service. Availability in the team's account has not been verified.

Official references: [model capabilities and rates](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [API pricing](https://developers.openai.com/api/docs/pricing), [spend controls](https://developers.openai.com/api/docs/guides/spend-limits).

## Configure the server

In the team's Convex deployment environment, set:

- `LLM_BASE_URL`: `https://api.openai.com/v1`
- `LLM_MODEL`: `gpt-5.4-mini`
- `LLM_API_KEY`: the project's API key, entered through the dashboard/secret tooling. Never use a `NEXT_PUBLIC_` key or commit it.
- `LLM_MAX_OUTPUT_TOKENS`: `2400` initially; permitted range 256–8192.
- `LLM_REASONING_EFFORT`: `none` for this starting model. Omit this field for a different provider unless supported.

Use a dedicated API project with billing or usable promotional credits and a small provider spend limit. Existing account credit eligibility must be checked in the API billing dashboard. This implementation does not buy credits, provision billing, or run live calls automatically.

The transport uses JSON mode and strict local schema/reference validation. A truncated/malformed response retries once; HTTP and uncertain payment/source calls are not automatically repeated. All roles use this one configuration. Upgrade/split models only if measured extraction or planning failures justify it.

## Example cost, not a forecast

The model page lists standard text rates of **$0.75 per million input tokens** and **$4.50 per million output tokens** as of the date above. At those rates, a call with 5,000 uncached input tokens and 500 billed output tokens costs:

`5,000 × $0.75 / 1,000,000 + 500 × $4.50 / 1,000,000 = $0.006`.

Three to six such calls cost about $0.018–$0.036 in model usage. This is an illustrative input-size assumption, not an estimate from a live Unwrap run. Longer context, schema overhead, retries, and reasoning output can increase usage. Cached input has separate pricing. Scraping/source retrieval is billed separately. A $5–$10 initial development allowance is a suggested budget, not a guaranteed total.

Each completed/failed attempt records dispatched HTTP calls and available provider token metadata. `reportedCalls < calls` means usage is incomplete; zero recorded tokens does not imply free execution. The acting member can inspect these counts in the activity query. Counts are diagnostics; the provider's billing view establishes charges.

## Deliberate live verification

The default test suite makes no live model calls. To test the adapter, export the model variables into a trusted **local process environment**, using the local secret mechanism for the API key, and run:

```sh
npm run agents:smoke
```

This explicitly enables three tests using synthetic data: extraction, grounded buyer selection, and a permissioned recipient response. Each may retry malformed output once, so up to six API calls are possible. The command does not pull deployment secrets into the shell, does not publish data, does not call Apify, and does not modify a room. A passing smoke test verifies the model/adapter contract; it does not establish a deployed end-to-end application.

Afterward, configure the same settings on Convex, regenerate/deploy the functions through the normal team workflow, and exercise the live room/research path with two users. Frontend authentication/subscriptions are still required before that app-level check can pass.
