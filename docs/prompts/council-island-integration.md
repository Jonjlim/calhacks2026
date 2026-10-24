# Unwrap: integrate the live AI Council into the homepage island

Implement the gift-research experience inside Unwrap's existing homepage world. A visitor should create or join a gift room, share memories, watch the five clockwork agents work on the same island, and inspect the actual products they recommend. Keep the homepage's current UI and animation direction throughout.

## Workspace and current state

Application: `/Users/ally/Github/calhacks2026`
Finished agent assets: `/Users/ally/Github/unwrap-3d-assets/ai-council/`

Read AGENTS.md, docs/PRODUCT.md, docs/CONTRACTS.md, docs/DATA_AND_PRIVACY.md, docs/ARCHITECTURE.md and docs/FETCH_AI_COUNCIL.md before editing. Read the relevant installed Next.js guides. Preserve all uncommitted work; this branch has already been updated from dev. Inspect the teammate's deployment and integration work before replacing anything.

The local Fetch.ai flow has completed real product searches. One registered Python uAgent coordinates Archivist, Muse, Scout, Keeper and Courier. It uses Convex for progress events and Apify for product research. Its Agentverse mailbox has been connected. Recheck runtime health rather than assuming old validation proves the deployed system works.

Known gaps:
- `/council` is a separate visual scene keyed by a browser demo key.
- The council page shows progress and recommendation counts, but not the actual recommended products.
- `CouncilMember.tsx` loads Archivist for every role and applies different tints.
- Only Archivist is currently in `public/ai-council/`; all five finished exports exist in the asset repository.
- The local configuration uses localhost URLs. A working local agent isn't proof of a working Vercel deployment.

## 1. Keep one island and one visual language

Use the actual homepage island, its camera system and its hero gift box as the continuous setting. The council belongs on that island, within the existing scene composition. Do not build another council island, council room, replacement gift box or standalone dashboard.

Inspect and reuse:
- `components/landing/LandingPage.tsx`, `LandingHero.tsx`, `CreateJoinPanel.tsx`
- `components/world/WorldCanvas.tsx`, `WorldCamera.tsx`, `WorldLighting.tsx`
- `FloatingIsland.tsx`, `IslandEnvironment.tsx`, `HeroGiftBox.tsx`, `worldLayout.ts`
- the existing painterly materials, paper textures, palette/time-of-day system and ink outlines
- the intro and unwrap timelines, `components/unwrap/UnwrapInvitation.tsx`
- `app/globals.css` and the existing buttons, typography, spacing and panel treatments

Match the current homepage exactly: fonts, cream paper surfaces, palette, borders, shadows, hover feedback, spring settings, camera easing, reveal timing and gentle character motion. Reuse the established tokens and components rather than approximating them with a second design system.

Keep the world mounted where practical. Transition between landing, room activity and council focus with the existing camera/timeline conventions. Coordinate camera ownership so intro, unwrap and council transitions cannot fight each other. DOM panels should sit naturally over the world, remain keyboard accessible and adapt to mobile.

Keep logical gift rooms and membership boundaries. Sharing one visual island does not mean merging every visitor's room data into one global session. Room URLs and refresh/deep-link behavior must still work while rendering the same island setting.

The `/council` prototype may remain as a developer test view or lead into the shared experience, but it must not be the required destination for the user journey.

## 2. Use all five finished agent models

Copy the verified deliveries from `ai-council/models/` into this app's `public/ai-council/`:

- archivist.glb
- scout.glb
- muse.glb
- keeper.glb
- courier.glb

Use `models/council_manifest.json`, the asset README and the actual GLB animation arrays to verify the files and clip names. Keep the source asset repository intact. These characters are already built; do not generate replacement robots or tint five Archivist clones.

All agents have `idle`, `walk`, `wave`, `think`, `talk`, `celebrate`, and `sit`. Their role clips are:
- Archivist: `read_scroll`, `unroll_memory`, `stamp_bookmark`
- Scout: `search`, `inspect_object`, `discovery`
- Muse: `sketch_idea`, `present_design`, `brush_twirl`
- Keeper: `count_coins`, `compare_options`, `approve`
- Courier: `carry_letter`, `deliver_message`, `excited_hop`

