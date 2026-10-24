import type { ProductListing, Recommendation } from "@/lib/contracts";
import { Panel } from "@/components/ui/Panel";
import { ProductCard } from "./ProductCard";

// PX-007 / PX-009: shortlist, "Why this?", select and vote controls.
export function ProductShortlist({
  recommendations,
  listings,
}: {
  recommendations: Recommendation[];
  listings: ProductListing[];
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
              <ProductCard listing={listing} />
              <p className="text-xs text-plum-soft">Why this? {r.explanation}</p>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
