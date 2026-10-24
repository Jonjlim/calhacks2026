import { describe, expect, it } from "vitest";
import { recordedFashionContext } from "./fashionContext";
import sample from "./fixtures/tiktok-fashion.json";
import type { PublishedClue } from "../contracts";

const clue = { id: "published-denim", kind: "interest" as const, text: "Likes vintage denim", status: "active" as const };
const now = sample.context.retrievedAt + 1000;
const build = (clues: Array<Pick<PublishedClue, "id" | "kind" | "text" | "status">> = [clue], enabled = true, at = now) =>
  recordedFashionContext({ clues, enabled, now: at });

describe("recorded fashion context", () => {
  it("passes only sourced directions for the confirmed interest with original dates and an explicit replay label", () => {
    const result = build()!;
    expect(result.mode).toBe("recorded_sample");
    expect(result.label).toContain("not live");
    expect(result.context).toEqual(sample.context);
    expect(result.supportingPublishedClueIds).toEqual([clue.id]);
    expect(result.directions[0]?.searchQuery).toBe("vintage loose fit jeans");
    expect(result.directions[0]?.postUrls).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("caption");
    expect(JSON.stringify(result)).not.toContain("creatorKey");
  });

  it("stays off outside demo mode and rejects expired/future samples", () => {
    expect(build([clue], false)).toBeUndefined();
    expect(build([clue], true, sample.context.retrievedAt - 1)).toBeUndefined();
    expect(build([clue], true, sample.context.retrievedAt + 86400001)).toBeUndefined();
    expect(build([clue], true, NaN)).toBeUndefined();
  });

  it("does not invent preferences from uncertainty, ownership, exclusions, withdrawal or unrelated clues", () => {
    for (const changed of [
      { ...clue, text: "Might like vintage denim" },
      { ...clue, text: "Likes pottery" },
      { ...clue, kind: "uncertain" as const },
      { ...clue, kind: "ownership" as const },
      { ...clue, kind: "exclusion" as const },
      { ...clue, status: "withdrawn" as const },
    ]) expect(build([changed])).toBeUndefined();
    expect(build([])).toBeUndefined();
  });
});
