import { describe, expect, it } from "vitest";
import type { AgentCollaboratorFeed, AgentCollaboratorPostView } from "../agentCollaborators/contracts";
import { giftTwinMap } from "./giftTwin";

function post(overrides: Partial<AgentCollaboratorPostView>): AgentCollaboratorPostView {
  return { id: "post", collaboratorId: "twin", kind: "insight", text: "Maya likes pottery", confidence: "high", status: "added", createdAt: 1, authorName: "Maya's Gift Twin", ...overrides };
}
function feed(posts: AgentCollaboratorPostView[]): AgentCollaboratorFeed {
  return { collaborators: [], posts };
}

describe("Gift Twin map identity", () => {
  it("keeps historical AI attribution using source ids after disconnect", () => {
    const projected = giftTwinMap(feed([post({ publishedClueId: "pottery" })]), new Set());
    expect(projected.clueAuthors.get("pottery")).toBe("Maya's Gift Twin");
    expect(projected.clueAuthors.has("a-human-clue")).toBe(false);
  });

  it("attaches evaluations to exact listing, memory and gift-idea targets", () => {
    const projected = giftTwinMap(feed([
      post({ id: "yes", kind: "vote", status: "noted", ideaRef: "listing:cup", vote: "up" }),
      post({ id: "no", kind: "vote", ideaRef: "clue:hiking", vote: "down" }),
      post({ id: "idea", kind: "vote", ideaRef: "clue:vest", vote: "up" }),
    ]), new Set(["vest"]));
    expect(projected.evaluations["gift:cup"]?.[0]?.vote).toBe("up");
    expect(projected.evaluations["clue:hiking"]?.[0]?.vote).toBe("down");
    expect(projected.evaluations["idea:vest"]?.[0]?.author).toBe("Maya's Gift Twin");
    expect(Object.keys(projected.evaluations)).toHaveLength(3);
  });

  it("does not turn unreviewed notes, dismissed notes or legacy targetless votes into map badges", () => {
    const projected = giftTwinMap(feed([
      post({ status: "suggested", publishedClueId: "pending", kind: "vote", ideaRef: "listing:cup", vote: "up" }),
      post({ status: "dismissed", publishedClueId: "hidden", kind: "vote", ideaRef: "listing:cup", vote: "down" }),
      post({ kind: "vote", vote: "down", ideaText: "Same title as another gift" }),
    ]), new Set());
    expect(projected.clueAuthors.size).toBe(0);
    expect(projected.evaluations).toEqual({});
    expect(giftTwinMap(undefined, new Set()).evaluations).toEqual({});
  });
});
