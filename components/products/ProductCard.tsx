import type { ProductListing } from "@/lib/contracts";
import { formatMinor } from "@/lib/money";

// PX-006: every card shows source URL, observed price, and retrieval time.
export function ProductCard({ listing }: { listing: ProductListing }) {
  return (
    <article className="flex flex-col gap-1 rounded-xl border border-plum/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium">{listing.title}</h3>
        {listing.source === "manual_fixture" && (
          <span className="rounded bg-coral/15 px-2 text-xs text-coral">fixture</span>
        )}
      </div>
      <p className="text-sm">
        {listing.priceStatus === "observed" && listing.priceMinor !== undefined
          ? formatMinor(listing.priceMinor, listing.currency)
          : "Price unknown"}
      </p>
      <p className="text-xs text-plum-soft">
        Observed {new Date(listing.retrievedAt).toLocaleString()} ·{" "}
        <a href={listing.sourceUrl} target="_blank" rel="noreferrer" className="underline">
          source
        </a>
      </p>
    </article>
  );
}
