"use client";

import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { Panel } from "@/components/ui/Panel";
import { MediaDrop } from "./MediaDrop";

/** Photos and chat screenshots as private evidence. Read once by the extractor, then the files are deleted. */
export function MediaIntake({ roomId }: { roomId: Id<"rooms"> }) {
  const [kind, setKind] = useState<"photo" | "screenshot">("photo");
  return (
    <Panel title="Photos and screenshots (private)">
      <div className="mb-3 flex gap-2">
        {(["photo", "screenshot"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`rounded border px-3 py-1 text-sm ${kind === k ? "bg-plum text-ivory" : ""}`}
          >
            {k === "photo" ? "Photos" : "Screenshot"}
          </button>
        ))}
      </div>
      <MediaDrop key={kind} roomId={roomId} kind={kind} />
    </Panel>
  );
}
