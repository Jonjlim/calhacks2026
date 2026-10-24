import { describe, expect, it } from "vitest";
import { MOCK_INVITE_TOKEN, mockLandingActions } from "./landing";

describe("mockLandingActions", () => {
  it("rejects an empty create draft as validation_failed", async () => {
    const res = await mockLandingActions.createRoom({ recipientDisplayName: " ", occasion: "birthday", displayName: "Alex" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("validation_failed");
  });

  it("marks created rooms as mock so the UI cannot claim persistence", async () => {
    const res = await mockLandingActions.createRoom({ recipientDisplayName: "Maya", occasion: "birthday", displayName: "Alex" });
    expect(res).toEqual({ ok: true, value: { roomId: "room_demo", source: "mock" } });
  });

  it("returns not_found for an unknown invite code", async () => {
    const res = await mockLandingActions.joinRoom({ inviteToken: "nope", displayName: "Sam" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_found");
  });

  it("joins the fixture room with the fixture code", async () => {
    const res = await mockLandingActions.joinRoom({ inviteToken: MOCK_INVITE_TOKEN, displayName: "Sam" });
    expect(res.ok).toBe(true);
  });
});
