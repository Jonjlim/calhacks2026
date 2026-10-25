import { describe, expect, it } from "vitest";
import {
  clueKindForCategory,
  insightDedupeKey,
  normalizePairingCode,
  screenSharedText,
  splitIntoUploadBatches,
  TWIN_LIMITS,
  twinInsightSchema,
  twinVoteSchema,
  voteDedupeKey,
} from "./contracts";

describe("screenSharedText", () => {
  it("accepts short third-person summaries", () => {
    expect(screenSharedText("Maya has been getting into trail running")).toEqual({ ok: true, text: "Maya has been getting into trail running" });
  });
  it.each([
    ["Maya started a new medication", "sensitive_health"],
    ["Maya goes to church on Sundays", "sensitive_religion"],
    ["Maya is paying off student debt", "sensitive_finances"],
    ['Maya said "get me the blue one"', "quoted_transcript"],
    ["Maya likes https://example.com", "contact_details"],
    ["Text Maya at 415 555 0100", "contact_details"],
    ["", "empty"],
    ["x".repeat(161), "too_long"],
  ])("rejects %s", (text, reason) => {
    expect(screenSharedText(text)).toEqual({ ok: false, reason });
  });
  it("does not trip on everyday words that contain sensitive stems", () => {
    expect(screenSharedText("Maya loves spray paint art").ok).toBe(true);
  });
});

describe("schemas", () => {
  it("rejects unknown fields and screens vote text", () => {
    expect(twinInsightSchema.safeParse({ category: "interest", text: "Maya likes tea", confidence: "low", evidenceCount: 1, raw: "x" }).success).toBe(false);
    const vote = { ideaRef: "clue:1", vote: "down", category: "dislike", text: "Maya has said they don't like backpacking", confidence: "high", evidenceCount: 1 };
    expect(twinVoteSchema.safeParse(vote).success).toBe(true);
    expect(twinVoteSchema.safeParse({ ...vote, vote: "yes" }).success).toBe(false);
    expect(twinVoteSchema.safeParse({ ...vote, text: 'Maya said "never again"' }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("maps categories onto existing clue kinds", () => {
    expect(clueKindForCategory("dislike")).toBe("exclusion");
    expect(clueKindForCategory("owns")).toBe("ownership");
    expect(clueKindForCategory("wish")).toBe("explicit_wish");
    expect(clueKindForCategory("style")).toBe("interest");
  });
  it("normalizes codes and dedupe keys", () => {
    expect(normalizePairingCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(insightDedupeKey("interest", "Maya  loves Tea!")).toBe(insightDedupeKey("interest", "maya loves tea"));
    expect(voteDedupeKey("clue:1")).toBe("vote:clue:1");
  });
  it("splits uploads into batches within the per-call limits", () => {
    const messages = Array.from({ length: 300 }, (_, i) => ({ text: "y".repeat(TWIN_LIMITS.messageMaxChars + 10), sentAt: i }));
    const batches = splitIntoUploadBatches(messages);
    expect(batches.flat()).toHaveLength(300);
    for (const batch of batches) expect(batch.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(TWIN_LIMITS.uploadBatchMaxChars);
    expect(splitIntoUploadBatches([])).toEqual([]);
  });
});
