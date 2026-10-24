"use client";

import { useEffect, useState } from "react";
import type { ProductListing } from "@/lib/contracts";
import { formatMinor } from "@/lib/money";
import { getPriceFreshness } from "@/lib/research/freshness";

const AVAILABILITY_LABELS: Record<ProductListing["availability"], string | null> = {
  in_stock: "In stock",
  limited: "Limited stock",
  unavailable: "Unavailable",
  unknown: null,
};

// PX-006: every card shows source URL, observed price, and retrieval time.
export function ProductCard({ listing }: { listing: ProductListing }) {
  // Freshness depends on the clock, so compute it after mount to keep SSR and hydration identical.
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [listing.imageUrl]);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const freshness = now === null ? null : getPriceFreshness(listing, now);
  const availability = AVAILABILITY_LABELS[listing.availability];

  return (
    <article className="flex gap-3 rounded-xl border border-plum/10 bg-white/60 p-3">
      {listing.imageUrl && !imageFailed ? (
        <img src={listing.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" onError={() => setImageFailed(true)} />
      ) : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-paper px-2 text-center text-[10px] text-dusk/55">Photo unavailable</div>}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium">{listing.title}</h3>
          {listing.source === "manual_fixture" && <span className="rounded bg-coral/15 px-2 text-xs text-coral">fixture</span>}
        </div>
        <p className="text-sm">
          {listing.priceStatus === "observed" && listing.priceMinor !== undefined
            ? formatMinor(listing.priceMinor, listing.currency)
            : "Price unknown"}
          {listing.shippingStatus === "observed" && listing.shippingMinor !== undefined
            ? ` + ${formatMinor(listing.shippingMinor, listing.currency)} shipping`
            : " · shipping unknown"}
          {availability && ` · ${availability}`}
        </p>
        <p className="text-xs text-plum-soft">
          {listing.sellerName && `${listing.sellerName} · `}
          Observed {new Date(listing.retrievedAt).toLocaleString()}
          {freshness?.needsRefresh && ` · ${freshness.label}`} ·{" "}
          <a href={listing.sourceUrl} target="_blank" rel="noreferrer" className="underline">
            source
          </a>
        </p>
      </div>
    </article>
  );
}
