/**
 * Plain-code text helpers shared by brief building and scoring. Owner: Dev 4.
 * Deliberately simple keyword matching: deterministic, testable, and easy to
 * replace with a Dev 3 model-generated brief behind the same function shapes.
 */

const FRAMING_PREFIX =
  /^(?:(?:she|he|they|maya)\s+)?(?:(?:really|kind of|kinda|also)\s+)?(?:is\s+|are\s+)?(?:interested in|into|likes?|loves?|enjoys?|wants?(?: to)?(?: (?:try|take|learn|get|do))?|wishes?(?: for)?|would love(?: to)?(?: (?:try|take|learn|get))?|already (?:owns?|has|have|bought|got)|owns?|has|have|bought|got|hates?|dislikes?|(?:does not|doesn't|don't|do not) (?:like|want|need)|no more|not)\s+/i;

const LEADING_ARTICLE = /^(?:a|an|the|some|more|another|any)\s+/i;
const TRAILING_FILLER = /\s+(?:lately|recently|this year|next year|anymore|any more|again|too)$/i;

const STOPWORDS = new Set([
  "a", "an", "and", "any", "for", "her", "his", "in", "of", "on", "or", "some",
  "the", "their", "them", "to", "with", "she", "he", "they", "it", "its", "is",
  "set", "piece", "pcs", "pc",
]);

/** Synonyms that should count as the same word when matching titles. */
const CANONICAL: Record<string, string> = {
  beginner: "starter",
  beginners: "starter",
  classes: "class",
  lesson: "class",
  lessons: "class",
  workshop: "class",
};

/** Strips framing like "Already owns a" from a clue so only the subject remains. */
export function cluePhrase(text: string): string {
  let phrase = text.trim().replace(/[.!?]+$/, "").trim();
  phrase = phrase.replace(FRAMING_PREFIX, "");
  phrase = phrase.replace(LEADING_ARTICLE, "");
  phrase = phrase.replace(TRAILING_FILLER, "");
  return phrase.trim().toLowerCase();
}

function stem(word: string): string {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

/** Lowercase content tokens with stopwords removed and simple synonyms merged. */
export function contentTokens(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => CANONICAL[t] ?? stem(t))
    .map((t) => CANONICAL[t] ?? t);
  return [...new Set(tokens)];
}
