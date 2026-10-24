# Shared memory tree

The room’s `/map` route combines the sky-island prototype with the live application. `GiftCanvas` owns the room subscriptions and commands; `MemoryTreeScene` renders existing storybook avatars, branching islands, and the gift box. `GiftDiagram` retains the React Flow arrangement view, sharing the same clues, sprouts, listings, selection, and reactions.

## Connected behavior

- Published memories become attributed islands. Publishers can edit their own manual memories; optimistic text checks prevent overwriting another edit. Changing a memory discards its old idea branches.
- Growing a memory calls the existing idea adapter. Suggestions remain unconfirmed until a person explicitly confirms and publishes one. Late results for edited or withdrawn seeds are rejected.
- Research uses the existing research job pipeline. Product inspection retains source, observed price, freshness, unknown costs, and recommendation evidence. Sample listings remain labelled fixtures.
- Ownership reactions publish an attributed ownership clue. Personal price reactions never change a room budget or private contribution cap. Authors can undo their own reactions; other contributions survive.
- Organizers choose the gift; contributors vote. Selection and the proposal panel use existing revision and approval functions.
- Vibes rearrange the local view. A separate explicit action publishes a preference. Cursor updates distinguish sky coordinates from diagram coordinates.
- Small screens use an accessible card list and do not mount the 3D canvas. Desktop users can also switch to the list. Reduced motion pauses scene animation.

## Validation (2026-10-24)

- Full suite: 373 passed; 3 live-provider tests skipped.
- Eight map backend tests cover membership boundaries, authored undo, personal price semantics, duplicate growth, stale seeds, and edit conflicts.
- Production webpack build and TypeScript checks passed; whitespace check passed.
- Map functions/schema deployed to **development `compassionate-alpaca-531`**. Production was not deployed.
- Browser check used a synthetic test room: shared memory appeared, labelled sample products loaded, private cap saved, personal price reaction saved and undone, selection created the real $48 proposal, and the selection survived reload.
- Live idea expansion returned six agent suggestions. Inspection showed publication disabled until human confirmation. No suggestion was published as a fact during this check.
- Switching to the existing arrangement view showed the same selected gift and six idea branches.

## Deliberate limits

The sky view pages three memories and three products at a time, with two focused idea branches visible in the scene; the inspector exposes all suggestions for the selected memory. Vibes use deterministic layout rather than physical simulation. Product images depend on provider data; fixtures used in browser verification have no photos. Real Apify retrieval, simultaneous multi-browser collaboration, mobile viewport appearance, and approval completion were not exercised in this browser check. Automated tests cover the underlying map permissions and cursor contracts.
