import { describe, expect, it } from "vitest";
import { COUNCIL_CLIPS, COUNCIL_POSES, poseFor } from "./animation";
import { COUNCIL_ACTORS, councilEventSchema, decorationSpecSchema, decorationsFrom, reduceCouncil, type CouncilEvent } from "./contracts";
import library from "./library.json";
import recorded from "./fixtures/agent-run.recorded.json";
import { SAMPLE_DECORATION, SAMPLE_SESSION } from "./sampleSession";

const events = SAMPLE_SESSION.map((s) => s.event);

describe("council contracts", () => {
  it("validates every sample event and the pottery charm", () => {
    for (const e of events) expect(councilEventSchema.safeParse(e).success).toBe(true);
    expect(decorationSpecSchema.parse(SAMPLE_DECORATION).assetId).toBe("ceramic_charm");
  });

  it("rejects decorations outside the approved library", () => {
    for (const bad of [{ assetId: "dragon_statue" }, { placement: "inside_box" }, { color: "neon" }, { jar: "secrets" }, { label: "" }]) {
      expect(decorationSpecSchema.safeParse({ ...SAMPLE_DECORATION, ...bad }).success).toBe(false);
    }
  });

  it("is order-independent and idempotent", () => {
    const forward = reduceCouncil(events);
    const shuffled = reduceCouncil([...events].reverse().concat(events));
    expect(shuffled).toEqual(forward);
    expect(COUNCIL_ACTORS.map((a) => forward[a].status)).toEqual(["completed", "completed", "completed", "completed", "completed"]);
  });

  it("a late duplicate 'started' never rewinds a finished member", () => {
    const late: CouncilEvent = { ...events[1]!, eventId: "ev_late_restart", sequence: 1 };
    expect(reduceCouncil([...events, late]).archivist.status).toBe("completed");
  });

  it("dedupes decorations per memory", () => {
    const muse = events.find((e) => e.actor === "muse" && e.status === "completed")!;
    const again: CouncilEvent = { ...muse, eventId: "ev_muse_retry", sequence: 99 };
    expect(decorationsFrom([muse, again])).toEqual([SAMPLE_DECORATION]);
  });
});

describe("council animation controller", () => {
  it("maps every actor and status to a clip that exists in the GLB", () => {
    for (const actor of COUNCIL_ACTORS) {
      for (const status of ["idle", "started", "completed", "failed"] as const) {
        const pose = COUNCIL_POSES[actor][status];
        expect(COUNCIL_CLIPS).toContain(pose.clip);
        if (pose.then) expect(COUNCIL_CLIPS).toContain(pose.then);
        expect(pose.caption.length).toBeGreaterThan(3);
      }
    }
  });

  it("drives the briefed behaviours", () => {
    expect(poseFor({ actor: "archivist", status: "started" }).clip).toBe("read_scroll");
    expect(poseFor({ actor: "scout", status: "started" }).clip).toBe("search");
    expect(poseFor({ actor: "keeper", status: "started" }).clip).toBe("compare_options");
    for (const a of COUNCIL_ACTORS) expect(poseFor({ actor: a, status: "failed" }).clip).toBe("idle");
  });

  it("shares one asset library with the Python coordinator", () => {
    expect(library.assets.some((a) => a.id === "ceramic_charm" && a.keywords.includes("pottery"))).toBe(true);
    expect(library.assets.find((a) => a.id === library.fallbackAsset)).toBeTruthy();
  });
});


describe("cross-language contract", () => {
  it("accepts events recorded from the real Python coordinator", () => {
    // Captured from `python agent.py` handling a /council/run for the pottery memory.
    const evs = recorded.map((e) => councilEventSchema.parse(e));
    const m = reduceCouncil(evs);
    expect(COUNCIL_ACTORS.every((a) => m[a].status === "completed")).toBe(true);
    expect(decorationsFrom(evs)).toEqual([{ memoryId: "mem_e2e_pottery1", jar: "wish", assetId: "ceramic_charm", color: "terracotta", placement: "front_ribbon", label: "Pottery" }]);
  });
});
