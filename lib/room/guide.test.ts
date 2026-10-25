import { describe, expect, it } from "vitest";
import { MOSS_QUESTIONS, mossWritingCue, guideMemories, initialGuideStep, sharedGuideTheme } from "./guide";
import type { PublishedClue } from "@/lib/contracts";
import { GIFT_IDEA_PREFIX } from "@/lib/map/rings";

const clue = (id: string, status: PublishedClue["status"] = "active", text = "Always takes a sketchbook") : PublishedClue => ({
  id, roomId: "room", publisherId: "me", kind: "interest", text,
  status, sourceKind: "manual", sourceMessageIds: [], publishedAt: 1,
});
describe("room-integrated guidance", () => {
  it("counts real active memories, excluding withdrawn clues and manual gift ideas", () => {
    expect(guideMemories([clue("real"), clue("gone", "withdrawn"), clue("source", "source_withdrawn"), clue("gift", "active", GIFT_IDEA_PREFIX + "Sketchbook")]).map((c) => c.id)).toEqual(["real"]);
  });
  it("resumes in the live room after the first saved memory without starting over", () => {
    expect(initialGuideStep("started", true)).toBe("live");
    expect(initialGuideStep(null, false)).toBe("welcome");
    expect(initialGuideStep(null, true)).toBeNull();
    expect(initialGuideStep("done", false)).toBeNull();
    expect(initialGuideStep("done", true)).toBeNull();
  });
  it("offers help without inventing or auto-publishing a recipient preference", () => {
    expect(MOSS_QUESTIONS.length).toBeGreaterThan(1);
    expect(MOSS_QUESTIONS.every((q) => q.title.endsWith("?") && q.prompt.length > 10)).toBe(true);
    expect(mossWritingCue(0, true)).not.toEqual(mossWritingCue(0, false));
    expect(mossWritingCue(4, true)).toContain("real moment");
    expect(mossWritingCue(50, true)).toContain("Keep it");
  });
  it("names only live council connections containing both members' memories", () => {
    const themes = [{ id: "t", label: "Making things", clueIds: ["mine", "peer"] }];
    expect(sharedGuideTheme(new Set(["mine"]), "peer", themes)?.id).toBe("t");
    expect(sharedGuideTheme(new Set(["other"]), "peer", themes)).toBeNull();
    expect(sharedGuideTheme(new Set(["mine"]), "unrelated", themes)).toBeNull();
    expect(sharedGuideTheme(new Set(["mine"]), "peer", [])).toBeNull();
  });
});
