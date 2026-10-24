"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ProductShortlist } from "@/components/products/ProductShortlist";
import { Panel } from "@/components/ui/Panel";
import { unwrap } from "@/lib/live/result";

export function LiveShortlist({ roomId }: { roomId: Id<"rooms"> }) {
  const view = unwrap(useQuery(api.research.research.listRecommendations, { roomId }));
  const clues = unwrap(useQuery(api.clues.listPublishedClues, { roomId }));
  const messages = unwrap(useQuery(api.messages.listMessages, { roomId }));

  const clueTextById = useMemo(
    () => new Map((clues.value ?? []).map((c) => [String(c._id), { kind: c.kind, text: c.text }])),
    [clues.value],
  );
  const citedListingIds = useMemo(() => {
    const latest = [...(messages.value ?? [])].reverse().find((m) => m.authorKind === "buyer_agent");
    return new Set<string>((latest?.citations?.listingIds ?? []).map(String));
  }, [messages.value]);

  if (view.loading) return <Panel title="Shortlist"><p className="text-sm text-plum-soft">Loading…</p></Panel>;
  if (view.error) return <Panel title="Shortlist"><p className="text-sm text-coral">{view.error.message}</p></Panel>;
  if (!view.value || view.value.recommendations.length === 0)
    return (
      <Panel title="Shortlist">
        <p className="text-sm text-plum-soft">
          No options yet. Publish a few clues, then ask Unwrap to look.
        </p>
      </Panel>
    );
  return (
    <>
      {clues.error && (
        <p className="mb-2 text-sm text-coral">Could not load the supporting clues: {clues.error.message}</p>
      )}
      <ProductShortlist
        recommendations={view.value.recommendations}
        listings={view.value.listings}
        clueTextById={clueTextById}
        cluesReady={!clues.loading && !clues.error}
        citedListingIds={citedListingIds}
      />
    </>
  );
}
