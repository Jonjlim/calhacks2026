import { describe, expect, it } from "vitest";
import { COUNCIL_ACTORS } from "./contracts";
import { COUNCIL_AVATAR, ROBOT_TINT, robotClip } from "./robots";

describe("council robots", () => {
  it("maps every actor to a distinct storybook body", () => {
    expect(COUNCIL_AVATAR).toEqual({ archivist: "calm", muse: "dreamer", scout: "explorer", keeper: "kind", courier: "curious" });
    expect(new Set(COUNCIL_ACTORS.map((a) => COUNCIL_AVATAR[a])).size).toBe(5);
    for (const a of COUNCIL_ACTORS) expect(ROBOT_TINT[a]).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("chooses clips from real state", () => {
    expect(robotClip({ status: "idle" })).toBe("Idle");
    expect(robotClip({ status: "started" })).toBe("Walk");
    expect(robotClip({ status: "completed", celebrating: true })).toBe("Celebrate");
    expect(robotClip({ status: "completed" })).toBe("Idle");
    expect(robotClip({ status: "failed" })).toBe("Sit");
    expect(robotClip({ status: "idle", hover: true })).toBe("Wave");
    expect(robotClip({ status: "idle", gesture: "Sit" })).toBe("Sit");
    expect(robotClip({ status: "completed", gesture: "Wave" })).toBe("Idle");
    expect(robotClip({ status: "idle", reveal: true, hover: true })).toBe("Celebrate");
    expect(robotClip({ status: "completed", walking: true })).toBe("Walk");
    expect(robotClip({ status: "failed", hover: true })).toBe("Sit");
    expect(robotClip({ status: "started", atWork: true })).toBe("Idle");
    expect(robotClip({ status: "started", atWork: true, walking: true })).toBe("Walk");
  });
});
