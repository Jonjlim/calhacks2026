# Node interaction film

A 38-second interactive animation, built before the live map UI refactor. Open `http://127.0.0.1:4178/`. Play the walkthrough, pause, scrub, select a chapter, or click nodes to try the controls yourself. The prior rings prototype remains at `/rings.html`.

This study uses the existing storybook character models and the ring/memory/theme/gift vocabulary. It changes no application route, Convex schema, provider setting or live room. All gifts, prices, ownership confirmations, research completions and approvals are sample state. In particular, automated approval beats in the film are a storyboard, not other users approving.

## Placement rules

- Room identity, roster, invitation and settings share one header. The invitation is closed by default and opens only from its header button. Sound, lighting and recenter belong in settings rather than separate floating pills. The invitation pocket is a placement study, not a working QR or live invite.
- A hover/focus preview is two short lines attached to the node. It disappears when focus moves away.
- Clicking replaces the preview with a compact attached cluster. Support, pass and Why are the first actions; ownership and selection use More. Ownership requires an explicit confirmation, distinct from a soft pass. Controls close on Escape.
- Why brightens the memory → theme → gift paths and dims unrelated branches. The explanatory sentence stays attached to the gift.
- Research progress is a ring and a short status at the theme being explored. Its sample alternative grows from that branch. The single council line gives a summary; no second progress panel is opened.
- Shares are small connected petals around the present. The viewer's private limit folds into the present's status; shares, approval counts and no-charge copy remain in that same area. No side drawer is involved.
- Playback controls and chapter captions are review tools outside the product frame, not proposed production navigation.

## Choreography

0–3s establishes the calmer map. 3–7s reveals the hover preview. 7–12s blooms the action cluster and supports the mug. 12–16s passes on the kit. 16–21s confirms ownership separately. 21–26s traces Why. 26–32s explores a theme, shows progress and grows a sample class. 32–38s unfolds three shares and illustrates their approvals.

The walkthrough derives every beat from one seekable clock. There is no overlapping stack of playback timers. Interactive demo research has one cancellable local timer; seeking, starting playback or leaving clears it. OS reduced motion and the settings override suppress movement while keeping the same reviewable states.

## Libraries researched

- **Motion (already installed):** `AnimatePresence` handles controlled enter/exit, springs unfold attached controls and share petals. `layout`/`layoutId` are suitable for the production version when a compact token grows into a richer state. [Layout animation](https://motion.dev/docs/react-layout-animations), [AnimatePresence](https://motion.dev/docs/react-animate-presence), [accessible animation](https://motion.dev/docs/react-accessibility).
- **React Three Fiber + Drei (already installed):** `Html` projects DOM controls from the actual 3D node. `useFrame` updates object transforms, progress rings and evidence-path particles without React state on every animation frame. [Drei Html](https://drei.docs.pmnd.rs/misc/html), [R3F hooks](https://r3f.docs.pmnd.rs/api/hooks), [performance pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls).
- **Floating UI (researched, not installed):** `shift`, `flip` and `limitShift` are appropriate for production edge/collision handling. Keep a visible tether when moving controls within the viewport. The film uses a small local horizontal clamp rather than adding this dependency. [Shift and limitShift](https://floating-ui.com/docs/shift).
- **GSAP (researched, not installed):** labelled, seekable timelines fit more elaborate cinematic camera sequences. The current review clock and existing animation stack cover this study without a second animation system. [GSAP timeline](https://gsap.com/docs/v3/GSAP/Timeline/).

Recommended production stack: existing Motion + R3F/Drei; introduce Floating UI only if real data/viewport checks show the local anchor layout needs collision management. Reuse current Convex actions and preserve organizer selection, authored feedback, private caps and revision approvals.

## Build

```sh
node_modules/.bin/esbuild work/vision-lab/node-film.jsx --bundle --minify --define:process.env.NODE_ENV='"production"' --outfile=work/vision-lab/node-film.js
python3 -m http.server 4178 --bind 127.0.0.1 --directory work/vision-lab
```

The helper exports added to `sky-tree.jsx` reuse its existing Spirit, Tree, Present and GiftProp components. Its earlier SkyTree UI is unchanged.

## Quiet map revision

The default page now demonstrates progressive disclosure (`quiet-map.jsx` + `quiet-map.css`). The first animation remains at `/film.html`.

At rest, islands have short name tags only. Prices, attribution and full titles appear on the one selected island; hover gives one small preview. Support/pass/ownership persist as distinct badges. Why highlights its connected path and short theme/memory tags. Unrelated labels recede during focus; all background labels disappear during split approval. The split petals, amounts, personal approval and revision behavior are preserved.

The “Stress test” switch adds 17 illustrative outer islands (24 total before new research results). Outer islands use tiny inspection targets instead of another ring of text cards. Chapter narration lives outside the product frame. This is a density experiment, not a production layout or live multi-user test.

Build: `node_modules/.bin/esbuild work/vision-lab/quiet-map.jsx --bundle --minify --define:process.env.NODE_ENV='"production"' --outfile=work/vision-lab/quiet-map.js`.
