import { describe, expect, it } from "vitest";
import { groupBudgetGuidance, validBudgetRange } from "./budgets";
describe("group budget guidance", () => {
  it("uses the mean minimum and smallest maximum times membership", () => {
    expect(groupBudgetGuidance([{minMinor:1000,maxMinor:5000},{minMinor:2000,maxMinor:8000},{minMinor:3000,maxMinor:10000}],3)).toEqual({lowerMinor:2000,upperMinor:15000,currency:"USD",responseCount:3,participantCount:3,conflicting:false});
  });
  it("keeps unanswered members unknown and marks provisional guidance", () => {
    expect(groupBudgetGuidance([],3)).toBeUndefined();
    expect(groupBudgetGuidance([{minMinor:1001,maxMinor:2000},{minMinor:1002,maxMinor:3000}],3)).toMatchObject({lowerMinor:1002,upperMinor:6000,responseCount:2});
  });
  it("retains zero and conflicting bounds", () => {
    expect(groupBudgetGuidance([{minMinor:0,maxMinor:0},{minMinor:10000,maxMinor:10000}],2)).toMatchObject({lowerMinor:5000,upperMinor:0,conflicting:true});
  });
  it("rejects invalid cents and inverted ranges", () => {
    for (const [lo,hi] of [[-1,5],[4,3],[0,Infinity],[0,10000001],[1.1,10]] as [number, number][]) expect(validBudgetRange(lo,hi)).toBe(false);
    expect(validBudgetRange(0,10000000)).toBe(true);
  });
});
