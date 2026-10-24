# QA report: automated tests and integration status

Scope: test files, fixtures, and this report only. No product code, UI, animation, Blender asset, or Convex
schema was changed. Findings against teammate-owned code are listed as defects/gaps, not fixed.

Branch `qa/e2e-reliability`, based on `dev1/unwrap-desktop-opening` @ `6c4eea4`.

## How to run

| Command | What it runs | Time |
| --- | --- | --- |
| `npm test` | Vitest: unit, Convex (`convex-test`), and contract tests | ~3 s |
| `npm run test:e2e` | Playwright `desktop` + `mobile` projects, WebGL disabled, mock backend | ~1.5 min |
| `npm run test:e2e:webgl` | Playwright `webgl` project: real WebGL, intro, serial (opt-in) | ~4.5 min |
| `E2E_BASE_URL=http://localhost:3000 npm run test:e2e` | Same, against a server you already started | |

`test:e2e` starts its own `next dev` on port 3210 with `NEXT_PUBLIC_CONVEX_URL` empty, so it always tests the
app as it ships today (UI on mock data). One-time setup: `npx playwright install chromium`.

Conventions used so reports stay honest:

- `test.fixme` / `it.todo`: the feature does not exist yet. Reported as skipped/todo, never as passed.
- `test.fail` / `it.fails` named `DEFECT QA-n`: a real bug. Stays green while the bug exists and **turns red when it
  is fixed**; then change it to a normal test.
- Describe blocks named "known gaps" / `GAP:` tests are characterization tests: they pin down a gap that exists
  today and will fail on purpose when someone closes it. Update them (and this file) then.

## Latest results (actual)

| Suite | Result |
| --- | --- |
| Vitest, whole repo | 297 passed, 1 expected-fail, 3 skipped (pre-existing live smoke), 4 todo. Baseline before this work: 217 passed. **+80 new passing tests** |
| Playwright `desktop` + `mobile` (run twice) | 57 passed, 8 skipped, 0 flaky, 0 failed, both runs. Of the 57, **54 are real passes and 3 are documented defects** (`DEFECT QA-2/3/4`) |
| Playwright `webgl` (serial) | 7 passed |
| `tsc --noEmit` (app and `-p convex`) | clean |
| Lint | **no linter is configured in this repo** (no ESLint/Biome); not run |

Not run: any test against a live Convex deployment (none exists: no `.env.local`, no `NEXT_PUBLIC_CONVEX_URL`),
any WebKit/Firefox browser, any real phone.

## Flow status

Legend: **Implemented** works end to end; **Mock** UI works on fake data only; **Incomplete** partly built;
**Missing** does not exist.

| Flow | Backend (Convex) | Frontend | Automated coverage |
| --- | --- | --- | --- |
| Landing page, sound toggle | n/a | Implemented | e2e |
| Cinematic intro (skip, replay, once per session, reduced motion) | n/a | Implemented | e2e (webgl project) + unit (`introClock`, camera) |
| Create a room | `rooms.createRoom` implemented | **Mock** (`mockLandingActions`) | e2e validation, pending, double submit, a11y against the mock; Convex tests for the real mutation |
| Invite link | `rooms.getInvite` / `previewInvite` implemented | **Missing**: no link shown after create; `/join/[token]` is a static, non-functional form | Convex tests (tokens, privacy, trimming, case, bounds); e2e for the static page only |
| QR code | `getInvite.joinPath` is the payload | **Missing** | none |
| Join a room (landing form) | `rooms.joinRoom` implemented | **Mock** (accepts only `demo-invite-token`) | e2e + Convex (idempotent, concurrent, limits) |
| Join via `/join/[token]` | implemented | **Incomplete**: renders and pre-fills, submit does nothing | e2e (render/encoding/XSS); `fixme` for the real flow |
| Memory submission | `clues.upsertManualPreference` implemented (no dedicated endpoint) | **Missing**: no UI | Convex tests (visibility, validation, dedupe, concurrency); `fixme` for UI |
| Room page `/room/[roomId]` | `rooms.getRoom` implemented | **Mock**: renders the demo room for *any* id | e2e (render only) |
| Convex Auth (anonymous sign-in) | implemented | **Missing**: plain `ConvexProvider`, no `signIn` | contract tests pin the gap |
| Multi-user / real time | works in `convex-test` | **Not possible**: nothing calls Convex | Convex-level multi-identity + concurrency tests; two-context e2e checks honest labelling only; real two-browser tests are `fixme` |

## Defects found (not fixed: teammate-owned code)

