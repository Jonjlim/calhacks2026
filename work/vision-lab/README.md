# Unwrap vision lab

## Current revision: shared gestures and group direction

The guided prototype now has real **same-browser, same-origin tab collaboration** through `BroadcastChannel`, with localStorage snapshots and per-field logical clocks. It is not a hosted multiplayer service: another device, browser profile, or origin cannot join this transport. Demo identities are selectable names, not authenticated participants.

- Click an island or character to inspect it; hold and drag its label, character, or ground to move it. Its connections follow. Drag empty sky to orbit. Reset island layout restores the arrangement.
- While held, left/right release lanes appear. Release far left to pass or right to support; a fast horizontal flick also counts. A gentle or diagonal move arranges the island. The gift box moves but does not receive direction votes. Pointer cancellation/blur releases holds; simultaneous local claims use a deterministic winner and expire with presence.
- Other tabs see named cursors, held-island ownership, positions, and attributed signals. Position records are per island so independent concurrent moves do not overwrite an entire layout. Presence expires after five seconds and is not persisted. Reload preserves the local room's records; Restart resets the shared prototype room.
- Each demo identity has one replaceable/undoable signal per island. Positive gift votes add 18 to an illustrative fit score; memory-direction votes add 10 to gifts with that primary memory. Passes subtract the same weight. User-pinned layouts remain pinned; unpinned supported branches lift slightly. A mug has visible connections to both pottery and slow coffee, although this prototype score uses its primary coffee memory.
- Group signals reveal the pre-authored clay-class alternative. The explanation is labelled **sample agent exploration**. There are no model calls, new source retrievals, or real algorithm training in this page. A vote changes ranking, never confirms ownership, alters a budget, approves a proposal, or orders a gift.
- Button equivalents in the inspector support phone and keyboard users. The three-step guided flow remains intact. Research progress and results are shared local demo state; a lost demo worker expires after twelve seconds. Approval simulation remains explicitly labelled.

Browser checks: diagonal dragging moved a memory without opening details; the other tab saw the new arrangement. A right toss registered one support signal; a later click opened details normally. Jon's separate support for the mug raised its sample score from 66 to 84 and moved it to rank one in the first tab. Jon then tossed it left: both tabs showed his pass and a score of 48. The first tab visibly displayed Jon’s cursor. Reset layout restored positions without erasing group signals. The supported pottery memory raised the kit from 70 to 80 and revealed the class alternative. This is a design prototype, not production authorization or a production concurrency guarantee.

## Current revision: one shared journey

The guided foundation opens `guided.jsx`: **Remember → Explore → Choose together** on one island with one persistent detail panel. The previous `prototype.jsx` remains an archived study. Rebuild the current page with:

```sh
node_modules/.bin/esbuild work/vision-lab/guided.jsx --bundle --minify --define:process.env.NODE_ENV='"production"' --outfile=work/vision-lab/prototype.js
python3 -m http.server 4178 --bind 127.0.0.1 --directory work/vision-lab
```

The Remember step offers picture prompts and a confirmation before publishing a local sample memory. Clicking an existing character opens its editable memory. One explicit Find gifts action runs a labelled simulated council sequence; sample products grow from their supporting memory islands. The same panel shows the gift story, ownership/price reactions, undo, and an experience alternative. The next-step bar stays visible while scrolling.

Choosing an affordable gift opens the versioned box and a cent-exact illustrative three-person split. Your approval is separate from an explicit button that simulates Jon and Ally approving. Wrapping requires all three. A different gift resets all approvals; editing a memory clears the researched samples and selected gift. The $118 wheel cannot be selected against the $80 budget. Desktop/phone switching preserves this same local state; phone mode unmounts the 3D scene and uses buttons. OS reduced motion is respected, with an additional review toggle.

All memories, research, listings, alternatives, approvals and split amounts on this page are local prototype state. There is no live Convex connection, source retrieval, checkout, permission validation or cross-device synchronization. Shared records now persist locally across reload; Restart resets the shared demo room. This iteration changes only the vision-lab files; it does not restructure the production room yet.

Browser validation: memory confirmation, research progress, product inspection, ownership alternative, version-one approvals, choosing a different gift resetting approvals to zero on version two, and wrapping after all three approvals. Bundle and JavaScript syntax checks pass. Phone mode was checked visually and exercised through research and product inspection. The $118 wheel was disabled; editing its supporting memory returned to Remember and removed the old research results. Actual multi-device collaboration is outside this prototype.


## Earlier revision: the sky tree

