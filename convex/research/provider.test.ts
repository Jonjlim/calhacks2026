import { describe, expect, it, vi } from "vitest";
import { createProvider, VERIFIED_BUILD } from "./provider";
import type { SearchBrief } from "../../lib/contracts";

const brief: SearchBrief = {
  roomId: "room", knowledgeRevision: 1, queryTerms: ["pottery tools"],
  mustExclude: ["starter kit"], budgetMinor: 8000, listingLimit: 12,
};
describe("Apify provider adapter", () => {
  it("pins the tested build, limits cost/pages and keeps token out of the URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: { id: "run123", status: "RUNNING" },
    })));
    const result = await createProvider("test-secret", fetcher).start(brief);
    expect(result.kind).toBe("ok");
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("build=" + VERIFIED_BUILD);
    expect(String(url)).toContain("maxTotalChargeUsd=0.20");
    expect(String(url)).not.toContain("test-secret");
    expect(options?.headers).toMatchObject({ Authorization: "Bearer test-secret" });
    expect(JSON.parse(String(options?.body))).toEqual({
      q: "pottery tools", gl: "us", hl: "en", max_pages: 1, max_price: 80,
    });
  });
  it("does not retry a timed-out POST or expose the network exception", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("test-secret"));
    const result = await createProvider("test-secret", fetcher).start(brief);
    expect(result.kind).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("test-secret");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("distinguishes rejected requests from ambiguous server errors", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("private body", { status: 401 }))
      .mockResolvedValueOnce(new Response("private body", { status: 500 }));
    expect((await createProvider("token", fetcher).start(brief)).kind).toBe("failed");
    const result = await createProvider("token", fetcher).start(brief);
    expect(result.kind).toBe("uncertain");
    expect(JSON.stringify(result)).not.toContain("private body");
  });
  it("refuses missing credentials and empty searches without spending", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect((await createProvider("", fetcher).start(brief)).kind).toBe("failed");
    expect((await createProvider("token", fetcher).start({ ...brief, queryTerms: [] })).kind).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not treat malformed run replies as success", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: {} })));
    expect((await createProvider("token", fetcher).start(brief)).kind).toBe("uncertain");
  });
  it("uses one complete search direction instead of mixing unrelated photo clues", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: { id: "run123", status: "RUNNING" },
    })));
    await createProvider("token", fetcher).start({
      ...brief, queryTerms: [" ", "vintage denim jacket", "rock climbing", "pottery"],
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.q).toBe("vintage denim jacket");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

});
