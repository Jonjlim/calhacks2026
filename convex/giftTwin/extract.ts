/**
 * Model-free insight extraction, run by the cloud twin agent over the
 * recipient's vaulted messages (see agent.ts). Looks for first-person statements the
 * recipient made ("I've been playing tennis", "I really want an Arc'teryx
 * jacket", "I can't stand scented candles") about things that could become a
 * gift, and turns them into short third-person insights. One clear mention is
 * enough; repetition only raises confidence. Raw message text is never part
 * of the output. An optional model pass (findInsights) adds what the
 * patterns miss.
 */
import { z } from "zod";
import { validatedModelCall, type ModelTransport } from "../agents/model";
import {
  insightDedupeKey,
  isShareableConfidence,
  screenSharedText,
  TWIN_LIMITS,
  twinInsightSchema,
  type TwinConfidence,
  type TwinInsight,
  type TwinInsightCategory,
  type VaultMessage,
} from "../../lib/agentCollaborators/contracts";

/**
 * strict: the object must name something giftable (hobby, product, brand).
 * lenient: the verb already implies a hobby or a preference ("I've been
 * playing…", "I hate…"), so anything not obviously non-giftable passes.
 */
type Mode = "strict" | "lenient";

interface Pattern {
  category: TwinInsightCategory;
  mode: Mode;
  regex: RegExp;
  phrase: (name: string, object: string, verb: string) => string;
}

const OBJECT = "([^.!?,;\\n]{3,60})";
/** Captured separately so "a hydration vest" keeps its article but "a" alone never counts as the object. */
const ARTICLE = "((?:a |an |the |some |new |another )?)";
const I = "\\bi(?:'m|’m| am|'ve|’ve| have)?";

const PATTERNS: Pattern[] = [
  {
    category: "dislike",
    mode: "lenient",
    regex: new RegExp(`${I} (?:really |honestly |just )?(?:hate|can't stand|can’t stand|cannot stand|don't like|don’t like|do not like|not a fan of|not into|so over|sick of)\\s+()${OBJECT}`, "i"),
    phrase: (n, o) => `${n} doesn't like ${o}`,
  },
  {
    category: "owns",
    mode: "strict",
    regex: new RegExp(`${I} (?:already (?:have|own|got)|just (?:bought|got|ordered)|finally (?:got|bought)|got(?= (?:a|an) new ))\\s+${ARTICLE}(?:new |my )?${OBJECT}`, "i"),
    phrase: (n, o) => `${n} already has ${o}`,
  },
  {
    category: "wish",
    mode: "strict",
    regex: new RegExp(`${I} (?:really |so |kinda |kind of )?(?:want|wanna|wish i had|need(?= (?:a|an) new )|would love|'d love|’d love|been wanting|been eyeing|been looking at|have my eye on|been saving (?:up )?for|thinking about getting|dying for|can't wait to get)\\s+${ARTICLE}(?:new )?${OBJECT}`, "i"),
    phrase: (n, o) => `${n} wants ${o}`,
  },
  {
    category: "interest",
    mode: "lenient",
    regex: new RegExp(`${I} (?:been )?(?:really |so |super )?(playing|practicing|practising|learning|training for|getting into|took up|taking up|picked up)\\s+${OBJECT}`, "i"),
    phrase: (n, o, verb) => `${n} has been ${verb === "took up" || verb === "picked up" ? "taking up" : verb} ${o}`,
  },
  {
    category: "interest",
    mode: "strict",
    regex: new RegExp(`${I} (?:been )?(?:really |so |super )?(doing|started|starting|taking|love|adore|obsessed with|into|a big fan of|big fan of|addicted to|hooked on)\\s+${OBJECT}`, "i"),
    phrase: (n, o, verb) => (/^(doing|started|starting|taking)$/i.test(verb) ? `${n} has been ${verb === "taking" ? "taking" : "doing"} ${o}` : `${n} is into ${o}`),
  },
];

