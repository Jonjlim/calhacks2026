import { describe, expect, it } from "vitest";
import {
  canTransitionAttempt,
  deriveGroupStatus,
  unwindIntent,
} from "./stateMachine";

const shares = [
  { participantId: "a", amountMinor: 4500 },
  { participantId: "b", amountMinor: 4500 },
  { participantId: "c", amountMinor: 0 },
];

describe("attempt transitions", () => {
  it("follows the documented happy path", () => {
    expect(canTransitionAttempt("not_started", "authorization_pending")).toBe(true);
    expect(canTransitionAttempt("authorization_pending", "authorized")).toBe(true);
    expect(canTransitionAttempt("authorized", "capture_pending")).toBe(true);
    expect(canTransitionAttempt("capture_pending", "captured")).toBe(true);
    expect(canTransitionAttempt("captured", "refund_pending")).toBe(true);
    expect(canTransitionAttempt("refund_pending", "refunded")).toBe(true);
  });

  it("refuses skipping authorization and leaving terminal states", () => {
    expect(canTransitionAttempt("authorization_pending", "captured")).toBe(false);
    expect(canTransitionAttempt("not_started", "authorized")).toBe(false);
    expect(canTransitionAttempt("canceled", "authorized")).toBe(false);
    expect(canTransitionAttempt("refunded", "captured")).toBe(false);
    expect(canTransitionAttempt("authorization_failed", "authorization_pending")).toBe(false);
  });

  it("lets the provider win races and resolves uncertain from reconcile", () => {
    expect(canTransitionAttempt("cancellation_pending", "captured")).toBe(true);
    expect(canTransitionAttempt("capture_pending", "authorized")).toBe(true);
    expect(canTransitionAttempt("uncertain", "captured")).toBe(true);
    expect(canTransitionAttempt("uncertain", "not_started")).toBe(false);
  });
});

describe("group status", () => {
  it("ignores zero shares and needs every payer authorized", () => {
    expect(deriveGroupStatus("authorizing", shares, [{ participantId: "a", status: "authorized" }])).toBe("authorizing");
    expect(
      deriveGroupStatus("authorizing", shares, [
        { participantId: "a", status: "authorized" },
        { participantId: "b", status: "authorized" },
      ]),
    ).toBe("ready_to_capture");
  });

  it("blocks on a failed authorization and uses the latest attempt per payer", () => {
    const failed = [
      { participantId: "a", status: "authorized" as const },
      { participantId: "b", status: "authorization_failed" as const },
    ];
    expect(deriveGroupStatus("authorizing", shares, failed)).toBe("blocked");
    expect(deriveGroupStatus("blocked", shares, [...failed, { participantId: "b", status: "authorization_pending" }])).toBe(
      "authorizing",
    );
  });

  it("funds only when all payers captured and recovers on any capture failure", () => {
    const capturing = [
      { participantId: "a", status: "captured" as const },
      { participantId: "b", status: "capture_pending" as const },
    ];
    expect(deriveGroupStatus("capturing", shares, capturing)).toBe("capturing");
    expect(deriveGroupStatus("capturing", shares, [capturing[0]!, { participantId: "b", status: "uncertain" }])).toBe(
      "capturing",
    );
    expect(deriveGroupStatus("capturing", shares, [capturing[0]!, { participantId: "b", status: "captured" }])).toBe(
      "test_funded",
    );
    expect(deriveGroupStatus("capturing", shares, [capturing[0]!, { participantId: "b", status: "authorized" }])).toBe(
      "recovery_pending",
    );
  });

  it("finishes recovery only when every attempt is terminal", () => {
    expect(
      deriveGroupStatus("recovery_pending", shares, [
        { participantId: "a", status: "refund_pending" },
        { participantId: "b", status: "canceled" },
      ]),
    ).toBe("recovery_pending");
    expect(
      deriveGroupStatus("recovery_pending", shares, [
        { participantId: "a", status: "refunded" },
        { participantId: "b", status: "canceled" },
      ]),
    ).toBe("canceled");
  });

  it("never moves P0 statuses", () => {
    for (const s of ["awaiting_approval", "approved_pledged", "superseded", "test_funded"] as const) {
      expect(deriveGroupStatus(s, shares, [{ participantId: "a", status: "authorized" }])).toBe(s);
    }
  });
});

describe("unwind intents", () => {
  it("cancels uncaptured and refunds captured attempts on dead revisions", () => {
    expect(unwindIntent("superseded", "authorized")).toBe("cancellation_pending");
    expect(unwindIntent("canceled", "authorization_pending")).toBe("cancellation_pending");
    expect(unwindIntent("recovery_pending", "captured")).toBe("refund_pending");
    expect(unwindIntent("recovery_pending", "capture_pending")).toBeNull();
    expect(unwindIntent("superseded", "not_started")).toBe("canceled");
  });

  it("does nothing for live revisions", () => {
    expect(unwindIntent("authorizing", "authorized")).toBeNull();
    expect(unwindIntent("capturing", "captured")).toBeNull();
  });
});
