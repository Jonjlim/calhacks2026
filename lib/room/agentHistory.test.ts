import { describe, expect, it } from "vitest";
import type { RoomData } from "@/components/room/types";
import { agentHistory, durationText } from "./agentHistory";

const ev = (actor: string, task: string, status: string, sequence: number, timestamp: number, result?: object) =>
  ({ eventId: `e${sequence}`, runId: "run_1", actor, task, status, sequence, timestamp, result }) as never;

const data = (events: never[]) => ({ council: { events }, researchJobs: [], activity: { jobs: [] } }) as unknown as RoomData;

describe("agent history", () => {
  it("joins a task's start and finish into one line with how long it took", () => {
    const h = agentHistory(data([ev("scout", "research_gifts", "started", 1, 1000), ev("scout", "research_gifts", "completed", 2, 6500, { summary: "Found 9 real listings", count: 9 })]), "scout");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ status: "done", title: "Searched for real gifts", durationMs: 5500, detail: "Found 9 real listings" });
  });

  it("shows unfinished work as working, and failures with their error", () => {
    expect(agentHistory(data([ev("muse", "design_decoration", "started", 1, 10)]), "muse")[0]).toMatchObject({ status: "working" });
    const failed = agentHistory(data([ev("keeper", "check_constraints", "started", 1, 10), ev("keeper", "check_constraints", "failed", 2, 20, { error: "No budget set" })]), "keeper");
    expect(failed[0]).toMatchObject({ status: "failed", detail: "No budget set" });
  });

  it("keeps each member's own history, newest first", () => {
    const events = [ev("scout", "research_gifts", "started", 1, 100), ev("archivist", "analyze_memories", "completed", 2, 200), ev("scout", "research_gifts", "completed", 3, 300)];
    expect(agentHistory(data(events), "archivist")).toHaveLength(1);
    expect(agentHistory(data(events), "courier")).toHaveLength(0);
  });

  it("writes durations plainly", () => {
    expect(durationText(400)).toBe("under a second");
    expect(durationText(5500)).toBe("6s");
    expect(durationText(120_000)).toBe("2 min");
  });
});
