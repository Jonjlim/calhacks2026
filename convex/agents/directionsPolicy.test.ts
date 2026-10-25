import { describe, expect, it } from "vitest";
import { acceptDirections, acceptProbe, type DirectionMemory, presetDirections } from "./directionsPolicy";

const memories: DirectionMemory[] = [
  { id: "c_hike", kind: "interest", text: "hiking" },
  { id: "c_retro", kind: "interest", text: "drawn to vintage-inspired patterns and colors" },
  { id: "c_jackets", kind: "explicit_wish", text: "jackets" },
  { id: "c_bowl", kind: "interest", text: "Enjoys bowling nights" },
];
const never = () => false;
const one = (over: Partial<{ label: string; query: string; why: string; memories: number[]; trend: number; broad: boolean }> = {}) => ({
  label: "Vintage trail jacket", query: "vintage pattern hiking jacket", why: "Joins her hiking with her love of retro patterns.",
  memories: [0, 1], broad: false, ...over,
});

describe("accepting the council's directions", () => {
  it("keeps a direction that combines two real memories", () => {
    const [d] = acceptDirections({ directions: [one()] }, memories, [], never);
    expect(d).toEqual({ label: "Vintage trail jacket", query: "vintage pattern hiking jacket", why: "Joins her hiking with her love of retro patterns.", clueIds: ["c_hike", "c_retro"], broad: false });
  });

  it("allows a single memory only when it is an explicit wish", () => {
    expect(acceptDirections({ directions: [one({ memories: [0] })] }, memories, [], never)).toEqual([]);
    expect(acceptDirections({ directions: [one({ memories: [2], query: "jackets" })] }, memories, [], never)).toHaveLength(1);
  });

  it("refuses invented memory numbers, unknown trends, links, prices and sensitive text", () => {
    expect(acceptDirections({ directions: [one({ memories: [0, 9] })] }, memories, [], never)).toEqual([]);
    expect(acceptDirections({ directions: [one({ trend: 0 })] }, memories, [], never)).toEqual([]);
    expect(acceptDirections({ directions: [one({ query: "jacket under $80" })] }, memories, [], never)).toEqual([]);
    expect(acceptDirections({ directions: [one({ why: "See https://example.com for more." })] }, memories, [], never)).toEqual([]);
    expect(acceptDirections({ directions: [one()] }, memories, [], () => true)).toEqual([]);
  });

  it("links a caught trend only by its given index", () => {
    const [d] = acceptDirections({ directions: [one({ trend: 0 })] }, memories, [{ trendJobId: "t1", query: "retro hiking jacket" }], never);
    expect(d?.trend).toEqual({ trendJobId: "t1", query: "retro hiking jacket" });
  });

  it("drops a repeated search and marks a lone one-word wish as broad", () => {
    const out = acceptDirections({ directions: [one(), one({ label: "Again" }), one({ memories: [2], query: "jackets" })] }, memories, [], never);
    expect(out.map((d) => d.query)).toEqual(["vintage pattern hiking jacket", "jackets"]);
    expect(out[1]?.broad).toBe(true);
  });
});

describe("directions without a model", () => {
  it("sharpens each wish with an interest and cites both", () => {
    const [d] = presetDirections(memories, "Alex");
    expect(d).toMatchObject({ query: "hiking jackets", clueIds: ["c_jackets", "c_hike"], broad: false });
  });

  it("joins two interests when nobody has wished for anything", () => {
    const [d] = presetDirections(memories.filter((m) => m.kind === "interest"), "Alex");
    expect(d?.clueIds).toHaveLength(2);
  });

  it("never turns a long sentence into a search", () => {
    expect(presetDirections([memories[1]!], "Alex")).toEqual([]);
  });
});

describe("a probe question", () => {
  const probe = { question: "Is Alex more of a day hiker or an overnight camper?", options: [
    { label: "Day hikes", clue: "Alex mostly does day hikes." }, { label: "Overnights", clue: "Alex loves overnight trips." },
  ] };

  it("passes when every line is clean", () => {
    expect(acceptProbe(probe, never)).toEqual(probe);
  });

  it("is dropped if any line has a link, price or sensitive trait", () => {
    expect(acceptProbe({ ...probe, question: "Would a $200 tent fit?" }, never)).toBeNull();
    expect(acceptProbe(probe, (t) => t.includes("overnight"))).toBeNull();
  });
});
