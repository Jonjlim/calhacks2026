"use client";

import { addToGiftBox, giftIsInBox } from "@/lib/room/giftBox";

import type { ResearchJobRow, RoomActions, VoteSummary } from "@/components/room/types";
import { Button } from "@/components/ui/Button";
import { ErrorText } from "@/components/ui/ErrorText";
import { Panel } from "@/components/ui/Panel";
import type { GiftSelection, ProductListing, PublishedClue, Recommendation, VoteValue } from "@/lib/contracts";
import { useResultAction } from "@/lib/useResultAction";
import { ProductCard } from "./ProductCard";

type ShortlistActions = Pick<RoomActions, "startResearch" | "castVote" | "clearVote" | "selectGift" | "addGiftToBox">;

// PX-007 / PX-009: shortlist, "Why this?", select and vote controls.
export function ProductShortlist({
  recommendations,
  listings,
  publishedClues,
  votes,
  selection,
  isOrganizer,
  latestResearch,
  actions,
}: {
  recommendations: Recommendation[];
  listings: ProductListing[];
  publishedClues: PublishedClue[];
  votes: Record<string, VoteSummary>;
  selection: GiftSelection | null;
  isOrganizer: boolean;
  latestResearch?: ResearchJobRow | null;
  actions?: ShortlistActions;
}) {
  const byId = new Map(listings.map((l) => [l.id, l]));
  const clueText = new Map(publishedClues.map((c) => [c.id, c.text]));
  const search = useResultAction(actions?.startResearch);
  const activeClueIds = publishedClues.filter((c) => c.status === "active").map((c) => c.id);
  const searching = latestResearch?.status === "pending" || latestResearch?.status === "running";

  return (
    <Panel title="Shortlist">
      {actions && (
        <div className="mb-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <ResearchStatus job={latestResearch} />
            <Button
              variant="primary"
              disabled={search.pending || searching || activeClueIds.length === 0}
              onClick={() => search.run(activeClueIds)}
              title={activeClueIds.length === 0 ? "Publish a clue first" : undefined}
            >
              {searching ? "Searching…" : recommendations.length ? "Search again" : "Find gift ideas"}
            </Button>
          </div>
          <ErrorText error={search.error} />
        </div>
      )}
      {recommendations.length === 0 ? (
        <p className="text-sm text-plum-soft">
          {latestResearch?.status === "succeeded"
            ? "No listings fit the room's clues. Try adding an interest or wish and search again."
            : "Publish an interest or wish, then search for real listings."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {recommendations.map((r) => {
            const listing = byId.get(r.listingId);
            if (!listing) return null;
            return (
              <ShortlistItem
                key={r.id}
                recommendation={r}
                listing={listing}
                clueTexts={r.publishedClueIds.map((id) => clueText.get(id)).filter((t): t is string => !!t)}
                vote={votes[listing.id]}
                selected={giftIsInBox(selection, listing.id)}
                selection={selection}
                isOrganizer={isOrganizer}
                actions={actions}
              />
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function ShortlistItem({
  recommendation,
  listing,
  clueTexts,
  vote,
  selected,
  selection,
  isOrganizer,
  actions,
}: {
  recommendation: Recommendation;
  listing: ProductListing;
  clueTexts: string[];
  vote?: VoteSummary;
  selected: boolean;
  selection: GiftSelection | null;
  isOrganizer: boolean;
  actions?: ShortlistActions;
}) {
  const cast = useResultAction(actions?.castVote);
  const clear = useResultAction(actions?.clearVote);
  const select = useResultAction(actions ? (id: string) => addToGiftBox(actions, selection, id) : undefined);
  const busy = cast.pending || clear.pending;

  function toggle(value: VoteValue) {
    if (vote?.myVote === value) void clear.run(listing.id);
    else void cast.run(listing.id, value);
  }

  return (
    <div className={`flex flex-col gap-1.5 ${selected ? "rounded-xl ring-2 ring-coral/60" : ""}`}>
      <ProductCard listing={listing} />
      <p className="text-xs text-plum-soft">
        <span className="font-medium text-plum">Why this?</span> {recommendation.explanation}
      </p>
      {clueTexts.length > 0 && <p className="text-[11px] text-plum-soft">Based on: {clueTexts.join(" · ")}</p>}
      {actions && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => toggle("up")} aria-pressed={vote?.myVote === "up"} className={vote?.myVote === "up" ? "bg-plum/10" : ""}>
            Love it · {vote?.tally.up ?? 0}
          </Button>
          <Button disabled={busy} onClick={() => toggle("down")} aria-pressed={vote?.myVote === "down"} className={vote?.myVote === "down" ? "bg-plum/10" : ""}>
            Not quite · {vote?.tally.down ?? 0}
          </Button>
          {selected ? (
            <span className="rounded-full bg-coral/15 px-3 py-1 text-[12px] font-medium text-coral">In the gift box</span>
          ) : (
            isOrganizer && (
              <Button variant="primary" disabled={select.pending || listing.status === "invalid"} onClick={() => select.run(listing.id)}>
                Add to gift box
              </Button>
            )
          )}
        </div>
      )}
      <ErrorText error={cast.error ?? clear.error ?? select.error} />
    </div>
  );
}

function ResearchStatus({ job }: { job?: ResearchJobRow | null }) {
  if (!job) return <span className="text-[12px] text-plum-soft">Search real listings using the room&apos;s clues.</span>;
  switch (job.status) {
    case "pending":
    case "running":
      return <span className="text-[12px] text-plum-soft italic">Searching real listings…</span>;
    case "succeeded":
      return <span className="text-[12px] text-plum-soft">Last searched {new Date(job.createdAt).toLocaleTimeString()}</span>;
    case "stale":
      return <span className="text-[12px] text-plum-soft">The clues changed during the search. Search again.</span>;
    case "uncertain":
      return <span className="text-[12px] text-[#8c3b2c]">Search result is unresolved{job.lastError ? `: ${job.lastError}` : "."}</span>;
    default:
      return <span className="text-[12px] text-[#8c3b2c]">Search failed{job.lastError ? `: ${job.lastError}` : "."}</span>;
  }
}