| ID | Severity | Where | Finding | Test |
| --- | --- | --- | --- | --- |
| QA-1 | Medium | `components/world/sceneConfig.ts` `storybookPose` | Width 0 gives aspect 0, so `1.5 / aspect` is Infinity and the camera position is non-finite. `WorldCamera` calls it with the canvas size, so a hidden or not-yet-laid-out canvas builds a NaN pose into `CameraTour`. Self-heals only if size changes later | `tests/unit/camera.test.ts` (`it.fails`) |
| QA-2 | Low-medium | Landing create/join inputs | `text-[15px]` fields: iOS Safari zooms the page on focus for inputs under 16px | `e2e/mobile.spec.ts` (`test.fail`) |
| QA-3 | Low | `app/join/[token]/page.tsx` + `JoinRoomForm` | Route param is pre-filled still percent-encoded (`hello%20world` shown literally). Real backend tokens are 32 hex chars, so no impact today | `e2e/invite-links.spec.ts` (`test.fail`) |
| QA-4 | Low | Landing primary button at 320 px | `min-w-[284px]` plus 40 px page padding ends at x=324: 4 px clipped (`overflow-hidden` hides it). 360 px and up are fine | `e2e/mobile.spec.ts` (`test.fail`) |
| QA-5 | Medium (observation) | Landing 3D scene | With software WebGL (SwiftShader, as in VMs/remote desktops/CI) the scene renders at **~1 fps** and the page stops responding to clicks. There is no software-GL detection; the painted-backdrop fallback only triggers when WebGL is absent. Consider checking `WEBGL_debug_renderer_info` for SwiftShader/llvmpipe | measured manually; cause of the opt-in `webgl` project |

## Frontend <-> Convex contract mismatches

Pinned in `tests/qa/frontend-backend-contract.test.ts`.

1. **No room title in the create form.** `createRoomDraftSchema` has recipient, occasion, name; `api.rooms.createRoom`
   requires `title`. Sending the draft as-is throws an argument-validation error.
2. **Create result shape.** UI `LandingRoomEntry` is `{ roomId, source }`; the backend returns
   `{ room, participant, inviteToken }`. The UI has no field for the token, so it cannot show a link or QR.
3. **Mock `roomQuery` vs `getRoom`.** The mock returns a bare `RoomView`; the backend returns `Result<RoomView>`
   (and Convex `useQuery` adds `undefined` while loading). Inner shapes match: room, participant, and `me` keys verified.
4. **No frontend type for `previewInvite`.** `docs/CONTRACTS.md` documents it; `lib/contracts` has no type for its payload.
5. **Auth.** Every mutation returns `unauthorized` without a Convex Auth identity; the app has no auth provider or sign-in.
6. **Invite code limits differ.** UI accepts at most 64 chars, backend 128. Harmless (real tokens are 32), but they should not drift.
7. **Thrown errors vs typed results.** Invalid clue `kind` or a missing argument makes Convex *throw* (argument validators),
   while `AGENTS.md` says expected failures return a typed result. The client needs a catch.
8. **"One memory" is not enforced by the backend.** Same person can add many distinct manual clues; a UI that promises
   one must enforce it. Memories are room-visible immediately (manual clue), not private.
9. **Join ignores the name for existing members** (and keeps the original name). Fine, but the UI should not imply a rename.
10. **Display names are stored unsanitised** (markup kept verbatim). Safe today because React escapes; verified in e2e that no script runs.

Verified consistent: name/recipient (40) and occasion (80) limits match at the boundaries in UI and backend; every
backend-issued token passes the UI's code validation; `joinPath()` matches the `app/join/[token]` route.

## What each test file covers

- `tests/qa/rooms-invite.test.ts` (25): token format and uniqueness, preview privacy (exact field list), `alreadyMember`,
  bad/oversized/whitespace/case tokens, idempotent and concurrent joins (same user and 6 users at once), name limits,
  organizer role kept, `listMyRooms`, token is not membership; memory visibility/attribution/validation/dedupe/double-tap.
- `tests/qa/frontend-backend-contract.test.ts` (14 + 4 todo): payload shapes, UI-vs-backend validation parity, route match, known gaps.
- `tests/unit/introClock.test.ts` (23): phase order and timing, loading/snapshot gates and their timeouts, pause hook,
  huge frames, finish/replay, subscriptions, `smoothstep`.
- `tests/unit/camera.test.ts` (18 + 1 expected-fail for QA-1): responsive poses across 6 viewports, degenerate sizes,
  `CameraTour` endpoints, clamping, continuity, easing.
- `e2e/landing.spec.ts`: validation messages, whitespace, limits, pending state, honest "Preview mode" copy,
  double submit, Enter key, Back, XSS inertness, keyboard-only operation, blocked `localStorage`.
- `e2e/invite-links.spec.ts`, `e2e/multi-user.spec.ts`, `e2e/mobile.spec.ts` (320-430 px, no horizontal scroll, controls in
  viewport, input font size), `e2e/world.spec.ts` (real WebGL).

## Still untested

- Anything against a real Convex deployment, including auth, real-time subscriptions, and two real browsers.
- Visual correctness of the 3D world, intro artwork, and audio (`chime`).
- WebKit/Firefox and real phones; screen-reader behaviour beyond roles/labels.
- Performance on GPU hardware (only software-GL behaviour was observed).
- Payments, research, and agent flows beyond the existing backend unit tests (out of scope here).

## When the frontend gets wired, replace these

`e2e` `fixme` tests: join via link, invalid/expired link, returning member, memory submission, non-member room access,
and the three real two-browser tests. `it.todo` entries in the contract test list the matching unit-level wiring checks.
Run `E2E_BASE_URL=... npm run test:e2e` against a deployment with `NEXT_PUBLIC_CONVEX_URL` set, and remove the
`GAP:` characterization tests as each gap closes.
