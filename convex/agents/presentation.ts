import type { AgentCitations } from "../../lib/contracts";
import { formatMinor } from "../../lib/money";
import type { ModelDecision } from "../../lib/validation";
import type { BuyerSnapshot } from "./engine";

const clip = (text: string, max: number) =>
  text.length > max ? text.slice(0, max - 1) + "…" : text;

/** Purchase facts and evidence are copied from the current catalog, never from model-written prose. */
export function renderRecommendation(
  decision: Extract<ModelDecision, { intent: "recommend" }>,
  snapshot: BuyerSnapshot,
): { body: string; citations: AgentCitations } {
  const listingIds = [...new Set(decision.citations.listingIds)].slice(0, 3);
  const clueIds = new Set<string>();
  const parts = listingIds.map((id) => {
    const listing = snapshot.listings.find((row) => row.id === id)!;
    const rec = snapshot.recommendations.find((row) => row.listingId === id)!;
    for (const clueId of rec.publishedClueIds) clueIds.add(clueId);
    const clues = rec.publishedClueIds
      .map((clueId) =>
        snapshot.publishedClues.find((clue) => clue.id === clueId),
      )
      .filter((row): row is BuyerSnapshot["publishedClues"][number] => !!row)
      .slice(0, 2);
    const price =
      listing.priceStatus === "observed" && listing.priceMinor !== undefined
        ? `${formatMinor(listing.priceMinor)} observed item price`
        : "Item price unknown";
    const observationDate = new Date(listing.retrievedAt);
    const observed = Number.isFinite(observationDate.getTime())
      ? observationDate.toISOString()
      : "unknown";
    const shipping =
      listing.shippingStatus === "observed" &&
      listing.shippingMinor !== undefined
        ? `Observed shipping: ${formatMinor(listing.shippingMinor)}.`
        : "Shipping is unconfirmed.";
    return `“${clip(listing.title, 120)}” — ${price} (observed ${observed}).\nFits: ${clues.map((clue) => `“${clip(clue.text, 120)}”`).join("; ")}. ${shipping} Availability: ${listing.availability ?? "unknown"}.`;
  });
  const changed =
    snapshot.trigger === "knowledge_changed"
      ? "I re-evaluated the existing options against the updated clues.\n\n"
      : "Here are sourced options supported by the group's confirmed clues:\n\n";
  return {
    body:
      changed +
      parts.join("\n\n") +
      "\n\nCheck the linked sources for final tax, delivery, and current availability. These are observations, not a purchase quote.",
    citations: {
      listingIds,
      publishedClueIds: [...clueIds],
      ...(snapshot.research?.poolJobId
        ? { researchJobId: snapshot.research.poolJobId }
        : {}),
    },
  };
}

export function researchStatusMessage(snapshot: BuyerSnapshot): string | null {
  if (snapshot.trigger !== "research_completed") return null;
  if (snapshot.research?.status === "uncertain")
    return "Product research timed out and its outcome is still uncertain. I have not started another search. Previously retrieved options may remain visible with their observation dates.";
  if (snapshot.research?.status === "failed")
    return "Product research did not return usable results. I have not started another search. You can change the brief or explicitly try again; previously retrieved options may remain visible.";
  return null;
}
