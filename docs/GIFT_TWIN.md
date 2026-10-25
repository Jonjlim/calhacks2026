# Gift Twin

A personal AI agent that knows the gift recipient. The recipient pairs their Mac with the gift room and gives **one-time permission** to upload the messages they sent. The twin then joins the room as an **AI collaborator**, next to the human friends. It posts gift ideas it found and **votes up or down** on the friends' ideas, both the ones already in the room and new ones added while its 24-hour vault is open. There are no questions back and forth, and no manual approve step in the room.

Status: **demo**, behind `GIFT_TWIN_DEMO_ENABLED=true`. Decision record: D20 in [ARCHITECTURE.md](ARCHITECTURE.md). Interfaces: "Agent collaborators and the Gift Twin" in [CONTRACTS.md](CONTRACTS.md).

## How it fits Unwrap

```mermaid
sequenceDiagram
  participant R as Recipient's Mac (gift-twin)
  participant C as Convex
  participant T as Twin agent (acts for the recipient)
  participant B as Unwrap gift agent
  participant F as Friends (room UI)

  F->>C: createPairing (organizer)
  C-->>F: 8-character code, 15 min
  R->>C: device.pair(code, locally generated token)
  R->>R: read chat.db, keep only messages the recipient sent
  R->>R: recipient agrees to a one-time 24 h upload
  R->>C: startUpload(consent) → uploadMessages × n → finishUpload
  C->>T: agent.processVault (patterns, no model wait)
  T->>C: immediately record screened insights + explicit votes
  C->>B: deterministic review of those posts
  C-->>T: agent.enrichVault (model extras + unresolved votes independently)
  B->>C: insights → clues; downvotes → exclusion/ownership clues; upvotes → noted
  loop on room changes (200 ms wakeup), plus 30 s recovery watch
    C->>T: agent.checkIdeas → voteOnNewIdeas for ideas added since
  end
  C->>C: expireVault after 24 h (or forget / disconnect) deletes the messages
  C-->>F: "Room idea: Maya loves backpacking · ▼ Downvoted"
```

The twin does two things:

1. **Insights: gift ideas found in the messages.** Anything the recipient wants, likes, does, owns, or dislikes that a friend could turn into a gift. One clear mention is enough: "I've been playing tennis a lot" and "I've been wanting an Arc'teryx jacket" both count. Repetition only raises confidence. Things that are not giftable are skipped: "I love dinner", "I love you guys", "I just got home".
2. **Votes on the room's ideas.** For each clue, idea branch, and listing in the room, the twin looks for clear evidence in the recipient's messages. **Up** when they back it, **down** when they contradict it (friends say "Maya loves backpacking", she wrote "I hate backpacking, never again") or show she already owns it. An idea with no clear evidence gets no vote. Published memories, new idea branches, and completed listings wake the twin after 200 ms; evaluation then takes as long as the evidence/model work needs. A 30-second watch recovers missed changes.

What the gift agent (`review.reviewPosts`) does with them:

- **Insights** that pass the deterministic floor (medium or high confidence, categorized) are published as `manual` clues. Pattern-derived findings use immediate deterministic coherence/deduplication review. Model-generated additions still go through the model relevance review, which can only veto. Skipped insights are hidden.
- **Downvotes** become `exclusion` clues (she dislikes it) or `ownership` clues (she already has it), so research and the buyer agent steer away. The friend's original clue is left untouched.
- **Upvotes** are shown in the feed with no new clue.
- Published clues are attributed to the member who invited the twin, who can edit or withdraw them like any memory.

Other rules:

- **The twin is a collaborator, not a participant.** It has no contribution share and cannot select or approve. Its votes are advisory posts in its own feed and never count as participant votes.
- **One feed for every AI collaborator.** `agentCollaborators` / `agentCollaboratorPosts` are generic. The planned trend agent becomes `kind: "trend_scout"` and posts into the same feed with the same review step.

## Privacy model

| Data | Where it lives | Who sees it |
| --- | --- | --- |
| iMessage history | Recipient's Mac (`chat.db`, read-only; only the most recent 1 MB of content is read) | The companion process |
| Other people's messages, phone numbers, emails, chat names, attachments | Never uploaded | Nobody |
| Messages the recipient sent (text + time) | Convex `twinVaultChunks`, for at most 24 hours | Only the twin agent's internal functions, and the configured model provider during its calls. No person, not even the recipient's device, can read them back |
| Insights and votes (screened sentences) | Convex `agentCollaboratorPosts` | Room members |
| Device token | Mac config (0600); Convex stores only its SHA-256 | The device |

