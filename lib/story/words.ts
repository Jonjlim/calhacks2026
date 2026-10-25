/**
 * Words that came up most in a room's memories, for the story replay (D26). Pure.
 * Common words, the recipient's name, and gift-search filler are left out.
 */
const STOP = new Set(`a about after again all also always am an and any are as at be because been before being but by can could did do does doing
during each even ever every for from get gets getting go goes going got had has have having he her here hers herself him his how i if in into is it its
just like likes liked loves loved love lot lots me more most much my never no not now of off often on once one only or other our out over own really she
should so some still such than that the their them then there these they thing things this those through to too up us very was way we were what when
where which while who why will with would you your yours gift gifts idea ideas wants want wanted thinks think said says friend friends always maybe
someone something new year years day days time times kind sort mentioned talks talked keeps`.split(/\s+/));

export interface StoryWord { word: string; count: number }

export function topWords(texts: readonly string[], options: { exclude?: readonly string[]; limit?: number } = {}): StoryWord[] {
  const exclude = new Set((options.exclude ?? []).flatMap((s) => s.toLowerCase().split(/\s+/)));
  const counts = new Map<string, number>();
  for (const text of texts) {
    // Count a word once per memory, so one long memory can't drown the rest.
    const seen = new Set(text.toLowerCase().replace(/[’']s\b/g, "").match(/[a-z][a-z-]{2,}/g) ?? []);
    for (const word of seen) {
      if (STOP.has(word) || exclude.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts].map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, options.limit ?? 18);
}
