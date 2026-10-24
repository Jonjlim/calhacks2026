import type { PublishedClue } from "@/lib/contracts";
import { Panel } from "@/components/ui/Panel";

// PX-005: room-visible knowledge.
export function PublishedClueRail({ clues }: { clues: PublishedClue[] }) {
  return (
    <Panel title="What the room knows">
      <ul className="flex flex-col gap-2">
        {clues
          .filter((c) => c.status === "active")
          .map((c) => (
            <li key={c.id} className="text-sm">
              <span className="font-medium">{c.kind}</span>: {c.text}
            </li>
          ))}
      </ul>
    </Panel>
  );
}
