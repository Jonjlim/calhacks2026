import { CLUE_KIND_LABELS } from "@/components/clues/labels";
import { Panel } from "@/components/ui/Panel";
import type { ProductListing, PublishedClue, Recommendation } from "@/lib/contracts";

// PX-008: lightweight clue → gift map, drawn as a list.
export function GiftMap({
  recommendations,
  listings,
  publishedClues,
}: {
  recommendations: Recommendation[];
  listings: ProductListing[];
  publishedClues: PublishedClue[];
}) {
  const titles = new Map(listings.map((l) => [l.id, l.title]));
  const clues = publishedClues.filter((c) => c.status === "active");

  return (
    <Panel title="Gift map">
      {clues.length === 0 || recommendations.length === 0 ? (
        <p className="text-sm text-plum-soft">Clues and gift ideas connect here after a search.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {clues.map((clue) => {
            const linked = recommendations.filter((r) => r.publishedClueIds.includes(clue.id));
            return (
              <li key={clue.id} className="text-sm">
                <span className="font-medium">{CLUE_KIND_LABELS[clue.kind]}</span>: {clue.text}
                {linked.length === 0 ? (
                  <p className="text-[12px] text-plum-soft">No gift uses this yet.</p>
                ) : (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {linked.map((r) => (
                      <li key={r.id} className="rounded-full bg-plum/5 px-2 py-0.5 text-[12px] text-plum">
                        → {titles.get(r.listingId) ?? "Listing"}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
