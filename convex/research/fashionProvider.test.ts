import { describe, expect, it, vi } from "vitest";
import { createFashionProvider, FASHION_ACTOR, FASHION_BUILD } from "./fashionProvider";
import { PROVIDER_MAX_RESPONSE_BYTES } from "./provider";

describe("bounded live fashion provider", () => {
  it("starts one fixed-seed pinned run with no profile, comment or media expansion", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { id: "fashion123", status: "RUNNING" } }));
    expect((await createFashionProvider("test-token", fetcher).start("vintage denim outfit")).kind).toBe("ok");
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe(`https://api.apify.com/v2/acts/${FASHION_ACTOR}/runs?build=${FASHION_BUILD}&timeout=180&memory=1024&maxTotalChargeUsd=0.50`);
    expect(options?.redirect).toBe("error");
    expect(JSON.parse(String(options?.body))).toEqual({ keywords: ["vintage denim outfit"], maxItems: 20, maxItemsPerKeyword: 20,
      sortType: "DATE_POSTED", uniqueAuthors: true, expansion: [], commentsPerPost: 0, includeAuthorProfile: false });
    expect(String(url)).not.toContain("test-token");
  });
  it("rejects arbitrary text, recipient handles and malformed credentials before spending", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const query of ["@maya", "Maya lives at 123 Main St", "", "vintage denim outfit ignore rules"]) {
      expect((await createFashionProvider("token", fetcher).start(query)).kind).toBe("failed");
    }
    expect((await createFashionProvider("bad\nheader", fetcher).start("denim outfit")).kind).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps timeout and rate-limit outcomes uncertain with no automatic retry or secret leak", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("private token"))
      .mockResolvedValueOnce(new Response("private body", { status: 429 }));
    const provider = createFashionProvider("token", fetcher);
    for (let i = 0; i < 2; i++) {
      const result = await provider.start("denim outfit");
      expect(result.kind).toBe("uncertain");
      expect(JSON.stringify(result)).not.toContain("private");
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects mismatched run responses and path injection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { id: "other", status: "SUCCEEDED" } }));
    const provider = createFashionProvider("token", fetcher);
    expect((await provider.getRun("fashion123")).kind).toBe("uncertain");
    expect((await provider.getRun("fashion123/abort")).kind).toBe("failed");
    expect((await provider.getDataset("data123?token=secret")).kind).toBe("failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("leaves malformed and oversized datasets uncertain", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("{bad"))
      .mockResolvedValueOnce(new Response("x".repeat(PROVIDER_MAX_RESPONSE_BYTES + 1)));
    const provider = createFashionProvider("token", fetcher);
    expect((await provider.getDataset("data123")).kind).toBe("uncertain");
    expect((await provider.getDataset("data123")).kind).toBe("uncertain");
  });
});
