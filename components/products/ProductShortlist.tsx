import type { ProductListing, Recommendation } from "@/lib/contracts";
import { Panel } from "@/components/ui/Panel";
import { ProductCard } from "./ProductCard";
import { WhyThis } from "./WhyThis";

// PX-007 / PX-009: shortlist, "Why this?", select and vote controls.
export function ProductShortlist({
  recommendations,
  listings,
  clueTextById = new Map(),
  cluesReady = true,
  citedListingIds = new Set(),
}: {
  recommendations: Recommendation[];
  listings: ProductListing[];
  clueTextById?: Map<string, { kind: string; text: string }>;
  cluesReady?: boolean;
  citedListingIds?: Set<string>;
}) {
  const byId = new Map(listings.map((l) => [l.id, l]));
  return (
    <Panel title="Shortlist">
      <div className="flex flex-col gap-3">
        {recommendations.map((r) => {
          const listing = byId.get(r.listingId);
          if (!listing) return null;
          return (
            <div key={r.id} className="flex flex-col gap-1">
              <ProductCard listing={listing} agentCited={citedListingIds.has(listing.id)} />
              <WhyThis
                recommendation={r}
                listing={listing}
                clueTextById={clueTextById}
                cluesReady={cluesReady}
              />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
