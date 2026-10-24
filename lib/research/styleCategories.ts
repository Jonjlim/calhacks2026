/**
 * Reviewed public-style discovery categories. One table drives the clue gate,
 * the provider allowlist and the caption vocabulary so they cannot drift apart.
 * Literal caption/hashtag mentions only; no visual garment recognition.
 */
export interface StyleCategory {
  id: string;
  /** Matched against confirmed published interest/wish clue text. */
  cluePattern: RegExp;
  /** Fixed public search phrase; an optional `vintage ` prefix is the only variation. */
  baseSeed: string;
  garments: Array<{ garment: string; pattern: RegExp }>;
}

export const STYLE_CATEGORIES: StyleCategory[] = [
  {
    id: "denim", cluePattern: /\b(?:denim|jeans)\b/i, baseSeed: "denim outfit",
    garments: [
      { garment: "baggy jeans", pattern: /\bbaggy[\s_-]*(?:jeans|denim)\b/i },
      { garment: "loose fit jeans", pattern: /\bloose[\s_-]*(?:(?:fit|leg)[\s_-]*)?(?:jeans|denim)\b/i },
      { garment: "wide leg jeans", pattern: /\bwide[\s_-]*leg[\s_-]*(?:jeans|denim)\b/i },
      { garment: "barrel leg jeans", pattern: /\bbarrel[\s_-]*(?:leg[\s_-]*)?(?:jeans|denim)\b/i },
      { garment: "straight leg jeans", pattern: /\bstraight[\s_-]*(?:leg[\s_-]*)?(?:jeans|denim)\b/i },
      { garment: "flared jeans", pattern: /\bflar(?:e|ed)[\s_-]*(?:jeans|denim)\b/i },
      { garment: "bootcut jeans", pattern: /\bboot[\s_-]*cut[\s_-]*(?:jeans|denim)\b/i },
      { garment: "denim jacket", pattern: /\b(?:denim|jean)[\s_-]*jackets?\b/i },
      { garment: "denim skirt", pattern: /\b(?:denim|jean)[\s_-]*(?:(?:maxi|mini|midi)[\s_-]*)?skirts?\b/i },
      { garment: "denim vest", pattern: /\bdenim[\s_-]*vests?\b/i },
      { garment: "denim shorts", pattern: /\b(?:jorts|denim[\s_-]*shorts)\b/i },
      { garment: "denim dress", pattern: /\bdenim[\s_-]*dress(?:es)?\b/i },
      { garment: "denim overalls", pattern: /\bdenim[\s_-]*overalls\b/i },
    ],
  },
  {
    id: "jewelry", cluePattern: /\b(?:jewelry|jewellery|earrings?|necklaces?|bracelets?)\b/i, baseSeed: "jewelry outfit",
    garments: [
      { garment: "gold hoop earrings", pattern: /\bhoop[\s_-]*earrings?\b|\bgold[\s_-]*hoops\b/i },
      { garment: "huggie earrings", pattern: /\bhuggies?(?:[\s_-]*earrings?)?\b/i },
      { garment: "ear cuff", pattern: /\bear[\s_-]*cuffs?\b/i },
      { garment: "pearl necklace", pattern: /\bpearl[\s_-]*necklaces?\b/i },
      { garment: "layered necklaces", pattern: /\blayered[\s_-]*necklaces?\b|\bnecklace[\s_-]*stack\b/i },
      { garment: "charm bracelet", pattern: /\bcharm[\s_-]*bracelets?\b/i },
      { garment: "tennis bracelet", pattern: /\btennis[\s_-]*bracelets?\b/i },
      { garment: "stacking rings", pattern: /\bstack(?:ing|able|ed)?[\s_-]*rings?\b|\bring[\s_-]*stack\b/i },
      { garment: "signet ring", pattern: /\bsignet[\s_-]*rings?\b/i },
    ],
  },
  {
    id: "sneakers", cluePattern: /\bsneakers?\b/i, baseSeed: "sneaker outfit",
    garments: [
      { garment: "chunky sneakers", pattern: /\bchunky[\s_-]*sneakers?\b/i },
      { garment: "platform sneakers", pattern: /\bplatform[\s_-]*sneakers?\b/i },
      { garment: "retro sneakers", pattern: /\bretro[\s_-]*sneakers?\b/i },
      { garment: "suede sneakers", pattern: /\bsuede[\s_-]*sneakers?\b/i },
      { garment: "slim sneakers", pattern: /\bslim[\s_-]*(?:profile[\s_-]*)?sneakers?\b/i },
      { garment: "white sneakers", pattern: /\bwhite[\s_-]*sneakers?\b/i },
      { garment: "high top sneakers", pattern: /\bhigh[\s_-]*tops?[\s_-]*sneakers?\b/i },
    ],
  },
  {
    id: "knitwear", cluePattern: /\b(?:knitwear|sweaters?|cardigans?)\b/i, baseSeed: "sweater outfit",
    garments: [
      { garment: "cable knit sweater", pattern: /\bcable[\s_-]*knit\b/i },
      { garment: "chunky knit sweater", pattern: /\bchunky[\s_-]*knit\b/i },
      { garment: "fair isle sweater", pattern: /\bfair[\s_-]*isle\b/i },
      { garment: "quarter zip sweater", pattern: /\b(?:quarter|half)[\s_-]*zip\b/i },
      { garment: "turtleneck sweater", pattern: /\bturtlenecks?\b/i },
      { garment: "sweater vest", pattern: /\b(?:sweater|knit(?:ted)?)[\s_-]*vests?\b/i },
      { garment: "cardigan", pattern: /\bcardigans?\b/i },
    ],
  },
  {
    id: "bags", cluePattern: /\b(?:handbags?|purses?|tote[\s-]*bags?|totes|crossbody)\b/i, baseSeed: "handbag outfit",
    garments: [
      { garment: "tote bag", pattern: /\btote[\s_-]*bags?\b/i },
      { garment: "crossbody bag", pattern: /\bcross[\s_-]*body(?:[\s_-]*bags?)?\b/i },
      { garment: "shoulder bag", pattern: /\bshoulder[\s_-]*bags?\b/i },
      { garment: "bucket bag", pattern: /\bbucket[\s_-]*bags?\b/i },
      { garment: "baguette bag", pattern: /\bbaguette[\s_-]*bags?\b/i },
      { garment: "hobo bag", pattern: /\bhobo[\s_-]*bags?\b/i },
      { garment: "saddle bag", pattern: /\bsaddle[\s_-]*bags?\b/i },
      { garment: "mini bag", pattern: /\bmini[\s_-]*(?:bags?|purses?)\b/i },
    ],
  },
];

/** Every seed the social provider may receive. Nothing else is searchable. */
export const STYLE_SEED_TERMS: ReadonlySet<string> = new Set(
  STYLE_CATEGORIES.flatMap(c => [c.baseSeed, `vintage ${c.baseSeed}`]),
);

export function categoryForSeed(seedTerm: string): StyleCategory | undefined {
  const base = seedTerm.trim().toLowerCase().replace(/^vintage\s+/, "");
  return STYLE_CATEGORIES.find(c => c.baseSeed === base);
}
