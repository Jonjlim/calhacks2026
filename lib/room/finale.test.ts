import { describe, expect, it } from "vitest";
import { finaleStepOf } from "@/components/finale/steps";

describe("the last steps of the game", () => {
  it("follow the shared simulated checkout, in order", () => {
    expect(finaleStepOf(undefined)).toBe("plan");
    expect(finaleStepOf("no_proposal")).toBe("plan");
    expect(finaleStepOf("waiting_for_approvals")).toBe("plan");
    expect(finaleStepOf("ready")).toBe("checkout");
    expect(finaleStepOf("collecting")).toBe("checkout");
    expect(finaleStepOf("complete")).toBe("wrap");
  });

  it("end for everyone once the gift is wrapped, and nowhere else", () => {
    expect(finaleStepOf("wrapped")).toBe("end");
    for (const s of ["ready", "collecting", "complete", "waiting_for_approvals", "unavailable", undefined]) expect(finaleStepOf(s)).not.toBe("end");
  });
});
