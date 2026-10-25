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

/**
 * Wording guard, not an image classifier. A visual observation or a tentative
 * guess must be reviewed/reclassified before it can drive search or ownership.
 */
export function isUnconfirmedObservation(text: string): boolean {
  const subject = text.trim().toLowerCase()
    .replace(/^(?:she|he|they|maya|the recipient)\s+/, "")
    .replace(/^(?:is|are|was|were)\s+/, "");
  return /^(?:might|may|could|possibly|probably|seems?|appears?|looks? like)\b/.test(subject)
    || /^(?:(?:seen|shown|pictured|photographed|observed)(?:\s+to be)?\s+)?(?:wearing|holding|carrying|using|standing|posing)\b/.test(subject)
    || /^(?:in|from) (?:this |the |a )?(?:photo|picture|image)\b/.test(subject);
}

// Habit and enthusiasm framing: "plays tennis", "collects vinyl", "obsessed with matcha".
const HABIT_PREFIX = /^(?:(?:she|he|they)\s+)?(?:(?:really|always|also|totally|so)\s+)?(?:is\s+|are\s+)?(?:(?:a\s+)?(?:big\s+|huge\s+)?fan of|obsessed with|crazy about|passionate about|addicted to|hooked on|always talking about|plays?|playing|collects?|collecting|practices?|practicing|goes|going|does|doing|makes?|making|started|getting into|got into)\s+/;
const HABIT_SUFFIX = /\s+(?:every\s+(?:day|week|weekend|morning|night|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:night|morning|evening))?|on\s+(?:the\s+)?weekends?|all the time|a lot|in (?:her|his|their) (?:free|spare) time|whenever (?:she|he|they) can)$/;
// Fixed phrases where "and" is part of the thing, not two interests.
const JOINED = /\b(?:salt and pepper|rock and roll|black and white|mac and cheese|arts and crafts|dungeons and dragons|bed and breakfast)\b/;

/** Remove generic preference framing; leave actual product/style words intact. */
export function shoppingPhrase(text: string): string {
  let phrase = cluePhrase(text)
    .replace(/^(?:prefers?|drawn to)\s+/, "")
    .replace(/\s+(?:style|styles|aesthetic|look)$/, "");
  for (let i = 0; i < 2; i++) phrase = phrase.replace(HABIT_PREFIX, "").replace(HABIT_SUFFIX, "").replace(LEADING_ARTICLE, "");
  phrase = phrase.trim();
  // "Loves to bowl" is about bowling, not bowls: a lone verb after "to" becomes its activity.
  const verb = /^to ([a-z]+)$/.exec(phrase);
  return verb ? activity(verb[1]!) : phrase.replace(/^to\s+/, "");
}

function activity(verb: string): string {
  if (verb.endsWith("ing")) return verb;
  if (/[^aeiou]e$/.test(verb) && !verb.endsWith("ee")) return verb.slice(0, -1) + "ing";
  if (/^[^aeiou]*[aeiou][bdgklmnprt]$/.test(verb)) return verb + verb.at(-1) + "ing";
  return verb + "ing";
}

/** One clue can name up to three interests ("hiking and camping"); each becomes its own search phrase. */
export function shoppingPhrases(text: string): string[] {
  const phrase = shoppingPhrase(text);
  if (!phrase || JOINED.test(phrase)) return phrase ? [phrase] : [];
  const parts = phrase.split(/\s*(?:,|&|\band\b)\s*/).map(p => p.replace(LEADING_ARTICLE, "").trim()).filter(Boolean);
  return parts.length > 1 && parts.length <= 3 ? parts : [phrase];
}

/**
 * Retail brands whose names contain hobby words. "Pottery Barn" sells home
 * decor, so its name is not evidence that a vase suits a pottery hobbyist.
 * Small explicit list; studio names like "Farmhouse Pottery" stay matchable.
 */
const BRAND_PHRASES = [/\bpottery\s+barn(?:\s+(?:kids|teen))?\b/g, /\bbass\s+pro(?:\s+shops)?\b/g];

export function withoutBrandPhrases(text: string): string {
  return BRAND_PHRASES.reduce((t, brand) => t.replace(brand, " "), text.toLowerCase());
}

/** Things you do the hobby with, as opposed to decor that mentions it. Stemmed forms. */
const HANDS_ON_TOKENS = new Set(["kit", "class", "tool", "starter", "supply", "supplie", "course"]);

export function isHandsOnItem(text: string): boolean {
  return contentTokens(text).some((token) => HANDS_ON_TOKENS.has(token));
}

const SHOPPING_ALIASES: Record<string, string> = {
  minimalist: "minimal",
  retro: "vintage",
  jean: "denim",
  jeans: "denim",
  climbing: "climb",
  climber: "climb",
};
const JEWELRY_ITEMS = new Set(["jewelry", "jewellery", "earring", "necklace", "bracelet", "pendant", "bangle"]);
const PALETTE_COLORS = new Set(["olive", "terracotta", "beige", "tan", "brown"]);
const VISIBLE_STYLE_ITEMS = new Set([
  "jacket", "shirt", "tshirt", "sweater", "hoodie", "scarf", "tote", "bag",
  "blanket", "cushion", "vase", "planter", "mug", "hat", "cap", "trouser", "pant",
]);

/**
 * Small, explicit catalog vocabulary for positive preference matching only.
 * Ownership/exclusion matching continues to use literal contentTokens so e.g.
 * owning jeans does not imply owning every denim product.
 */
export function shoppingMatchTokens(text: string): string[] {
  const phrase = text.toLowerCase()
    .replace(/\brock[\s-]+climbing\b/g, "climbing")
    .replace(/\bwheel[\s-]+throwing\b/g, "pottery wheel")
    .replace(/\bearth[\s-]+(?:tones?|toned)\b/g, "earthtone");
  const tokens = contentTokens(phrase).map(token => SHOPPING_ALIASES[token] ?? token);
  const result = new Set(tokens);
  if (tokens.some(token => JEWELRY_ITEMS.has(token))) result.add("jewelry");
  // "Olive oil" is not a style match. Require a visible goods category too.
  if (tokens.some(token => PALETTE_COLORS.has(token))
    && tokens.some(token => VISIBLE_STYLE_ITEMS.has(token))) result.add("earthtone");
  return [...result];
}
