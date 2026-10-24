import type { ClueKind } from "@/lib/contracts";

export const CLUE_KIND_LABELS: Record<ClueKind, string> = {
  interest: "Interest",
  explicit_wish: "Wish",
  exclusion: "Avoid",
  ownership: "Already owns",
  timing: "Timing",
  uncertain: "Maybe",
};

export const CLUE_KINDS = Object.keys(CLUE_KIND_LABELS) as ClueKind[];
