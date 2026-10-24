"use client";

import { useState } from "react";
import type { ProductListing, Recommendation } from "@/lib/contracts";
import { formatMinor } from "@/lib/money";
import { getPriceFreshness } from "@/lib/research/freshness";

const AVAILABILITY: Record<ProductListing["availability"], string> = {
  in_stock: "In stock",
  limited: "Limited stock",
  unavailable: "Unavailable",
  unknown: "Availability unknown",
};

/** Expandable evidence for one recommendation. Clue text comes only from published clues; unknown ids are labeled, not invented. */
export function WhyThis({
  recommendation,
  listing,
  clueTextById,
  cluesReady,
}: {
  recommendation: Recommendation;
  listing: ProductListing;
  clueTextById: Map<string, { kind: string; text: string }>;
  cluesReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const freshness = getPriceFreshness(listing, Date.now());
  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-xs font-medium text-coral underline"
      >
        {open ? "Hide why" : "Why this?"}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg bg-plum/5 p-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-plum">Supporting clues</p>
            {recommendation.publishedClueIds.length === 0 ? (
              <p className="text-plum-soft">No published clue is linked to this option.</p>
            ) : !cluesReady ? (
              <p className="text-plum-soft">Loading clues…</p>
            ) : (
              <ul className="list-disc pl-5">
                {recommendation.publishedClueIds.map((id) => {
                  const clue = clueTextById.get(id);
                  return (
                    <li key={id}>
                      {clue ? (
                        <>
                          <span className="font-medium">{clue.kind}</span>: {clue.text}
                        </>
                      ) : (
                        <span className="text-plum-soft">clue no longer available</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p>{recommendation.explanation}</p>
          <ul className="text-xs text-plum-soft">
            <li>
              {listing.priceStatus === "observed" && listing.priceMinor !== undefined
                ? `Observed ${formatMinor(listing.priceMinor, listing.currency)}`
                : "Price unknown"}{" "}
              · {freshness.label} · retrieved {new Date(listing.retrievedAt).toLocaleString()}
            </li>
            <li>{AVAILABILITY[listing.availability]}</li>
            <li>
              <a href={listing.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                Open source listing
              </a>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