Safeguards:

1. **Explicit, one-time consent.** `share` shows what will be uploaded, for how long, and who reads it, then asks (unless `--yes`). `device.startUpload` refuses without `consent: true`.
2. **Minimal upload.** Only messages the recipient sent, as text and send time.
3. **Server-only vault.** No public or device query returns vaulted messages. Only `internal.giftTwin.agent.*` reads them, as the recipient's agent (model role `recipient`). The gift agent and the room see screened sentences only.
4. **Short life.** Deleted at 24 hours, on `npm run twin -- forget`, when either side disconnects, when a new upload replaces it, and on room deletion.
5. **Screening.** `screenSharedText` rejects quotes, links, contact details, and sensitive topics (health, religion, sexuality, politics, finances, legal, credentials). Every agent output is re-validated with Zod before insert. Prompts are not the control.
6. **Surprise.** The device never receives room ideas; voting happens in the cloud.

## Recipient page (no CLI)

Members can press **Send Gift Twin link** directly in the room controls or phone
view to create the recipient's single-use invitation. **Send link** opens the
device share sheet when available; otherwise it copies the link for the member
to send. A separate copy button and selectable URL support manual sharing. The
same controls are available in the twin studio. Only the recipient invitation
uses `/twin#invite=...`; the friend QR remains a `/join/...` link. Both use the
host page's actual origin, including its port, without a configured URL override.
Creating or sharing the link does not pair the recipient or grant data access.

Room members create the twin at `/room/<roomId>/twin` and copy its invitation link. The recipient opens it at `/twin`, reads and accepts the privacy terms, connects, then selects their own Mac's `~/Library/Messages/chat.db`. A bundled SQLite WASM reader follows the CLI's same read-and-upload pipeline. The “Choose Messages file” button opens the system file picker. Selecting the file after consent immediately uploads the messages through the companion's existing `planUpload`, with no added review or local preference extraction. The server removes emoji sequences before vault storage and skips emoji-only messages; the vault enforces a 1 MiB UTF-8 text limit. The recipient manages status, deletion, or disconnecting on the same page. Sample data is available and clearly labelled.

The browser cannot directly access iMessage or request automatic macOS database access. The recipient must select the file; macOS may prevent this. Files above 512 MB are refused to limit browser memory usage. The newest 1 MiB of message content is scanned, including incoming content in the read budget, exactly as in the CLI. The existing companion preparation then uploads only sent messages, with the same 2,000-character limit per message. This reads the database snapshot only; recent messages in the separate SQLite WAL may be absent. Use the CLI if the database cannot be selected or a complete live snapshot is required. Real macOS file-selection compatibility remains unverified.

The single-use invite is in a URL fragment and is cleared from the address bar after loading. Opening it alone never consumes it. Device credentials are kept in tab session storage; messages are kept only in memory. Reload restores management access in the same tab. Closing the tab loses that access, but the server still deletes the vault at expiry. Delete and disconnect do not remove already posted room notes. No new service or provider is added.

## Run the CLI demo

### Moss semantic memory

The twin uses explicit pattern evidence first, then Moss hybrid retrieval for
unresolved room ideas. “Ceramics workshop” can recall “I'd love to learn
wheel throwing” even with no keyword overlap. Explicit keyword matches are kept
alongside semantic matches so ownership and contradictions remain available. The
existing recipient model decides what the evidence means; Moss does not reason
or authorize anything. Initial pattern extraction scans the authorized vault and
records findings before any model call. Model enrichment runs independently in
the background. The buyer/council agents get only the existing screened posts and clues.

Moss embeds at most 256 distinct messages per evaluation. Gift/preference-bearing
messages take priority, with both recent and older messages represented. Full-vault
keyword checks retain explicit ownership and contradiction evidence. This caps
embedding work; a semantic-only match outside the selected working set may be
missed. No private index is retained between actions. On a local synthetic
2,048-message benchmark, indexing dropped from 2,196 ms to 309 ms (about 7×),
and the old pottery preference remained the top match. This measures indexing,
not end-to-end model or shopping-provider latency.

