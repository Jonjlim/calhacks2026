# AGENTS.md

Instructions for humans and coding agents working on Unwrap.

Unwrap is a four-person Cal Hacks project. Read this file before editing. The product spec lives in [docs/PRODUCT.md](docs/PRODUCT.md). Shared interfaces live in [docs/CONTRACTS.md](docs/CONTRACTS.md). Original brainstorming is in [PLAN.md](PLAN.md) and is **not** the implementation spec.

## Project purpose

Build a collaborative, evidence-backed gift studio. Friends (or one person) gather clues about a recipient, research real products, choose one gift, and approve a versioned contribution proposal.

A successful end-to-end demo beats a larger feature list.

## Architectural rules

1. **One product, one engine.** Solo and group gifting share rooms, clues, research, and proposals. Do not fork a second app.
2. **Convex is authoritative for application state.** Stripe (if enabled) is authoritative for payment objects. LLMs are not a source of truth.
3. **Keep the system small.** Next.js + Convex + one LLM + one product source. No extra databases, queues, or microservices unless a documented blocker requires them.
4. **Deterministic code owns money, membership, and permissions.** AI may interpret, ask, search, and explain. AI may not authorize payments, publish clues, change contribution caps, or approve revisions.
5. **Two consent flows stay separate.** Contributor-published clues are not recipient-authorized private data. See [docs/DATA_AND_PRIVACY.md](docs/DATA_AND_PRIVACY.md).
6. **No silent product or price claims.** Listings need a source URL, observed price, currency, and retrieval timestamp. If a field is unknown, store `unknown` — do not invent it.
7. **P0 must run without P1.** Recipient-agent negotiation and Stripe sandbox payments are optional. Do not make the core room depend on them.
8. **Contracts before features.** Change [docs/CONTRACTS.md](docs/CONTRACTS.md) first, then implementation. Do not invent parallel types.

## Source organization

Plan this layout when implementation starts. Do not create it in a docs-only change.

```text
app/                      # Next.js App Router — Dev 1
components/               # UI — Dev 1
  chat/
  clues/
  map/
  products/
  proposal/
lib/
  contracts/              # Shared types generated from docs/CONTRACTS.md
  money.ts                # Integer minor-unit helpers — Dev 2
  validation.ts           # Shared Zod schemas
convex/
  schema.ts               # Dev 2
  rooms.ts                # Dev 2
  messages.ts             # Dev 2
  clues.ts                # Dev 2 writes; Dev 3 produces payloads
  proposals.ts            # Dev 2
  allocations.ts          # Dev 2
  agents/                 # Dev 3
  research/               # Dev 4
  payments/               # Dev 2 state machine + Dev 4 Stripe adapter
```

Stay inside the TypeScript ecosystem. The one exception is the Fetch.ai council coordinator in `fetch-agent/` (Python, recorded in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)); Convex stays authoritative for everything it touches. Any other Python service is rejected unless a real multi-item optimizer appears, which is out of P0/P1 scope.

## Room flow (Phase 2)

The room is map-first (D19 in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)): lobby in front of the present → zoom out → the gift map, where all sharing, themes, research, votes, the box, and approvals happen. Do not add new features to the tower, the Backstage drawer, or the separate `/map` page; they are leaving the main path. Plan and milestones: [docs/EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md).

## TypeScript conventions

- Strict TypeScript. No `any` on shared contracts.
- Prefer named exports.
- Money is `integer` minor units (`amountMinor`) plus an ISO currency code. P0 currency is `USD` only.
- IDs are branded strings in docs and should become Convex `Id<"table">` at implementation time.
- Discriminated unions for status fields (`kind`, `status`, `decision`).
- Functions that can fail return a result object or a typed error — do not throw across the client/Convex boundary for expected cases.

## Shared contract conventions

- The Markdown schemas in [docs/CONTRACTS.md](docs/CONTRACTS.md) are the source of names, fields, and status enums.
- Owning developer updates the contract doc in the same PR as the code change.
- Consuming developers may mock the contract, not reshape it.
- Additive optional fields are allowed. Renames and semantic changes need a team check at the next integration checkpoint.
- Zod schemas must reject unknown required fields and strip or refuse unexpected secrets.

## Privacy rules

