import { describe, expect, it } from "vitest";
import { twinInsightSchema, twinVoteSchema, type VaultMessage } from "../../lib/agentCollaborators/contracts";
import { sampleChat } from "../../lib/agentCollaborators/fixture";
import type { ModelTransport } from "../agents/model";
import { extractInsights, findInsights, findStatements } from "./extract";
import { castVotes, heuristicVotes } from "./vote";

const messages: VaultMessage[] = sampleChat(Date.UTC(2026, 9, 24))
  .filter((m) => m.fromMe)
  .map(({ text, sentAt }) => ({ text, sentAt }));
const insights = extractInsights(messages, "Maya");
const texts = insights.map((i) => i.text);

describe("insight extraction", () => {
  it("finds gift-feasible insights in the recipient's messages", () => {
    for (const expected of [
      "Maya is into trail running",
      "Maya wants a hydration vest",
      "Maya already has a Kindle",
      "Maya doesn't like scented candles",
      "Maya's favorite color is sage green",
      "Maya wants to try pottery",
      "Maya has been playing tennis",
      "Maya wants an Arc'teryx jacket",
    ])
      expect(texts).toContain(expected);
    expect(insights.find((i) => i.text === "Maya is into trail running")?.confidence).toBe("high");
  });

  it("one clear mention is enough when it names something giftable", () => {
    expect(insights.find((i) => i.text === "Maya has been playing tennis")?.evidenceCount).toBe(1);
    expect(insights.find((i) => i.text === "Maya wants an Arc'teryx jacket")?.confidence).toBe("high");
    const one = (line: string) => findStatements(line).map((s) => s.object);
    expect(one("I've been playing tennis a lot")).toEqual(["tennis"]);
    expect(one("I've been wanting a arcteryx jacket")).toEqual(["a arcteryx jacket"]);
    expect(one("I took up climbing")).toEqual(["climbing"]);
  });

  it.each(["I love dinner", "I love you guys", "I just got home", "I'm into it tonight", "I want pizza", "I love my sister", "I've been doing laundry all day", "I want to go home"])(
    "skips %s",
    (line) => expect(findStatements(line)).toEqual([]),
  );

  it("never surfaces sensitive lines or transcript quotes", () => {
    expect(JSON.stringify(insights)).not.toMatch(/therapist/i);
    for (const insight of insights) expect(twinInsightSchema.safeParse(insight).success).toBe(true);
  });

  it("validates model extras and drops sensitive or quoted ones", async () => {
    const model: ModelTransport = async () => ({
      insights: [
        { category: "interest", text: "Maya has been getting into bouldering", confidence: "medium", evidenceCount: 1 },
        { category: "interest", text: "Maya started therapy", confidence: "high", evidenceCount: 2 },
        { category: "wish", text: 'Maya said "the blue one"', confidence: "high", evidenceCount: 1 },
        { category: "wish", text: "Maya wants a drone", confidence: "low", evidenceCount: 1 },
      ],
    });
    const out = (await findInsights(messages, "Maya", model)).map((i) => i.text);
    expect(out).toContain("Maya has been getting into bouldering");
    expect(out.join("|")).not.toMatch(/therapy|blue one|drone/);
  });
});

describe("votes on room ideas", () => {
  const ideas = [
    { ref: "clue:1", kind: "clue" as const, text: "Maya loves backpacking" },
    { ref: "clue:2", kind: "clue" as const, text: "Maya likes matcha" },
    { ref: "listing:3", kind: "listing" as const, text: "Kindle Paperwhite" },
    { ref: "idea:4", kind: "idea" as const, text: "Golf lessons" },
  ];

  it("votes down, up, or stays silent", () => {
    const by = new Map(heuristicVotes(ideas, messages, "Maya").map((e) => [e.ideaRef, e]));
    expect(by.get("clue:1")).toMatchObject({ vote: "down", category: "dislike", text: expect.stringMatching(/don't like backpacking/) });
    expect(by.get("clue:2")?.vote).toBe("up");
    expect(by.get("listing:3")).toMatchObject({ vote: "down", category: "owns" });
    expect(by.has("idea:4")).toBe(false);
    for (const vote of by.values()) expect(twinVoteSchema.safeParse(vote).success).toBe(true);
  });

  it("drops model votes on refs that were not offered, and falls back when the model fails", async () => {
    const model: ModelTransport = async () => ({
      votes: [
        { ideaRef: "clue:2", vote: "up", text: "Maya makes matcha every morning", confidence: "high", evidenceCount: 2 },
        { ideaRef: "clue:999", vote: "down", text: "Maya hates golf", confidence: "high", evidenceCount: 1 },
      ],
    });
    expect((await castVotes(ideas, messages, "Maya", model)).map((v) => v.ideaRef)).toEqual(["clue:2"]);
    const broken: ModelTransport = async () => {
      throw new Error("down");
    };
    expect((await castVotes(ideas, messages, "Maya", broken)).map((v) => v.ideaRef).sort()).toEqual(["clue:1", "clue:2", "listing:3"]);
  });
});
