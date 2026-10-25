# Integrated room guide

The live room now opens its existing map composer from Type / Photo / Can't
think. A successful published-clue subscription advances the guide; there is no
practice room, cloned memory or reset. Photo/paste clues still require their
existing private review and explicit publication.

Camera framing uses the existing map camera owner, respects reduced motion,
and yields to reveal ownership and map gestures. The guide replaces the bottom
status line and can be dismissed or reopened through Room menu → Explore with
Moss. Completion is local to this room and participant.

Peer arrivals are observed from published room data. Their cues wait behind a
draft, drawer or reveal. Show island requires an explicit click. Show connection
is available only for an actual council theme containing both members' active
memories, and lights its existing clue/theme paths. Votes use existing room
actions; passing, supporting and ownership stay separate. Shares/approval logic
is unchanged.

Moss voice is not wired to a provider here. `unwrap:room-guide` exposes semantic
cues to Jonathon's narrator; see docs/CONTRACTS.md for detail and cancellation.

## Validation

- TypeScript checks passed for frontend and Convex.
- Existing full suite passed (756 tests, 4 skipped) before adding the three
  focused camera tests; the seven guide/camera tests also pass.
- Live synthetic room tested with independent Chrome and in-app browser members:
  first memory publication, real support and pass signals, refresh persistence,
  reopening guidance without duplicating memories, and a peer publication while
  an unsent draft remained intact. The queued peer cue appeared after Cancel.
- `live-multiplayer.png` shows both published memories and a saved pass signal.
- No product search success, split approval or live voice behavior is claimed by
  this test. No backend deployment or push was performed.