The default prototype is now a real, interactive Three.js scene using the application's existing React Three Fiber/Drei stack and its actual `curious`, `explorer`, `kind`, `dreamer`, and `calm` character models. This replaces the screenshot-overlay concept as the primary direction. No new dependencies were added.

Memories live on floating islands with their little friend. Glowing, growing branches connect them to a central gift island and to gift islands carrying small 3D objects. Click a friend or its label to explore and edit the sample memory. Click a gift island to inspect it, apply a constraint, restore its branch, or send it to the gift island. Handmade moves the matching branch closer. The camera can orbit gently and zoom; phone mode keeps the button-based controller. The older flat map remains available as **Earlier paper study** for comparison.

The same simulated state machine powers both views. The edited memory text updates its island, but product relevance remains scripted; this is a design prototype, not a live agent implementation. Group approval and provider activity remain simulated. The little people are original application assets, not newly generated replacements.

New files: `sky-tree.jsx`, `sky-tree.css`, and local copies of the application's character GLBs in `models/`.

Verified in the browser: the real character GLBs load, memory islands expand the graph, editing Jon's sample memory updates the in-world label, an ownership constraint prunes a gift branch and grows an experience island, sending that alternative to the gift island updates its label, and simulated approval changes the central box state. Rebuilt the bundle and checked JavaScript syntax. World-space labels stop pointer propagation to prevent clicking through to geometry behind them. The current sky-tree screenshot is `mockup-sky-tree.png`; earlier screenshots remain as archived design comparisons.

A separate, interactive design study built from the current application's paper/lilac/coral palette, Cormorant/Figtree/Caveat typography, existing avatar portraits, and a screenshot of the current island. It changes no application routes, Convex schemas, backend records, or provider configuration.

Open **http://127.0.0.1:4178/** while the preview server is running.

To rebuild and serve from the repository root:

```sh
node_modules/.bin/esbuild work/vision-lab/prototype.jsx --bundle --minify --define:process.env.NODE_ENV='"production"' --outfile=work/vision-lab/prototype.js
python3 -m http.server 4178 --bind 127.0.0.1 --directory work/vision-lab
```

The prototype uses the installed React and Motion dependencies. Fonts load from Google Fonts, with local serif/sans fallbacks. All interaction logic and illustrated products are local. No new dependencies were installed for this study.

## Two concepts to compare

**Parchment map:** a focused, legible work surface for understanding clues and comparing gifts. This is the recommended first direction to validate.

**Island overlay:** the same interaction over an unmodified screenshot of the existing application's island. This tests continuity with the current world; the backdrop is a screenshot, not a live 3D scene. A production version could open this surface from the council table.

**Phone:** each concept has a narrow controller view. Exploration, constraints, selection and approval have button equivalents; dragging is optional. This preserves the existing desktop-stage / phone-controller split.

## Try this sequence

1. Click the pottery memory. The Scout status appears, edges draw, and three sample gifts enter in sequence.
2. Select Handmade. The ceramic option lifts and its branch strengthens. This is a local layout demonstration, not a newly inferred fact or search.
3. Drag Already has it onto the kit, or choose that constraint and tap the kit. The kit fades, remains inspectable, and an experience alternative appears. Undo restores it.
4. Drag a gift onto the central box, or choose Put in box. Inspect the sample item price against the $80 room budget. Shipping remains unknown.
5. Simulate group approval. The lid settles and the sample revision is marked approved. Selecting another gift creates a new revision and resets approvals.
6. Try the $118 wheel: it exceeds the budget and simulated approval is disabled.
7. Switch to Phone and repeat using buttons. Use the four story-stage buttons to jump to a mockup state, or Play the 10-second story to watch the whole sequence.

All memories, prices, products, agents, collaboration and approvals are clearly labelled simulated. There are no live cursors or actual multiplayer writes. Illustrations stand in for merchant photos. Automatic alternatives are scripted; this does not prove live recommendation quality. These differences are deliberate for vision validation.

## Motion specification

- **Memory hover:** small lift/rotation; immediate response, no loss of reading position.
- **Explore:** short, honest simulated pending state; a curved edge draws over ~850ms, with product entrances staggered by ~80ms.
- **Steer:** one option moves 16px and gently scales. No force simulation and no uncontrolled motion.
- **Reject:** the original stays visible at reduced opacity; the reason and an undo action remain attached. A scripted alternative enters on a nearby branch.
- **Choose:** direct manipulation using a spring and screen-space drop detection, plus a keyboard/button equivalent. The box displays one selected item.
- **Approve:** lid and bow settle; any changed gift clears approval.
- **Reduced motion:** respects the operating-system preference for Motion/CSS animation; the explicit toggle disables movement too. The guided demo still progresses through its timed states.