- Raw imported messages are visible only to the uploading participant and to the extraction action running **as that participant**.
- Proposed clues stay with the contributor until they publish.
- Published clues are room-visible and must not smuggle raw private transcripts unless the contributor opted to attach an excerpt.
- Recipient-authorized preferences are readable only by recipient-agent tools after a policy check. The buyer agent never receives a “read all recipient messages” tool.
- Contribution limits are readable by the owner and by server-side allocation code. Other participants see their own share and feasibility, not others’ caps.
- System prompts are not an access-control layer. Enforce access in Convex auth checks and tool allowlists.
- Treat model output as untrusted. Validate with Zod. Never execute model-suggested mutations that fail authorization.

Details: [docs/DATA_AND_PRIVACY.md](docs/DATA_AND_PRIVACY.md).

## Tool and API boundaries

| Caller | Allowed | Forbidden |
| --- | --- | --- |
| Buyer agent | Read room-visible state, propose clues, request research, ask the policy-gated recipient endpoint | Read private imports, caps, or recipient raw profile; take payment actions |
| Recipient agent | Read recipient-authorized preference records for that recipient | Read buyer chat, unpublished clues, contribution caps, or payment records |
| Research actions | Call the one approved product API / Apify actor | Scrape logged-in or paywalled content; invent listings |
| Payment adapter (P1) | Stripe test-mode APIs via server actions | Raw card data; LLM-triggered capture |

Do not add a new external API without updating [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and marking it `unverified` until a spike succeeds.

## Input validation

- Validate all mutations at the Convex boundary.
- Chat and import text have size limits. Reject empty rooms, unknown currencies, and negative money.
- Clue extraction output must match the `ProposedClue` schema before insert.
- Product payloads must include `sourceUrl` and `retrievedAt`. Drop the listing if they are missing.
- Agent-to-agent bodies are structured JSON only. Free-text from an agent is a `rationale`, not a command.

## Error handling

- Expected failures are typed: `unauthorized`, `not_found`, `invalid_revision`, `infeasible`, `stale_job`, `provider_timeout`, `validation_failed`, `refused`, `unknown`.
- External calls record a job row in `pending` *before* the provider request.
- Timeouts leave the job `uncertain` until reconcile — never assume success.
- UI must show failed research, infeasible proposals, and pending recovery as first-class states. Animation cannot invent success.

## Database access

- All reads/writes go through Convex queries and mutations with membership checks.
- Use indexes for `roomId` and `revisionId`. Do not scan the whole table in queries.
- Never store secrets, raw cards, or provider webhook signing keys in documents the client can subscribe to.
- Soft-delete imported messages and recompute dependent proposed clues. Do not leave published clues pointing at deleted private text without a tombstone.

## Dependency management

- Add a dependency only if an owned workstream needs it this weekend.
- Lock versions. Do not introduce a second LLM SDK, a second CSS framework, or a second database client.
- Environment variables stay out of git. Do not create `.env` files in docs-only work.

## Testing expectations

- Dev 2: allocation arithmetic, approval invalidation, authorization rules.
- Dev 3: Zod validation of model output; policy denials for recipient-agent tools.
- Dev 4: listing normalization; job idempotency; Stripe adapter tests only if P1-B is active.
- Dev 1: exercise the happy path and the failure states in the browser, not only screenshots.
- Prefer fixtures and recorded API responses over live calls in unit tests.

## Changing shared interfaces

1. Edit [docs/CONTRACTS.md](docs/CONTRACTS.md).
2. Note the owner, consumers, and migration in the PR.
3. Update mocks used by other workstreams in the same change or immediately after.
4. Do not leave two names for the same concept (`GiftRoom` vs `Room`, `cap` vs `limit`).

## Working in a four-person repository

- Own your directories. Touch shared files (`convex/schema.ts`, `lib/contracts/*`) in small PRs and tell the consumers.
- Do not “while I’m here” refactor another workstream.
- Branch from `main` as `dev1/...`, `dev2/...`, `dev3/...`, `dev4/...`, or `shared/...`.
- Keep PRs reviewable. Pair on schema, allocation, and anything that crosses privacy or money.
- If you are blocked, implement against the mock in CONTRACTS.md. Do not invent a private protocol.

## Unrelated files

Do not modify [PLAN.md](PLAN.md). Do not rewrite docs you were not asked to change. Do not add application scaffolding during a documentation task.

## Architectural changes

If you add a service, change an authority boundary, promote a P2 feature into P0, or merge the two consent flows, update the relevant doc in the same PR and record the decision in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Silent architecture drift is a bug.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
