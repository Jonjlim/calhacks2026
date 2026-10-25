import { describe, expect, it } from "vitest";
import type { MapTheme } from "../../lib/contracts";
import { recommendationThemeIds } from "./themeLinks";

const theme: MapTheme = { id: "hands-on", roomId: "room", label: "Makes things", clueIds: ["pottery"], status: "suggested", source: "agent", knowledgeRevision: 3, updatedAt: 1 };
const base = { roomId: "room", knowledgeRevision: 3,
  recommendation: { roomId: "room", publishedClueIds: ["pottery", "coffee"] },
  themes: [theme], clues: [{ id: "pottery", roomId: "room", status: "active" as const }, { id: "coffee", roomId: "room", status: "active" as const }] };
describe("recommendation paths to current gift-ring themes", () => {
  it("connects two cited themes in stable unique order", () => {
    const themes: MapTheme[] = [theme, { ...theme, id: "daily-ritual", clueIds: ["coffee"], status: "accepted" }, theme];
    expect(recommendationThemeIds({ ...base, themes })).toEqual(["daily-ritual", "hands-on"]);
  });
  it.each([
    { ...theme, status: "dismissed" as const },
    { ...theme, roomId: "other-room" },
    { ...theme, knowledgeRevision: 2 },
    { ...theme, clueIds: [] },
    { ...theme, clueIds: ["pottery", "withdrawn"] },
  ])("omits invalid theme paths: %j", invalid => {
    expect(recommendationThemeIds({ ...base, themes: [invalid] })).toEqual([]);
  });
  it("never turns shared labels or unreferenced clues into product support", () => {
    expect(recommendationThemeIds({ ...base, recommendation: { roomId: "room", publishedClueIds: ["unrelated"] } })).toEqual([]);
  });
  it("ignores withdrawn and foreign published citations", () => {
    expect(recommendationThemeIds({ ...base, clues: [{ id: "pottery", roomId: "room", status: "source_withdrawn" }] })).toEqual([]);
    expect(recommendationThemeIds({ ...base, clues: [{ id: "pottery", roomId: "foreign", status: "active" }] })).toEqual([]);
    expect(recommendationThemeIds({ ...base, recommendation: { ...base.recommendation, roomId: "foreign" } })).toEqual([]);
  });
});