Map each role to its own model and real clips. Retire placeholder clip substitutions when a proper clip exists. Clone skinned instances with SkeletonUtils and give each instance independent animation state. Crossfade actions and use one-shot/held behavior where appropriate.

Preserve the approved warm-grey bodies, brass, individual fabric colors, glowing eyes and neon-yellow chest stars. Any adaptation to the lobby's painterly shaders must preserve vertex colors and emissive behavior. Check all five under the existing day/night lighting. Keep feet grounded, scale consistent and props attached. Show a loading or retry state for asset failures instead of substituting a different character.

## 3. Connect visible progress to real room activity

Integrate `components/council/*`, `lib/council/*`, `convex/council.ts`, `app/api/council/run/route.ts` and `fetch-agent/council/*` with the existing authenticated room flow.

A user shares or publishes information through the existing consent flow, starts a council request, and sees the appropriate agents react on the island. Archivist reads; Muse designs a charm while Scout searches; Keeper checks the results; Courier presents them.

Animate from actual persisted task events. Do not use timers to imply task completion, invent progress percentages, or celebrate a failed search. Distinguish running, partial success, failed, interrupted and reconnecting states. Provide useful errors and safe retry behavior. Rebuild state after refresh without replaying old charm deliveries or duplicating decorations.

Keep the coordinator's five roles inside the existing registered agent. Do not introduce five provider integrations or a second agent engine.

## 4. Show the actual recommendations

Extend the current result path so a completed web request delivers the actual Keeper-approved products to room members, not just a count. Update docs/CONTRACTS.md before changing shared interfaces.

Validate and persist normalized products and recommendations through the existing room-aware Convex research/listing system. Keep small animation events separate from product payloads. Associate results with the correct room and run; enforce membership on reads and validate authorized run ownership on ingest. A browser demo key is not sufficient authorization for real room results.

Reuse `ProductCard`, `ProductShortlist`, the existing recommendation explanations, votes, selection and proposal actions. Adapt their presentation to the homepage's paper UI and island context. Each result should expose:
- Product title and supplied image, with an honest missing-image fallback.
- Observed price/currency and retrieval time, or an explicit unknown price.
- A working source/product link and available seller information.
- Why it fits the published clues and the Keeper's relevant notes.
- Clear cache labeling when cached research is used.
- The existing action for selecting a gift and continuing to proposal review.

Expose useful exclusions and partial failures without presenting rejected products as recommendations. Keep the selected gift and the Muse's symbolic charm distinct. Product photos come from listing data; decorative graphics must never manufacture evidence about a product.

## 5. Preserve authority, privacy and recovery

Convex remains authoritative for room state. Enforce membership and ownership in server code. Process room-visible clues, or contributor-selected private input only within its authorized extraction flow. Do not broadcast private imports, raw memories, contribution caps or secrets through council progress events.

Keeper may check the stated gift budget. Private contribution limits remain with their owner and deterministic allocation code. Gift selection, approvals and payment actions continue through their existing permission and revision checks.

Create/reuse persisted jobs before external provider calls. Use stable run/job identifiers and idempotent event/result ingestion. A paid research timeout may already have started a provider job; reconcile it rather than automatically creating another charged run. Never put example.com/test fixtures in live research or make a replay look live.

## 6. Reuse graphics tools and licensed assets

The current lobby is the primary art reference. Research references for techniques and missing props, not a replacement visual identity. Reuse existing models and components before creating geometry.

Already installed: React Three Fiber, Drei, Three.js and Motion. Use these for model loading, skeletal animation, shared scene composition and the existing UI transitions. Avoid adding another animation engine or UI framework.

