/**
 * SAMPLE SESSION REPLAY — not a live run.
 *
 * A fixed recording of the pottery demo's event sequence, for showing the
 * council visuals when the venue network is down. The UI must label it as a
 * replay; it is never presented as fresh agent output. Timings are only for
 * pacing the replay. Live runs are driven purely by stored Convex events.
 */
import type { CouncilEvent, DecorationSpec } from "./contracts";

export const SAMPLE_RUN_ID = "run_sample_pottery";
export const SAMPLE_MEMORY = "Maya loves pottery and handmade crafts, wants to try a pottery class, already owns a beginner kit, and the budget is $80.";

export const SAMPLE_DECORATION: DecorationSpec = {
  memoryId: "mem_sample_pottery",
  jar: "wish",
  assetId: "ceramic_charm",
  color: "terracotta",
  placement: "front_ribbon",
  label: "Pottery",
};

type Step = { at: number; actor: CouncilEvent["actor"]; status: CouncilEvent["status"]; result?: CouncilEvent["result"] };

const STEPS: Step[] = [
  { at: 0, actor: "courier", status: "started", result: { summary: "Coordinating 1 memory" } },
  { at: 300, actor: "archivist", status: "started" },
  { at: 2200, actor: "archivist", status: "completed", result: { summary: "loves: pottery, handmade crafts; wants: pottery class; owns: beginner kit; budget $80", count: 4 } },
  { at: 2400, actor: "muse", status: "started" },
  { at: 2450, actor: "scout", status: "started" },
  { at: 4200, actor: "muse", status: "completed", result: { summary: "Pottery charm", decorations: [SAMPLE_DECORATION] } },
  { at: 7800, actor: "scout", status: "completed", result: { summary: "Found 9 real listings for pottery class, pottery", count: 9, cached: true } },
  { at: 8000, actor: "keeper", status: "started" },
  { at: 9600, actor: "keeper", status: "completed", result: { summary: "5 fit, 4 excluded · Observed price at or under $80.00", count: 5 } },
  { at: 10600, actor: "courier", status: "completed", result: { summary: "Delivered 5 recommendations", count: 5 } },
];

export const SAMPLE_SESSION: { at: number; event: CouncilEvent }[] = STEPS.map((s, i) => ({
  at: s.at,
  event: {
    eventId: `ev_sample_${String(i).padStart(2, "0")}`,
    runId: SAMPLE_RUN_ID,
    actor: s.actor,
    task: ({ archivist: "analyze_memories", muse: "design_decoration", scout: "research_gifts", keeper: "check_constraints", courier: "deliver_recommendations" } as const)[s.actor],
    status: s.status,
    sequence: i,
    timestamp: 1_761_300_000_000 + s.at,
    ...(s.result ? { result: s.result } : {}),
  },
}));
