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
  C->>T: agent.processVault
  T->>C: insights + votes on current room ideas (screened sentences)
  C->>B: review.reviewPosts
  B->>C: insights → clues; downvotes → exclusion/ownership clues; upvotes → noted
  loop every 30 s until the vault closes
    C->>T: agent.watchTick → voteOnNewIdeas for ideas added since
  end
  C->>C: expireVault after 24 h (or forget / disconnect) deletes the messages
  C-->>F: "Room idea: Maya loves backpacking · ▼ Downvoted"
```

The twin does two things:

1. **Insights: gift ideas found in the messages.** Anything the recipient wants, likes, does, owns, or dislikes that a friend could turn into a gift. One clear mention is enough: "I've been playing tennis a lot" and "I've been wanting an Arc'teryx jacket" both count. Repetition only raises confidence. Things that are not giftable are skipped: "I love dinner", "I love you guys", "I just got home".
2. **Votes on the room's ideas.** For each clue, idea branch, and listing in the room, the twin looks for clear evidence in the recipient's messages. **Up** when they back it, **down** when they contradict it (friends say "Maya loves backpacking", she wrote "I hate backpacking, never again") or show she already owns it. An idea with no clear evidence gets no vote. Ideas added later get a vote within about 30 seconds while the vault is open.

What the gift agent (`review.reviewPosts`) does with them:

- **Insights** that pass the deterministic floor (medium or high confidence, categorized) are published as `manual` clues. When the server LLM is configured, it also judges gift relevance and can only veto. Skipped insights are hidden.
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

Room members create the twin at `/room/<roomId>/twin` and copy its invitation link. The recipient opens it at `/twin`, reads and accepts the privacy terms, connects, then selects their own Mac's `~/Library/Messages/chat.db`. A bundled SQLite WASM reader follows the CLI's same read-and-upload pipeline. The “Choose Messages file” button opens the system file picker. Selecting the file after consent immediately uploads the messages through the companion's existing `planUpload`, with no added review or local preference extraction. The server removes emoji sequences before vault storage and skips emoji-only messages; the vault enforces a 1 MiB UTF-8 text limit. The recipient manages status, deletion, or disconnecting on the same page. Sample data is available and clearly labelled.

The browser cannot directly access iMessage or request automatic macOS database access. The recipient must select the file; macOS may prevent this. Files above 512 MB are refused to limit browser memory usage. The newest 1 MiB of message content is scanned, including incoming content in the read budget, exactly as in the CLI. The existing companion preparation then uploads only sent messages, with the same 2,000-character limit per message. This reads the database snapshot only; recent messages in the separate SQLite WAL may be absent. Use the CLI if the database cannot be selected or a complete live snapshot is required. Real macOS file-selection compatibility remains unverified.

The single-use invite is in a URL fragment and is cleared from the address bar after loading. Opening it alone never consumes it. Device credentials are kept in tab session storage; messages are kept only in memory. Reload restores management access in the same tab. Closing the tab loses that access, but the server still deletes the vault at expiry. Delete and disconnect do not remove already posted room notes. No new service or provider is added.

## Run the CLI demo

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

`share` reads the messages, shows the consent summary, asks once, uploads, and exits. The twin's notes and votes appear on `/room/<roomId>/twin` within seconds. Add another clue and the twin votes on it within about 30 seconds. Running `share` again replaces the vault and restarts the 24 hours. Change the read budget with `--max-mb`, or add `--days N` as an extra cutoff. Use `--dry-run` to see the summary without uploading. Other commands: `forget` (delete the vault now), `status`, `doctor` (checks Full Disk Access), `unpair`.

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

1. **Main room.** Mount `<AgentCollaboratorFeed feed={...} />` on the map (D19) and show the twin's ▲/▼ next to the clue or listing it voted on (`ideaRef`).
2. **Buyer agent.** Downvotes already arrive as exclusion/ownership clues. A later step could down-rank the voted idea directly instead of adding a counter-clue.
3. **Trend agent.** Insert `agentCollaborators` rows with `kind: "trend_scout"` (server-owned, no device token) and post into `agentCollaboratorPosts` with the same review step.
4. **Recipient-owned twins.** Today a twin is bound to one room. For production, key twins to a recipient identity and grant them to rooms, so one upload serves many gift rooms under one consent record. Add rate limiting on `device.pair` attempts.
5. **Packaging.** Ship `gift-twin/` as a signed macOS app or `npx` package with the deployment URL baked in. `src/api.ts` deliberately uses `makeFunctionReference` instead of `convex/_generated`, so it can move to its own package unchanged.
6. **Provenance.** Auto-added notes are `manual` clues under the inviter today. Add `sourceKind: "agent_collaborator"` to `PublishedClue` so they are labelled; this is a contract change for Dev 2.
7. **Hardening.** Encrypt vault chunks at rest with a per-upload key that is dropped at expiry, and record the consent text version with `consentedAt`. Live-test `chat.db` reading across macOS versions; the `attributedBody` decoder covers the common typedstream layout only.