Useful researched sources:
- Drei useGLTF: https://drei.docs.pmnd.rs/loaders/gltf-use-gltf
- Drei useAnimations: https://drei.docs.pmnd.rs/abstractions/use-animations
- Drei repository/examples: https://github.com/pmndrs/drei
- R3F performance guidance: https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Motion React: https://motion.dev/docs/react
- gltfjsx repository: https://github.com/pmndrs/gltfjsx
- glTF Transform inspection/optimization: https://gltf-transform.dev/cli
- Kenney Nature Kit, CC0: https://kenney.nl/assets/nature-kit
- Quaternius Ultimate Stylized Nature Pack, CC0, including glTF: https://quaternius.com/packs/ultimatestylizednature.html

Kenney and Quaternius are candidates for missing foliage, stones or small environmental props. Review their silhouettes and textures against the actual lobby before importing them; harmonize materials and scale. Their availability is not a reason to replace working scenery. Use the finished original council characters for the agents.

Record each adopted asset's source URL, creator, exact license, local file and modifications in an asset manifest. Verify the particular download's terms. Import only the models needed, serve them locally and retain required notices. Pin any new tooling. Keep optimized copies separate and verify animations/materials after optimization. Do not add expensive postprocessing or download whole packs without a measured need.

## 7. Deploy through the teammate's existing Vercel setup

Inspect the existing Vercel project, connected repository, production branch, build settings and Convex deployment first. Reuse the team's deployment rather than creating a competing project. Explain any missing access or configuration specifically.

Deploy the Next.js site and public assets to Vercel, with the correct cloud Convex deployment. Preview and production environments must use the intended matching backend. Keep deployment keys and provider secrets server-side.

The Python uAgent currently runs a persistent process and accepts REST work before continuing asynchronously. Do not assume that putting `agent.py` in a Vercel Function will preserve that lifecycle. Inspect whether the teammate already hosts the agent somewhere reachable. Use that service if present; otherwise prepare the smallest persistent hosting solution for the existing agent, document the architectural decision, and configure its port, HTTPS URL, health checks and shutdown/recovery behavior. Do not add a queue, database or another service engine by default.

Set and verify the appropriate cloud Convex URLs, FETCH_AGENT_URL, council secrets and provider credentials in their proper services. Deployed routes must not depend on 127.0.0.1 or a developer laptop. Keep the same agent identity/seed where needed and recheck mailbox connectivity after migration. Separate ASI:One conversations from private web room data unless there is an explicit authorized association.

Relevant hosting references:
- Vercel Functions lifecycle: https://vercel.com/docs/functions
- Convex deployment environments: https://docs.convex.dev/production/multiple-deployments
- Vercel/Convex integration: https://vercel.com/marketplace/convex/convex
- A possible persistent HTTP service, if one is needed: https://render.com/docs/web-services

Complete local implementation and checks, then deploy a reviewable Vercel preview using the existing project. Report its real URL. Follow the teammate's established production promotion workflow and do not overwrite unrelated work.

## Acceptance checks

1. The original homepage island, intro, gift interaction, invitation flow and visual style remain recognizable and functional.
2. Creating/joining a room leads into the same island world, with persistent room context and no separate mandatory council scene.
3. All five distinct finished robots load and their real task/mechanism clips play correctly.
4. A real memory request produces persisted progress, a charm, actual sourced product cards and usable selection/proposal actions.
5. Refresh and reconnect restore results without duplicating jobs, products or decorations. One room cannot read another room's council results.
6. Missing credentials, failed/empty searches, uncertain timeouts and agent outages produce honest, actionable UI states.
7. Reduced motion, mobile, no-WebGL fallback and keyboard navigation remain usable. Measure loading size, draw calls and frame performance with all characters visible; preserve the existing adaptive quality behavior.
8. Run typecheck, relevant automated tests and the build. Exercise both happy and failure paths in a real browser, including the deployed preview. Verify the experience works when the developer laptop is not providing the backend.

Deliver the implementation, contract/documentation updates, asset-source manifest, test evidence and working preview URL. Clearly identify any remaining deployment or account blocker. Begin with an audit of the existing code and a short implementation sequence, then proceed with the integration.