const STYLE = /\bmy (?:favorite|favourite|fav) (colou?r|brand|band|author|snack|tea|coffee|flower|scent|candy|chocolate|store|designer|artist|team)\s+is\s+([^.!?,;\n]{2,40})/i;

const HOBBIES = [
  "tennis", "pickleball", "padel", "squash", "badminton", "golf", "running", "trail running", "marathon", "half marathon", "hiking", "backpacking", "camping", "climbing", "bouldering", "skiing", "snowboarding", "surfing", "skating", "skateboarding", "cycling", "biking", "mountain biking", "swimming", "yoga", "pilates", "crossfit", "lifting", "weightlifting", "boxing", "martial arts", "jiu jitsu", "bjj", "soccer", "basketball", "baseball", "volleyball", "hockey", "fishing", "kayaking", "sailing", "rowing", "pottery", "ceramics", "painting", "watercolor", "drawing", "sketching", "knitting", "crochet", "sewing", "embroidery", "woodworking", "gardening", "plants", "baking", "cooking", "grilling", "bbq", "photography", "film photography", "guitar", "piano", "drums", "ukulele", "violin", "singing", "djing", "chess", "board games", "video games", "gaming", "puzzles", "reading", "journaling", "calligraphy", "birdwatching", "astronomy", "3d printing", "lego", "anime", "manga", "vinyl", "records", "podcasts", "audiobooks", "wine", "coffee", "espresso", "tea", "matcha", "cocktails", "whiskey", "skincare", "makeup", "fashion", "sneakers", "thrifting", "travel", "dance", "dancing", "salsa", "ballet", "meditation", "f1", "formula 1", "disc golf", "archery", "fencing", "scuba", "diving", "snorkeling", "crafts", "scrapbooking", "candle making", "terrariums", "aquarium", "ceramic", "tarot", "crosswords",
];
const PRODUCTS = [
  "jacket", "coat", "vest", "hoodie", "sweater", "fleece", "shoes", "sneakers", "boots", "cleats", "bag", "backpack", "tote", "wallet", "watch", "ring", "necklace", "earrings", "bracelet", "jewelry", "headphones", "earbuds", "speaker", "camera", "lens", "ereader", "e-reader", "tablet", "laptop", "phone", "keyboard", "monitor", "console", "controller", "game", "book", "books", "novel", "series", "audiobook", "turntable", "record player", "candle", "candles", "perfume", "cologne", "fragrance", "lotion", "serum", "mug", "bottle", "tumbler", "blender", "espresso machine", "grinder", "kettle", "whisk", "pan", "knife", "knives", "cookbook", "kit", "set", "gear", "racket", "racquet", "paddle", "balls", "clubs", "skis", "snowboard", "bike", "helmet", "mat", "weights", "dumbbells", "tent", "sleeping bag", "stove", "lamp", "blanket", "pillow", "robe", "pajamas", "socks", "hat", "beanie", "scarf", "gloves", "sunglasses", "journal", "notebook", "pens", "paints", "brushes", "yarn", "pedal", "amp", "drone", "printer", "puzzle", "poster", "print", "artwork", "tickets", "classes", "lessons", "membership", "subscription", "massage", "spa", "plushie", "figure", "figurine", "watch band", "strap", "case", "charger", "smartwatch", "tripod", "flowers", "bouquet", "chocolate", "chocolates", "jersey",
];
const BRANDS = [
  "arcteryx", "arc'teryx", "arc’teryx", "patagonia", "lululemon", "nike", "adidas", "new balance", "hoka", "salomon", "north face", "apple", "airpods", "ipad", "kindle", "lego", "nintendo", "switch", "ps5", "playstation", "xbox", "steam deck", "sony", "bose", "sonos", "yeti", "stanley", "hydro flask", "dyson", "le creuset", "kitchenaid", "garmin", "fitbit", "whoop", "oura", "canon", "fujifilm", "nikon", "polaroid", "instax", "aesop", "glossier", "sephora", "rhode", "le labo", "diptyque", "uniqlo", "aritzia", "zara", "carhartt", "converse", "vans", "birkenstock", "dr martens", "ray-ban", "rayban", "wilson", "babolat", "yonex", "taylormade", "callaway", "rei", "rapha", "peloton", "theragun", "vitamix", "nespresso", "breville", "fellow", "chemex", "aeropress", "moleskine", "muji", "squishmallow", "jellycat", "funko", "pokemon", "ugg", "longchamp", "coach", "kate spade", "pandora", "tiffany", "cartier",
];
const NON_GIFT_LEAD = new Set([
  "you", "your", "u", "ur", "ya", "y'all", "yall", "it", "its", "it's", "that", "this", "these", "those", "them", "they", "him", "her", "his", "me", "us", "we", "our", "everyone", "everybody", "someone", "somebody", "anyone", "people", "guys", "girl", "dude", "bro", "babe", "baby", "mom", "dad",
  "here", "there", "home", "back", "out", "up", "down", "off", "in", "on", "over", "through", "into", "away", "around", "ready", "sure", "tired", "sorry", "done", "sick", "late", "busy", "excited", "good", "fine", "okay", "ok", "so", "too", "much", "more", "what", "how", "why", "when", "where", "who", "if", "all", "everything", "nothing", "something", "anything", "one", "lots",
  "today", "tonight", "tomorrow", "yesterday", "now", "later", "soon", "rn", "again", "being", "going", "doing", "having", "getting", "to", "my", "best", "worst", "time", "fun", "well",
]);
const NON_GIFT_ANYWHERE = /\b(you|ur|u|him|her|them|y'?all|tonight|tomorrow|yesterday|today|lol|lmao|omg|dinner|lunch|breakfast|brunch|food|sleep|nap|naps|work|job|shift|school|homework|laundry|chores|dishes|taxes|traffic|weather|mondays?|weekends?|life|money|meeting|meetings|exam|exams|finals|bed|shower|rain|summer|winter)\b/i;
const ALLOWED_TO = /^to (try|learn|get|take|visit|see|go to|start)\b/;
const STOP_OBJECTS = new Set(["you", "u", "it", "that", "this", "them", "him", "her", "me", "lol", "haha", "that one", "this one"]);
const TRAILING_FILLER = /\b(lol|haha+|so much|right now|rn|lately|recently|btw|anyway|too|so badly|honestly|for the record|every (?:morning|day|week|night|weekend)|a lot|again|these days|nonstop|non-stop|all day|constantly|forever|this year|on my runs?|with \w+|at the \w+)\b.*$/i;
const CLAUSE_BREAK = /\s(so|but|because|cause|since|which|when|while|if|before|after|and i|they're|it's|its|for my|for the)\b.*$/i;
const MAX_OBJECT_WORDS = 6;

function containsAny(haystack: string, needles: string[]): boolean {
  const padded = ` ${haystack.replace(/[^a-z0-9'’ -]/g, " ")} `;
  return needles.some((needle) => {
    const plural = needle.endsWith("s") ? needle : `${needle}s`;
    return padded.includes(` ${needle} `) || padded.includes(` ${plural} `) || padded.includes(` ${needle}-`);
  });
}

/** True when the object names a hobby, a product, or a brand. */
export function namesGiftableThing(object: string): boolean {
  const lower = object.toLowerCase();
  return containsAny(lower, HOBBIES) || containsAny(lower, PRODUCTS) || containsAny(lower, BRANDS);
}

/** True when the object is obviously not something you could gift: people, moods, meals, time, chores. */
export function isNonGift(object: string): boolean {
  const lower = object.toLowerCase().replace(/^(a|an|the|some|their|new)\s+/, "");
  const first = lower.split(" ")[0] ?? "";
  if (lower.startsWith("to ")) return !ALLOWED_TO.test(lower) || !/[a-z]{3}/.test(lower.replace(ALLOWED_TO, ""));
  if (NON_GIFT_LEAD.has(first) || NON_GIFT_LEAD.has(lower)) return true;
  if (NON_GIFT_ANYWHERE.test(lower) && !namesGiftableThing(lower)) return true;
  return !/[a-z]{3}/.test(lower);
}

export function giftFeasible(object: string, mode: Mode): boolean {
  if (isNonGift(object)) return false;
  return mode === "lenient" || namesGiftableThing(object);
}

/** Keeps the original casing so brand names read naturally ("a Kindle"). */
export function cleanObject(raw: string): string | null {
  let object = raw.replace(CLAUSE_BREAK, "").replace(TRAILING_FILLER, "").replace(/\bmy\b/gi, "their").replace(/\s+/g, " ").trim();
  object = object.replace(/^(so|really|just|like)\s+/i, "");
  const words = object.split(" ");
  if (words.length > MAX_OBJECT_WORDS) object = words.slice(0, MAX_OBJECT_WORDS).join(" ");
  if (object.length < 3 || STOP_OBJECTS.has(object.toLowerCase())) return null;
  return object;
}

export interface Statement {
  category: TwinInsightCategory;
  object: string;
  /** Index into PATTERNS (-1 for style); picks the phrasing. */
  pattern: number;
  verb: string;
  giftable: boolean;
}

/** One statement per message: the earliest-listed pattern wins (dislike before interest). */
export function findStatements(text: string): Statement[] {
  const style = STYLE.exec(text);
  if (style?.[1] && style[2]) {
    const value = style[2].toLowerCase().replace(TRAILING_FILLER, "").trim();
    if (value) return [{ category: "style", object: `${style[1].toLowerCase()} is ${value}`, pattern: -1, verb: "", giftable: true }];
  }
  for (const [index, pattern] of PATTERNS.entries()) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    const isActivity = pattern.regex.source.includes("(playing|") || pattern.regex.source.includes("(doing|");
    const verb = isActivity ? (match[1] ?? "").toLowerCase() : "";
    const article = isActivity ? "" : (match[1] ?? "");
    const rawObject = match[2];
    const cleaned = rawObject ? cleanObject(rawObject) : null;
    if (!cleaned) continue;
    const object = `${article.toLowerCase()}${cleaned}`;
    if (!giftFeasible(object, pattern.mode)) continue;
    return [{ category: pattern.category, object, pattern: index, verb, giftable: namesGiftableThing(object) }];
  }
  return [];
}

