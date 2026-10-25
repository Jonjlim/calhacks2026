import { describe, expect, it } from "vitest";
import { shoppingPhrase, shoppingPhrases } from "./text";
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

  it("gives trends one short subject per memory", () => {
    expect(seed("Plays tennis every weekend")).toBe("tennis");
    expect(seed("Loves hiking and camping")).toBe("hiking");
    expect(seed("Collects vinyl records")).toBe("vinyl records");
  });
});
