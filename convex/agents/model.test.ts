import { describe, expect, it, vi } from "vitest";
import { createModelTransport, createUsageAccumulator } from "./model";

const request = {
  role: "buyer" as const,
  instructions: "Return JSON",
  input: { text: "hello" },
};
const config = {
  baseUrl: "https://model.example/v1",
  apiKey: "secret-test-key",
  model: "configured-model",
};
describe("model transport", () => {
  it("caps output tokens and records usage without storing provider payloads", async () => {
    const usage = createUsageAccumulator();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 200,
            prompt_tokens_details: { cached_tokens: 300 },
            completion_tokens_details: { reasoning_tokens: 50 },
          },
        }),
      );
    await createModelTransport(
      {
        ...config,
        maxOutputTokens: 1800,
        reasoningEffort: "none",
        onUsage: usage.add,
      },
      fetcher,
    )(request);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({
      max_completion_tokens: 1800,
      reasoning_effort: "none",
    });
    expect(usage.summary).toEqual({
      calls: 1,
      reportedCalls: 1,
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: 300,
      reasoningTokens: 50,
    });
  });
  it("distinguishes missing usage metadata from zero billed usage", async () => {
    const usage = createUsageAccumulator();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
        }),
      );
    await createModelTransport(
      { ...config, onUsage: usage.add },
      fetcher,
    )(request);
    expect(usage.summary).toMatchObject({ calls: 1, reportedCalls: 0 });
  });
  it("rejects invalid output budgets and oversized inputs before making a request", async () => {
    const fetcher = vi.fn();
    await expect(
      createModelTransport(
        { ...config, maxOutputTokens: 999999 },
        fetcher,
      )(request),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      createModelTransport(
        config,
        fetcher,
      )({ ...request, input: "x".repeat(120001) }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires explicit configuration and HTTPS", async () => {
    const fetcher = vi.fn();
    await expect(
      createModelTransport({}, fetcher)(request),
    ).rejects.toMatchObject({ code: "unknown" });
    await expect(
      createModelTransport(
        { ...config, baseUrl: "http://bad.example" },
        fetcher,
      )(request),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses JSON mode, keeps the key in headers and parses complete responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"intent":"listen"}' },
          },
        ],
      }),
    );
    expect(await createModelTransport(config, fetcher)(request)).toEqual({
      intent: "listen",
    });
    const options = fetcher.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(options.body))).toMatchObject({
      response_format: { type: "json_object" },
    });
    expect(String(options.body)).not.toContain("secret-test-key");
    expect(options.redirect).toBe("error");
  });
  it("does not expose provider response errors", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("secret-test-key private prompt", { status: 401 }),
      );
    await expect(
      createModelTransport(config, fetcher)(request),
    ).rejects.toThrow("HTTP 401");
  });
  it("rejects truncated, refused, invalid and oversized outputs", async () => {
    for (const message of [
      { choices: [{ finish_reason: "length", message: { content: "{}" } }] },
      {
        choices: [
          {
            finish_reason: "stop",
            message: { content: "{}", refusal: "cannot" },
          },
        ],
      },
      {
        choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
      },
    ])
      await expect(
        createModelTransport(
          config,
          vi.fn().mockResolvedValue(Response.json(message)),
        )(request),
      ).rejects.toBeInstanceOf(Error);
    await expect(
      createModelTransport(
        config,
        vi.fn().mockResolvedValue(new Response("x".repeat(128001))),
      )(request),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("bounds provider latency with a typed timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetcher: typeof fetch = (_url, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("abort")),
          ),
        );
      const result = createModelTransport(config, fetcher)(request);
      const assertion = expect(result).rejects.toMatchObject({
        code: "provider_timeout",
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
