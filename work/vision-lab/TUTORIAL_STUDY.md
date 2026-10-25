# Moss: learning by making a real contribution

Open `http://127.0.0.1:4178/`. The default preview is a seekable 54-second tutorial animation. “Try it with your memory” starts the hands-on version. Previous studies remain at `/quiet.html`, `/film.html` and `/rings.html`.

This prototype directly reuses production `FloatingIsland`, `IslandEnvironment`, `IslandMesh`, scene palette, custom `MapIcon`, money parsing/formatting, and the original storybook spirit assets. The green spirit is a Moss stand-in: Jonathon's narrator implementation is not present in this checkout. Captions demonstrate narration cues; there is no voice service integration.

## The sequence

- Meet Moss: one short invitation, no separate setup tour.
- Remember: type a memory. Its island stays in the world.
- Connect: the memory and a clearly labelled example friend's memory join a theme.
- Discover: progress appears on the theme before sample gift options arrive.
- Steer: support, pass, and ownership are separate actions.
- Why: highlight the memory → theme → gift paths.
- Choose: put the gift in the present with a button or drag the gift token there.
- Agree: each person's amount unfolds from the present. Only your approval is interactive. In hands-on mode, other approvals require an explicitly labelled review simulation control outside the product frame.
- Reveal: the final story includes the typed memory and chosen gift idea.

The hands-on mode saves your memory and optional gift title/estimated price in this browser's localStorage. Skipping guidance does not erase them. Suggestions are illustrative, not generated from arbitrary user input. User-entered prices are estimates, never verified listing observations. Research and other participants are simulated; no live room, backend, model or payment calls occur.

## Production handoff

Use existing authoritative room fields and actions. Moss should observe completed actions and persisted jobs rather than mutating on a timer. Suggested triggers: clue published, themes available, research pending/failed/succeeded, human signal/ownership change, selection changed, current revision approved. Dismiss guidance independently of those records; a reload or skip should never withdraw a clue. Never fabricate a source result, another user's contribution, or their approval.

The film clock is review-only. In production, a failed/uncertain job must stop the success choreography and offer the real recovery path. Voice should use the same stage cues as the visible caption, remain optional and cancel on stage changes.

## Build

`node_modules/.bin/esbuild work/vision-lab/tutorial.jsx --bundle --minify --define:process.env.NODE_ENV='"production"' --outfile=work/vision-lab/tutorial.js`

The `avatars` symlink points at the repository's existing public avatar assets for production component preload paths. No dependency was added.
