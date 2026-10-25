import { describe, expect, it } from "vitest";
import { cluePhrase, productCategory, shoppingPhrase, shoppingPhrases } from "./text";
import { trendSeed } from "./trendPolicy";

const seed = (text: string) => trendSeed({ kind: "interest", text, status: "active" }, ["Maya"]);

describe("shopping phrases from everyday memories", () => {
  it.each([
    ["Loves trail running", "trail running"],
    ["Plays tennis every weekend", "tennis"],
    ["Collects vinyl records", "vinyl records"],
    ["Obsessed with matcha", "matcha"],
    ["Big fan of board games", "board games"],
    ["She goes bouldering whenever she can", "bouldering"],
    ["Really into specialty coffee lately", "specialty coffee"],
    ["Wants to learn guitar", "guitar"],
    ["Makes sourdough on weekends", "sourdough"],
    ["Loves to bowl", "bowling"],
    ["Loves to hike", "hiking"],
    ["Loves to swim", "swimming"],
    ["Likes to cook", "cooking"],
    ["Loves to read mystery novels", "read mystery novels"],
    ["Goes bowling every Friday night", "bowling"],
  ])("%s -> %s", (text, phrase) => {
    expect(shoppingPhrase(text)).toBe(phrase);
  });

  it("splits a memory that names several interests, but not fixed phrases", () => {
    expect(shoppingPhrases("Loves hiking and camping")).toEqual(["hiking", "camping"]);
    expect(shoppingPhrases("Into film cameras, vinyl & jazz")).toEqual(["film cameras", "vinyl", "jazz"]);
    expect(shoppingPhrases("Loves arts and crafts")).toEqual(["arts and crafts"]);
    expect(shoppingPhrases("Wants a salt and pepper grinder")).toEqual(["salt and pepper grinder"]);
  });

  it.each([
    ["we hiked mt hood", "hiking"],
    ["She went bowling with us", "bowling"],
    ["We swam in Lake Tahoe", "swimming"],
    ["hiked the PCT", "hiking"],
    ["I ran a marathon", "running"],
    ["Hiking in Yosemite", "hiking"],
    ["Hiker", "hiking"],
    ["Avid climber", "climbing"],
    ["matcha drinker", "matcha"],
    ["Coffee lover", "coffee"],
    ["lovees to bowl", "bowling"],
    ["obsesssed with matcha", "matcha"],
    ["we got matcha", "matcha"],
    ["We tried rock climbing", "rock climbing"],
    ["She made the pottery mug", "pottery mug"],
    ["I got her a necklace", "necklace"],
  ])("story or typo %s -> %s", (text, phrase) => {
    expect(shoppingPhrase(text)).toBe(phrase);
  });

  it.each([
    "Loves baked goods", "Wants knitted socks", "Wants a ceiling fan", "Loves gloves",
    "Wants a bowler hat", "camper van", "Loves trail running",
  ])("leaves product wording alone: %s", (text) => {
    expect(shoppingPhrase(text)).toBe(cluePhrase(text));
  });

  it("repairs a stretched framing word for ownership too", () => {
    expect(cluePhrase("Already ownns a pottery wheel")).toBe("pottery wheel");
  });

  it("gives trends one short subject per memory", () => {
    expect(seed("we hiked mt hood")).toBe("hiking");
    expect(seed("lovees to bowl")).toBe("bowling");
    expect(seed("matcha drinker")).toBe("matcha");
    expect(seed("Plays tennis every weekend")).toBe("tennis");
    expect(seed("Loves hiking and camping")).toBe("hiking");
    expect(seed("Collects vinyl records")).toBe("vinyl records");
  });
});

describe("what kind of thing a listing is", () => {
  // Titles observed in live Google Shopping results on October 24, 2026.
  it.each([
    ["Merrell Moab 3 Soft Toe Hiking Boots, for Men, Size 10.5, Brown", "hiking boots"],
    ["Columbia Women's Newton Ridge Plus Waterproof Amped Hiking Boot, 5 / Stratus/Canyon Rose", "hiking boot"],
    ["AE Low-Rise Baggy Straight Jean Women's Black Blaze 10 Regular", "straight jean"],
    ["Patagonia Men's Torrentshell 3L Rain Jacket", "rain jacket"],
    ["Arc'teryx Atom Hoody Men's", "atom hoody"],
    ["Nature Meditations Deck", "meditations deck"],
  ])("%s -> %s", (title, category) => {
    expect(productCategory(title)).toBe(category);
  });
});
