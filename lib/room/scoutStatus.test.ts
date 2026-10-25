import { describe, expect, it } from "vitest";
import { roomCouncilMembers, searchFailure } from "./councilActivity";

const job = (status: string, createdAt: number, lastError?: string) => ({ _id: `j${createdAt}`, status, createdAt, knowledgeRevision: 1, lastError }) as never;

describe("Scout's state on the map", () => {
  it("a failed background trend lookup doesn't paint Scout as broken", () => {
    const members = roomCouncilMembers({ trends: { latestJob: { id: "t", status: "failed", createdAt: 10, canResume: false, lastError: "No related searches" }, sample: null } } as never);
    expect(members.scout.status).not.toBe("failed");
  });

  it("a running trend lookup still shows Scout working", () => {
    const members = roomCouncilMembers({ trends: { latestJob: { id: "t", status: "running", createdAt: 10, canResume: false }, sample: null } } as never);
    expect(members.scout).toMatchObject({ status: "started", summary: "Exploring trends…" });
  });

  it("a failed gift search says what happened", () => {
    const members = roomCouncilMembers({ researchJobs: [job("failed", 5, "No usable product listings were returned.")] } as never);
    expect(members.scout).toMatchObject({ status: "failed", summary: "No gifts matched that search — try another direction" });
  });

  it("names each failure in plain words", () => {
    expect(searchFailure("Council service is not configured. Set FETCH_AGENT_URL")).toBe("The council isn’t connected on this server");
    expect(searchFailure("Trend source credentials are not configured correctly.")).toBe("The gift source isn’t set up on this server");
    expect(searchFailure("Provider timed out")).toBe("The gift search took too long — try again");
    expect(searchFailure(undefined)).toBe("Gift search failed — try again");
  });
});
