/**
 * Keeping themes steady while the council regroups (D23 trial). Pure.
 *
 * Themes regroup on their own as memories arrive, so a regroup must not feel
 * like a reshuffle. Each new grouping inherits an existing theme's identity
 * (its id, and so its island, position and votes) when they share at least a
 * third of their memories; the strongest overlaps pair up first. Only themes
 * with no counterpart are added or removed.
 */
export const MIN_OVERLAP = 1 / 3;

export interface ThemeRow<Id extends string = string> { id: Id; label: string; clueIds: readonly string[] }
export interface ThemeDraft { label: string; clueIds: readonly string[] }

export function matchThemes<Id extends string>(old: readonly ThemeRow<Id>[], next: readonly ThemeDraft[]): {
  keep: { id: Id; label: string; clueIds: string[] }[];
  add: ThemeDraft[];
  drop: Id[];
  /** True when any theme's memories or label actually changed. */
  changed: boolean;
} {
  const overlap = (a: readonly string[], b: readonly string[]) => {
    const as = new Set(a);
    const shared = b.filter((x) => as.has(x)).length;
    return shared / new Set([...a, ...b]).size;
  };
  const pairs: { o: number; n: number; score: number }[] = [];
  old.forEach((o, oi) => next.forEach((n, ni) => {
    const score = overlap(o.clueIds, n.clueIds);
    if (score >= MIN_OVERLAP) pairs.push({ o: oi, n: ni, score });
  }));
  pairs.sort((a, b) => b.score - a.score || a.o - b.o || a.n - b.n);
  const takenOld = new Set<number>();
  const takenNew = new Set<number>();
  const keep: { id: Id; label: string; clueIds: string[] }[] = [];
  let changed = false;
  for (const p of pairs) {
    if (takenOld.has(p.o) || takenNew.has(p.n)) continue;
    takenOld.add(p.o);
    takenNew.add(p.n);
    const o = old[p.o]!;
    const n = next[p.n]!;
    if (o.label !== n.label || o.clueIds.length !== n.clueIds.length || o.clueIds.some((id) => !n.clueIds.includes(id))) changed = true;
    keep.push({ id: o.id, label: n.label, clueIds: [...n.clueIds] });
  }
  const add = next.filter((_, i) => !takenNew.has(i));
  const drop = old.filter((_, i) => !takenOld.has(i)).map((o) => o.id);
  return { keep, add, drop, changed: changed || add.length > 0 || drop.length > 0 };
}
