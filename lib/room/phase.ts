/**
 * The room's current phase, derived only from stored room state, so every
 * device shows the same phase and nothing is invented client-side. Phases
 * move forward as the real data changes:
 *
 *   collect      → nobody has asked the council yet (or the last request ended without gifts)
 *   researching  → a council request is running (or interrupted and resumable)
 *   review       → real recommendations exist; vote, and the organizer chooses one
 *   approve      → a gift is chosen and a contribution proposal awaits approvals
 *   done         → the proposal is fully approved
 */
export type RoomPhase = "collect" | "researching" | "review" | "approve" | "done";

export interface PhaseInput {
  councilStatus?: "running" | "uncertain" | "completed" | "partial" | "failed" | null;
  recommendationCount: number;
  proposalStatus?: string | null;
}

export function roomPhase({ councilStatus, recommendationCount, proposalStatus }: PhaseInput): RoomPhase {
  if (proposalStatus === "approved_pledged" || proposalStatus === "ready_to_capture" || proposalStatus === "capturing" || proposalStatus === "captured") return "done";
  if (proposalStatus === "awaiting_approval" || proposalStatus === "infeasible" || proposalStatus === "draft" || proposalStatus === "authorizing") return "approve";
  if (councilStatus === "running" || councilStatus === "uncertain") return "researching";
  if (recommendationCount > 0) return "review";
  return "collect";
}

export const PHASE_LABEL: Record<RoomPhase, string> = {
  collect: "Gathering memories",
  researching: "The council is researching",
  review: "Choosing a gift",
  approve: "Approving shares",
  done: "All set",
};
