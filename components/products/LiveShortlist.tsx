"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ProductShortlist } from "@/components/products/ProductShortlist";
import { Panel } from "@/components/ui/Panel";
import { unwrap } from "@/lib/live/result";

export function LiveShortlist({ roomId }: { roomId: Id<"rooms"> }) {
  const view = unwrap(useQuery(api.research.research.listRecommendations, { roomId }));
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
  return <ProductShortlist recommendations={view.value.recommendations} listings={view.value.listings} />;
}