## Library research and recommendation

Checked against official project documentation on October 24, 2026.

- **React Flow (`@xyflow/react`): graph interaction and edges.** Supports custom edge animation, including SVG/CSS motion along a path. The application's current GiftMap was still a list at inspection; other work is concurrently adding a real canvas. Use its existing graph effort rather than inventing a second implementation. [Animating edges](https://reactflow.dev/examples/edges/animating-edges).
- **Motion (`motion/react`): card entrances, layout steering, drag lift, box transitions.** Already installed and used in the application. `layout` / `layoutId` handle transitions between layouts; drag offers momentum, constraints and direction locking. Drop acceptance still needs application-owned hit testing and validation. This prototype uses Motion, not React Flow, to test the experience independently of the in-progress graph. [Layout animation](https://motion.dev/docs/react-layout-animations), [drag](https://motion.dev/docs/react-drag).
- **Existing React Three Fiber / Drei:** keep these for the island, tower, camera and characters. Put readable product/clue interfaces in DOM overlays. Don't rebuild the world to implement this map.
- **GSAP Flip:** another option for moving elements between layouts and coordinating complex transitions. It overlaps Motion for this use case, so adding it now would increase animation ownership complexity. [Flip documentation](https://gsap.com/docs/v3/Plugins/Flip/).
- **Rive:** useful later for custom character reactions driven by state machines. It requires authored animation assets and a runtime integration; it does not solve graph state, permissions, or synchronized selections. Defer while current 3D characters already serve the scene. [Rive introduction](https://rive.app/docs/auth).
- **tldraw:** useful collaboration inspiration, but not a replacement stack here. Its multiplayer starter uses Cloudflare Durable Objects and R2; Unwrap already has Convex as its state authority. [Collaboration](https://tldraw.dev/docs/collaboration), [multiplayer starter](https://tldraw.dev/starter-kits/multiplayer).

Recommended production combination: **React Flow + existing Motion + existing Convex**, with the present Three.js world around it. Persist explicit actions and relationships; treat animated positions as presentation unless a deliberate pin/move feature requires saving them.

## Interaction references

- **Miro:** expanding branches and rearranging related ideas. Borrow progressive disclosure; don't expose a full diagram-editor toolbar. [Mind mapping](https://miro.com/mind-map/).
- **Milanote:** readable notes, visual collections and a feeling of arranging a personal board. Borrow material hierarchy and readable mixed content. [Visual workspace](https://milanote.com/inspiration/create).
- **tldraw:** clear shared spatial manipulation and presence. Borrow the clarity of direct manipulation; defer simulated cursors and a second collaboration backend.
- **Current Unwrap:** retain the existing island, palette, avatars, gift box, and separation between desktop stage and phones. This is the primary visual reference, not a generic whiteboard skin.

## Questions to settle before implementation

1. Can a new person explain the relationship between a clue and a gift without help?
2. Does the rejected idea remaining on the board clarify the reasoning or create clutter?
3. Is drag-to-box obvious, and is its button equivalent equally discoverable?
4. Does the island overlay improve continuity enough to justify its extra visual density?
5. Can phone users contribute and decide without navigating a miniature graph?

Validation target: one person tries the pottery → owned kit → alternative → selected gift sequence with no narration. Watch for wrong clicks, unclear constraints, and confusion about whether actions are shared. This prototype cannot validate provider latency, live ranking, real-time synchronization, or backend approval correctness.

## Future implementation boundaries

Shared seeds must come from published clues; private imports and unreviewed photo guesses remain private. Constraint gestures require explicit scope and undo semantics. A price reaction must not mutate private contribution limits. One item is selected; bundle optimization is outside this prototype. Growth is tied to real job events in the application version. No automatic paid retry/research loop should be introduced by an animation callback.

## Verification performed

Bundled successfully with the repository's installed esbuild; generated JavaScript syntax check passed. Browser checks exercised clue expansion, the ownership card's tap-to-apply path, the alternative appearing, Handmade steering, pointer drag from the mug to the box, simulated approval, and a change to the class creating revision 2 with approvals reset. The full guided story reached its approved ending. Verified no horizontal overflow at 390px and 320px viewport widths and restored the browser's normal viewport afterward. Captured desktop and phone mockups. No backend tests or paid provider calls were needed for this isolated design study.
