import { describe, expect, it } from "vitest";
import { roomPhase } from "./phase";

describe("roomPhase", () => {
  it("starts by collecting memories", () => {
    expect(roomPhase({ recommendationCount: 0 })).toBe("collect");
    expect(roomPhase({ councilStatus: "failed", recommendationCount: 0 })).toBe("collect");
  });
  it("shows research only while a request is actually running or resumable", () => {
    expect(roomPhase({ councilStatus: "running", recommendationCount: 0 })).toBe("researching");
    expect(roomPhase({ councilStatus: "uncertain", recommendationCount: 0 })).toBe("researching");
    // A finished-but-empty request returns friends to collecting, not a fake review.
    expect(roomPhase({ councilStatus: "partial", recommendationCount: 0 })).toBe("collect");
  });
  it("reviews real recommendations, then approves, then finishes", () => {
    expect(roomPhase({ councilStatus: "completed", recommendationCount: 5 })).toBe("review");
    expect(roomPhase({ councilStatus: "completed", recommendationCount: 5, proposalStatus: "awaiting_approval" })).toBe("approve");
    expect(roomPhase({ councilStatus: "completed", recommendationCount: 5, proposalStatus: "infeasible" })).toBe("approve");
    expect(roomPhase({ councilStatus: "completed", recommendationCount: 5, proposalStatus: "approved_pledged" })).toBe("done");
  });
  it("a new research run on top of an older shortlist shows research", () => {
    expect(roomPhase({ councilStatus: "running", recommendationCount: 5 })).toBe("researching");
  });
});
