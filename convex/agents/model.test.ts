import { describe, expect, it, vi } from "vitest";
import { createModelTransport } from "./model";

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
    const fetcher = vi
      .fn()
      .mockResolvedValue(
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