The optimized version was deployed to dev `shiny-dotterel-658`. One live synthetic
three-message check measured the first published finding at 518 ms after starting
`finishUpload`, and a reviewed vote on a newly published contradictory message at
790 ms, including client/network time. The temporary room was deleted afterward.
These exercise the deterministic fast path; model-only matches, large uploads and
shopping-provider time have separate latency. Repeat without real recipient data:

```bash
node --env-file-if-exists=.env.local scripts/gift-twin-latency-smoke.mts --run
# Compare full-vault vs bounded Moss indexing (synthetic messages only):
node scripts/moss-memory-smoke.mts --run --convex-env --benchmark
```

Set these **on the Convex deployment**, then deploy the updated functions:

```bash
npx convex env set GIFT_TWIN_MOSS_ENABLED true
# Set MOSS_PROJECT_ID and MOSS_PROJECT_KEY privately in the Convex dashboard.
# Existing LLM_* configuration supplies the reasoning model.
npx convex dev --once
```

No changes to recipient pairing or uploads are required. Each evaluation builds
an isolated in-memory local session from the current authorized upload and closes
it in `finally`. Messages and query text are never pushed to a Moss cloud index or
saved as a disk snapshot. Moss does authenticate/download its embedding model and
send usage telemetry (random session names, counts, timings, SDK/model versions,
device ID). The SDK's cache contains provider artifacts/device identity, not vault
snapshots. Raw retrieved evidence is available only to the recipient model; the
room sees screened sentences. Consent is rechecked before the model call and at
the final write. Expiry, forget, replacement upload, revoke, and room deletion
invalidate old work. Missing configuration or SDK failure retains keyword recall.

Synthetic live smoke (uses no room data and creates no cloud index):

```bash
node scripts/moss-memory-smoke.mts --run --convex-env
# Or omit --convex-env and supply MOSS_PROJECT_ID / MOSS_PROJECT_KEY in the process environment.
```

The `--convex-env` option captures credentials from the current dev deployment
only in process memory; the script never prints them or provider error bodies.
The local macOS spike with SDK 1.21.0 passed paraphrase, ownership, and dislike
top-hit checks over eight synthetic messages: query times 1.3–2.0 ms, indexing
12.5 ms, cold setup/model loading 23.3 seconds. These are a small local sample,
not an application latency guarantee. Native packaging and a synthetic paraphrase
probe also passed on development deployment `shiny-dotterel-658`: setup 2.25 s,
indexing 27.1 ms, retrieval 4.1 ms over three synthetic messages. Moss memory is
enabled on that deployment. The full live room-to-model path and model answer
quality still need a recipient-consented room demo; production is not deployed.
The SDK is externalized in `convex.json` for its native dependency.

Convex substitutes a JavaScript `process.env` object, while the native SDK reads
the OS environment. Initialization uses Node's `loadEnvFile` with an immediately
deleted temporary file containing only `MOSS_MODEL_CACHE_DIR` pointing to `/tmp`.
No secret is written to it. This keeps native model artifacts off the read-only
filesystem without changing the process home directory.

To repeat the synthetic Convex runtime probe:

```bash
npx convex run giftTwin/memory:smoke '{}'
```

Server logs emit `gift_twin_memory` with numeric `setupMs`, `indexingMs`, and
per-query `queryMs`, or a fixed fallback reason. They contain no private text,
room/upload identifiers or credentials. A session is rebuilt for each evaluation;
there is no cross-action private cache. At larger vault sizes indexing, rather
than retrieval, may dominate. Run the synthetic smoke before a demo to exercise
model download; this does not prewarm a separate Convex worker.

### Companion demo

Prerequisites: Node 23.6+ (uses built-in TypeScript stripping and `node:sqlite`), a Convex deployment, and this repository on the "recipient" Mac. Optional: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` on the Convex deployment for model-quality extraction and votes; without them the twin uses deterministic patterns.

```bash
# 1. Enable the feature on the deployment and push the functions
npx convex env set GIFT_TWIN_DEMO_ENABLED true
npx convex dev --once

