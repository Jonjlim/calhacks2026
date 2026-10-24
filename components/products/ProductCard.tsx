import type { ProductListing } from "@/lib/contracts";
import { formatMinor } from "@/lib/money";
import { hasProductImageUrl } from "@/lib/research/images";

// PX-006: every card shows source URL, observed price, and retrieval time.
export function ProductCard({
  listing,
  agentCited = false,
}: {
  listing: ProductListing;
  agentCited?: boolean;
}) {
  return (
    <article className="flex gap-3 rounded-xl border border-plum/10 p-3">
      {hasProductImageUrl(listing) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={listing.imageUrl} alt={listing.title} className="h-20 w-20 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-plum/5 p-1 text-center text-[10px] text-plum-soft">
          no photo from source
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium">{listing.title}</h3>
          <div className="flex shrink-0 gap-1">
            {agentCited && (
              <span className="rounded bg-plum/10 px-2 text-xs text-plum">Agent cited this</span>
            )}
            {listing.source === "manual_fixture" && (
              <span className="rounded bg-coral/15 px-2 text-xs text-coral">fixture</span>
            )}
          </div>
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
      </div>
    </article>
  );
}