function phraseFor(statement: Statement, name: string): string {
  if (statement.pattern < 0) return `${name}'s favorite ${statement.object}`;
  return PATTERNS[statement.pattern]!.phrase(name, statement.object, statement.verb);
}

/**
 * A clear want or purchase of a named product is strong on its own; a hobby
 * or dislike needs a second mention to be "high". Lenient matches that name
 * nothing recognisable stay "medium" so the server's relevance check sees them.
 */
function confidenceFor(statement: Statement, count: number): TwinConfidence {
  if (statement.giftable && (statement.category === "wish" || statement.category === "owns" || count >= 2)) return "high";
  if (statement.giftable || PATTERNS[statement.pattern]?.mode === "lenient" || statement.pattern < 0) return count >= 2 ? "high" : "medium";
  return "low";
}

interface Candidate {
  statement: Statement;
  count: number;
}

/** The vault holds only messages the recipient sent. */
export function extractInsights(messages: VaultMessage[], recipientName: string): TwinInsight[] {
  const counts = new Map<string, Candidate>();
  for (const message of messages) {
    for (const statement of findStatements(message.text)) {
      const key = `${statement.category}:${statement.object.toLowerCase().replace(/^(a|an|the|some|new) /, "")}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { statement, count: 1 });
    }
  }
  const insights: TwinInsight[] = [];
  const seen = new Set<string>();
  for (const { statement, count } of [...counts.values()].sort((a, b) => b.count - a.count)) {
    const confidence = confidenceFor(statement, count);
    if (!isShareableConfidence(confidence)) continue;
    const screened = screenSharedText(phraseFor(statement, recipientName));
    if (!screened.ok) continue;
    const key = insightDedupeKey(statement.category, screened.text);
    if (seen.has(key)) continue;
    seen.add(key);
    insights.push({ category: statement.category, text: screened.text, confidence, evidenceCount: count });
    if (insights.length >= TWIN_LIMITS.insightsPerRun) break;
  }
  return insights;
}

const MODEL_BATCH_CHARS = 24_000;
const MODEL_MAX_BATCHES = 4;
const MODEL_MESSAGE_CHARS = 300;

const EXTRACT_INSTRUCTIONS = `You are a Gift Twin: an agent acting for the gift recipient, who gave one-time permission for you to read messages they sent.
Find things a friend could turn into a gift: hobbies and activities they do or are getting into, specific products or brands they want or already own, tastes and styles, and things they dislike.
Examples: "I've been playing tennis a lot" -> interest "Maya has been playing tennis". "I've been wanting an Arc'teryx jacket" -> wish "Maya wants an Arc'teryx jacket". "I love dinner" -> nothing (not giftable). "I love you guys" -> nothing.
Rules:
- One clear mention is enough. Repetition only raises confidence.
- Skip moods, meals, chores, plans, people, places, and jokes.
- Each insight is one short third-person sentence (max 160 characters) about the recipient by name.
- Never quote messages. Never mention other people. No links, contact details, or quotation marks.
- Skip anything about health, religion, sexuality, politics, finances, legal matters, or passwords.
- confidence: "high" for an explicit want of a named product or anything repeated; "medium" for one clear mention of a hobby or taste. Leave out anything you are unsure about. An empty list is fine.
Return JSON only: {"insights":[{"category":"interest"|"wish"|"dislike"|"owns"|"style","text":string,"confidence":"medium"|"high","evidenceCount":number}]} with at most 12 items.`;

/** Items are validated one by one below, so one bad item does not cost the batch. */
const looseInsights = z.object({ insights: z.array(z.unknown()).max(50) });

/** Newest messages first, packed into a few model-sized batches. */
function modelBatches(messages: VaultMessage[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && batches.length < MODEL_MAX_BATCHES; i--) {
    const text = messages[i]!.text.slice(0, MODEL_MESSAGE_CHARS);
    if (chars + text.length > MODEL_BATCH_CHARS && current.length > 0) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length > 0 && batches.length < MODEL_MAX_BATCHES) batches.push(current);
  return batches;
}

/** Patterns first, then an optional model pass. Every item is re-validated; model output is untrusted. */
export async function findInsights(messages: VaultMessage[], recipientName: string, model?: ModelTransport): Promise<TwinInsight[]> {
  const merged = new Map<string, TwinInsight>();
  for (const insight of extractInsights(messages, recipientName)) merged.set(insightDedupeKey(insight.category, insight.text), insight);
  if (model && messages.length > 0) {
    const results = await Promise.allSettled(
      modelBatches(messages).map((batch) =>
        validatedModelCall(model, { role: "recipient", instructions: EXTRACT_INSTRUCTIONS, input: { recipient: recipientName, messages: batch } }, looseInsights),
      ),
    );
    for (const result of results) {
      // A failed batch only loses model extras; the patterns still stand.
      if (result.status !== "fulfilled") continue;
      for (const candidate of result.value.insights) {
        const parsed = twinInsightSchema.safeParse(candidate);
        if (!parsed.success || !isShareableConfidence(parsed.data.confidence)) continue;
        const key = insightDedupeKey(parsed.data.category, parsed.data.text);
        if (!merged.has(key)) merged.set(key, parsed.data);
      }
    }
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return [...merged.values()]
    .filter((insight) => isShareableConfidence(insight.confidence))
    .sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.evidenceCount - a.evidenceCount)
    .slice(0, TWIN_LIMITS.insightsPerRun);
}
