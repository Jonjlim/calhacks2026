"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ContributionSimulation } from "./ContributionSimulation";
import { ErrorText } from "@/components/ui/ErrorText";

/** Dev 1 mount point for an authenticated map box after the simulation backend is deployed. */
export function ConnectedContributionSimulation({ roomId, giftTitle }: { roomId: Id<"rooms">; giftTitle?: string }) {
  const state = useQuery(api.payments.simulation.getState, { roomId });
  const simulate = useMutation(api.payments.simulation.simulateContribution);
  const wrap = useMutation(api.payments.simulation.wrapGift);
  if (!state) return <p className="text-sm text-plum-soft">Loading contribution simulation…</p>;
  if (!state.ok) return <ErrorText error={state.error} />;
  const view = state.value;
  const revisionId = view.revisionId as Id<"proposalRevisions"> | null;
  return <ContributionSimulation key={view.revisionId ?? "none"} view={view} giftTitle={giftTitle}
    onSimulate={revisionId ? () => simulate({ roomId, revisionId }) : undefined}
    onWrap={revisionId ? () => wrap({ roomId, revisionId }) : undefined} />;
}