# 2. In the web app: open a room, add a few clues, then /room/<roomId>/twin
#    The organizer clicks "Invite <name>'s Gift Twin" and gets a code.

# 3. On the recipient's Mac
npm run twin -- pair ABCD2345          # uses NEXT_PUBLIC_CONVEX_URL from .env.local, or --url
npm run twin -- share --fixture        # sample messages; drop --fixture to read real iMessage
```

`share` reads the messages, shows the consent summary, asks once, uploads, and exits. The twin's notes and votes appear on `/room/<roomId>/twin` within seconds. Add another clue and the twin starts evaluating it after the 200 ms room-change wakeup; model-dependent votes can take longer. Running `share` again replaces the vault and restarts the 24 hours. Change the read budget with `--max-mb`, or add `--days N` as an extra cutoff. Use `--dry-run` to see the summary without uploading. Other commands: `forget` (delete the vault now), `status`, `doctor` (checks Full Disk Access), `unpair`.

Real iMessage access: System Settings → Privacy & Security → Full Disk Access → enable your terminal app, then `npm run twin -- doctor`.

## Code map

| Path | Role |
| --- | --- |
| `lib/agentCollaborators/contracts.ts` | Shared types, Zod schemas, screening, limits, upload batching |
| `lib/agentCollaborators/fixture.ts` | Sample chat for demos and tests |
| `convex/giftTwin/schema.ts` | Additive tables (spread into `convex/schema.ts`) |
| `convex/giftTwin/room.ts` | Member functions: pairing, read-only feed, revoke |
| `convex/giftTwin/device.ts` | Device functions: pair, session, startUpload, uploadMessages, finishUpload, forget, disconnect |
| `convex/giftTwin/agent.ts` | Cloud twin agent: first pass, watch loop for new ideas, vault expiry |
| `convex/giftTwin/extract.ts` | Gift-feasible statement patterns plus the optional model pass |
| `convex/giftTwin/vote.ts` | Up/down votes on room ideas (patterns plus the optional model pass) |
| `convex/giftTwin/review.ts` | Gift agent review: relevance check, auto-publish insights and downvotes |
| `convex/giftTwin/purge.ts` | Room-deletion phases (spread into `convex/lib/roomPurge.ts`) |
| `gift-twin/` | Mac companion CLI: read `chat.db`, consent, upload (`cli.ts`, `src/*`, `test/*`) |
| `components/giftTwin/` | `GiftTwinStudio` demo page and reusable `AgentCollaboratorFeed` |
| `app/room/[roomId]/twin/page.tsx` | Demo route |

Tests: `npx vitest run convex/giftTwin lib/agentCollaborators` and `npm run test:twin`.

## Production path

The demo is shaped so promotion is additive:

1. **Main room (implemented).** The live map subscribes to the screened collaborator feed. Twin-authored clues use paired-star icons and violet clouds/dots instead of the inviting human's avatar. Evaluations appear on the target as named green Supports or red Doesn’t fit badges; selecting one shows its screened rationale. Human vote totals and proposal approvals stay separate. The recipient twin studio and phone view show the same distinct AI identity.
2. **Buyer agent.** Downvotes already arrive as exclusion/ownership clues. A later step could down-rank the voted idea directly instead of adding a counter-clue.
3. **Trend agent.** Insert `agentCollaborators` rows with `kind: "trend_scout"` (server-owned, no device token) and post into `agentCollaboratorPosts` with the same review step.
4. **Recipient-owned twins.** Today a twin is bound to one room. For production, key twins to a recipient identity and grant them to rooms, so one upload serves many gift rooms under one consent record. Add rate limiting on `device.pair` attempts.
5. **Packaging.** Ship `gift-twin/` as a signed macOS app or `npx` package with the deployment URL baked in. `src/api.ts` deliberately uses `makeFunctionReference` instead of `convex/_generated`, so it can move to its own package unchanged.
6. **Provenance.** Auto-added notes are `manual` clues under the inviter today. Add `sourceKind: "agent_collaborator"` to `PublishedClue` so they are labelled; this is a contract change for Dev 2.
7. **Hardening.** Encrypt vault chunks at rest with a per-upload key that is dropped at expiry, and record the consent text version with `consentedAt`. Live-test `chat.db` reading across macOS versions; the `attributedBody` decoder covers the common typedstream layout only.
