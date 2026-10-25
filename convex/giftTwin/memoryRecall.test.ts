import { describe, expect, it, vi } from "vitest";
import type { SessionIndex } from "@moss-js/moss";
import type { ModelTransport } from "../agents/model";
import type { RoomIdea, VaultMessage } from "../../lib/agentCollaborators/contracts";
import { recallIdeaEvidence } from "./memoryRecall";
import { castVotes } from "./vote";

const idea: RoomIdea = { ref: "listing:1", kind: "listing", text: "Ceramics workshop" };
const memory: VaultMessage = { text: "I'd love to learn wheel throwing", sentAt: 1 };

function session(hits: Array<{ id: string; text: string; score: number }>) {
  return {
    addDocs: vi.fn<SessionIndex["addDocs"]>().mockResolvedValue({ added: 1, updated: 0 }),
    query: vi.fn<SessionIndex["query"]>().mockResolvedValue({ docs: hits, query: idea.text }),
  };
}

describe("recipient-local memory recall", () => {
  it("gives the recipient model semantic evidence with no keyword overlap", async () => {
    const local = session([{ id: "m0", text: memory.text, score: 0.8 }]);
    const recalled = await recallIdeaEvidence(local, [idea], [memory], "Maya");
    const model = vi.fn<ModelTransport>().mockResolvedValue({ votes: [{
      ideaRef: idea.ref, vote: "up", category: "wish", text: "Maya wants to learn pottery",
      confidence: "medium", evidenceCount: 1,
    }] });
    expect(await castVotes([idea], [memory], "Maya", model)).toEqual([]);
    expect(model).not.toHaveBeenCalled();
    expect(await castVotes([idea], [memory], "Maya", model, recalled.evidence)).toMatchObject([{ vote: "up", category: "wish" }]);
    expect(model.mock.calls[0]?.[0]).toMatchObject({ role: "recipient", input: {
      ideas: [{ ref: idea.ref, messages: [memory.text] }],
    } });
  });

  it("resolves only this vault's IDs and ignores provider text, unknown IDs, and invalid scores", async () => {
    const local = session([
      { id: "other-room", text: "Private text from another room", score: 1 },
      { id: "m0", text: "Provider attempted to replace evidence", score: 0.8 },
      { id: "m1", text: "invalid", score: NaN },
    ]);
    const result = await recallIdeaEvidence(local, [idea], [memory, { text: "Unrelated", sentAt: 2 }], "Maya");
    expect(result.evidence.get(idea.ref)).toEqual([memory]);
    expect(JSON.stringify(result.evidence.get(idea.ref))).not.toMatch(/Private text|Provider attempted/);
  });

  it("keeps explicit ownership and dislikes even when semantic retrieval misses them", async () => {
    const owns = { text: "I already have a Kindle", sentAt: 2 };
    const dislike = { text: "I hate scented candles", sentAt: 3 };
    const ideas: RoomIdea[] = [
      { ref: "listing:kindle", kind: "listing", text: "Kindle Paperwhite" },
      { ref: "listing:candle", kind: "listing", text: "Scented candles" },
    ];
    const result = await recallIdeaEvidence(session([]), ideas, [memory, owns, dislike], "Maya");
    expect(result.evidence.get("listing:kindle")).toEqual([owns]);
    expect(result.evidence.get("listing:candle")).toEqual([dislike]);
    expect((await castVotes(ideas, [owns, dislike], "Maya")).map((vote) => vote.vote)).toEqual(["down", "down"]);
  });

  it("uses keyword evidence when a local query fails without leaking its error", async () => {
    const local = session([]);
    local.query.mockRejectedValue(new Error("private text and credential"));
    const message = { text: "I love ceramics", sentAt: 1 };
    const result = await recallIdeaEvidence(local, [idea], [message], "Maya");
    expect(result.evidence.get(idea.ref)).toEqual([message]);
    expect(result.failedQueries).toBe(1);
    expect(result.queryMs).toEqual([]);
  });

  it("rejects votes for an idea the model never received evidence for", async () => {
    const other: RoomIdea = { ref: "idea:other", kind: "idea", text: "Golf lessons" };
    const model: ModelTransport = async () => ({ votes: [{
      ideaRef: other.ref, vote: "up", text: "Maya loves golf", confidence: "high", evidenceCount: 1,
    }] });
    expect(await castVotes([idea, other], [memory], "Maya", model, new Map([[idea.ref, [memory]], [other.ref, []]]))).toEqual([]);
  });
});
