import type { ProposedClue } from "@/lib/contracts";
import { Panel } from "@/components/ui/Panel";

// PX-004: only the owning contributor sees this. Publish/reject buttons call
// api.clues.publishClue once BE-005 lands.
export function ProposedClueReview({ clues }: { clues: ProposedClue[] }) {
  return (
    <Panel title="Your proposed clues (private)">
      {clues.length === 0 ? (
        <p className="text-sm text-plum-soft">Paste messages to propose clues.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clues.map((c) => (
            <li key={c.id} className="text-sm">
              <span className="font-medium">{c.kind}</span>: {c.text}{" "}
              <span className="text-plum-soft">({Math.round(c.confidence * 100)}%)</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
