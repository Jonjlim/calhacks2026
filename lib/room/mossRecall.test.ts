import { describe, expect, it } from "vitest";
import { keywordRank, matchCaption, nudgeLine, pickNudge, stems, type RecallDoc } from "./mossRecall";

const doc = (id: string, text: string, authorId = "jon", author = "Jon"): RecallDoc => ({ id, text, authorId, author });

describe("Moss room recall helpers", () => {
  it("reduces words to simple stems and drops filler", () => {
    expect([...stems("She keeps talking about the pottery classes")]).toEqual(["keep", "talk", "pottery", "class"]);
  });

  it("ranks by shared words and drops docs with none", () => {
    const docs = [doc("a", "Always cold in the mornings"), doc("b", "Spends quiet weekends at the farmers market"), doc("c", "Hates loud places")];
    expect(keywordRank("Think of a quiet weekend", docs)).toEqual(["b"]);
  });

  it("offers a friend's memory, never the asker's own", () => {
    const docs = [doc("mine", "Loves quiet weekends", "me", "You"), doc("jon", "Quiet weekend hikes")];
    expect(pickNudge(["mine", "jon"], docs, "me", "moss")).toEqual({ doc: docs[1], match: "moss" });
  });

  it("falls back to the newest friend memory when nothing matched", () => {
    const docs = [doc("mine", "Mine", "me"), doc("new", "Newest from Ally", "ally", "Ally"), doc("old", "Older from Jon")];
    expect(pickNudge([], docs, "me", "keyword")).toEqual({ doc: docs[1], match: "recent" });
    expect(pickNudge([], [doc("mine", "Only mine", "me")], "me", "keyword")).toBeNull();
  });

  it("quotes the memory as shared and says how it was found", () => {
    expect(nudgeLine({ author: "Jon", text: "She saves wheel-throwing posts." })).toBe("Jon remembered “She saves wheel-throwing posts.” Does that remind you of anything?");
    expect(matchCaption({ match: "moss", ms: 3.6 })).toBe("found with Moss · 4 ms");
    expect(matchCaption({ match: "keyword", ms: 2 })).toBe("found by matching words");
    expect(matchCaption({ match: "recent", ms: 2 })).toBe("a friend’s latest memory");
  });
});
