import { describe, expect, it } from "vitest";
import { directionPoint, fadeOf, MAX_DRIFTING, trendClouds, weaveThreads } from "./directions";
import { RING_RADII, ringDistance } from "./rings";
import { trendKey } from "./trendIdeas";

const s = (query: string) => ({ query, sourceUrl: `https://trends.google.com/explore?q=${encodeURIComponent(query)}`, signals: [{ kind: "rising_search" as const, growthPercent: 40 }] });
const sample = (jobId: string, clueId: string, queries: string[]) => ({ jobId, publishedClueId: clueId, suggestions: queries.map(s) });
const memoryAt = () => ({ x: 10, z: -5 });

describe("passing fades, half the room lets it go", () => {
  it("stays until someone passes, and a pull outweighs a pass", () => {
    expect(fadeOf(undefined, 4)).toBe("shown");
    expect(fadeOf({ up: 0, down: 0 }, 4)).toBe("shown");
    expect(fadeOf({ up: 1, down: 1 }, 4)).toBe("shown");
  });

  it("fades on one pass in a group, and leaves once half the room passed", () => {
    expect(fadeOf({ up: 0, down: 1 }, 4)).toBe("faded");
    expect(fadeOf({ up: 0, down: 2 }, 4)).toBe("gone");
    expect(fadeOf({ up: 1, down: 3 }, 4)).toBe("faded");
  });

  it("lets one person on their own clear it", () => {
    expect(fadeOf({ up: 0, down: 1 }, 1)).toBe("gone");
  });
});

describe("trend clouds", () => {
  it(`keeps at most ${MAX_DRIFTING} drifting, taken in turn from each memory`, () => {
    const clouds = trendClouds([
      sample("j1", "hike", ["hiking boots", "hiking backpack", "hiking books"]),
      sample("j2", "matcha", ["matcha whisk set", "matcha bowl"]),
    ], {}, memoryAt, 0);
    expect(clouds.map((c) => c.query)).toEqual(["hiking boots", "matcha whisk set", "hiking backpack"]);
    expect(clouds.every((c) => !c.caught)).toBe(true);
  });

  it("drops passed clouds, rests caught ones by their memory, and skips ones a direction already uses", () => {
    const samples = [sample("j1", "hike", ["hiking boots", "hiking backpack", "hiking books", "hiking poles"])];
    const clouds = trendClouds(samples, { [trendKey("j1", "hiking boots")]: -1, [trendKey("j1", "hiking backpack")]: 1 }, memoryAt, 0,
      new Set([trendKey("j1", "hiking books")]));
    expect(clouds.map((c) => [c.query, c.caught])).toEqual([["hiking backpack", true], ["hiking poles", false]]);
  });

  it("drifts with time but stays in the outer sky", () => {
    const samples = [sample("j1", "hike", ["hiking boots"])];
    const [early] = trendClouds(samples, {}, memoryAt, 0);
    const [later] = trendClouds(samples, {}, memoryAt, 10_000);
    expect([early!.x, early!.z]).not.toEqual([later!.x, later!.z]);
    expect(ringDistance(later!.x, later!.z)).toBeGreaterThan(RING_RADII.input);
  });
});

describe("where a direction floats", () => {
  it("sits between the themes and the gifts", () => {
    const [x, z] = directionPoint([{ x: 20, z: 0 }, { x: 0, z: 10 }], 0);
    const r = ringDistance(x, z);
    expect(r).toBeGreaterThan(RING_RADII.gift);
    expect(r).toBeLessThan(RING_RADII.theme);
  });
});

describe("the council's weave", () => {
  const memoryKeys = ["clue:a", "clue:b", "clue:c", "clue:d"];
  const directions = [{ id: "d1", key: "direction:d1", clueIds: ["a", "c"] }, { id: "d2", key: "direction:d2", clueIds: ["b", "d"] }];
  const trail = [
    { actor: "checks", outcome: "rejected", at: 1_000, text: "Threw out “Old idea”: it cited a memory nobody shared.", clueIds: ["a", "b"] },
    { actor: "checks", outcome: "rejected", at: 50_000, text: "Threw out “Retro bowling bag”: it repeated another direction's search.", clueIds: ["c", "d"] },
    { actor: "council", outcome: "kept", at: 50_000, text: "Kept “Trail matcha kit”…", clueIds: ["a", "c"] },
  ];
  const base = { memoryKeys, directions, trail, selectedKey: null };

  it("sends out a branch from every memory at once, seeking only among the other real memories", () => {
    const w = weaveThreads({ ...base, weave: { id: 1, phase: "reaching", since: 49_000, fresh: [] } })!;
    expect(w.threads.map((t) => t.from)).toEqual(memoryKeys);
    expect(w.threads.every((t) => t.mode === "seek" && !t.targets!.includes(t.from) && t.targets!.every((k) => memoryKeys.includes(k)))).toBe(true);
  });

  it("latches the memories a new direction combines onto it, pulls the rest home, and frays this round's refusals", () => {
    const w = weaveThreads({ ...base, weave: { id: 1, phase: "weaving", since: 49_000, fresh: ["d1"] } })!;
    expect(w.threads.filter((t) => t.mode === "kept").map((t) => `${t.from}>${t.to}`)).toEqual(["clue:a>direction:d1", "clue:c>direction:d1"]);
    expect(w.threads.filter((t) => t.mode === "retract").map((t) => t.from)).toEqual(["clue:b", "clue:d"]);
    expect(w.threads.filter((t) => t.mode === "frayed")).toEqual([
      { from: "clue:c", to: "clue:d", mode: "frayed", delay: 0.5, label: "it repeated another direction's search" },
    ]);
  });

  it("grows an opened direction's branches again, and stays empty otherwise", () => {
    expect(weaveThreads({ ...base, weave: null, selectedKey: "direction:d2" })?.threads.map((t) => t.from)).toEqual(["clue:b", "clue:d"]);
    expect(weaveThreads({ ...base, weave: null })).toBeNull();
  });
});
