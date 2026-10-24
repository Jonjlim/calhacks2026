import { z } from "zod";
import type { AppErrorCode, AgentModelUsage } from "../../lib/contracts";

export class AgentFailure extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export type ModelRole = "buyer" | "extractor" | "recipient";
export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];
export interface ModelImage {
  mediaType: ImageMediaType;
  /** Raw base64, no data: prefix. */
  base64: string;
}
/** Per-image and per-request caps keep a photo read inside the action and response budgets. */
export const MAX_IMAGE_BASE64_CHARS = 3_000_000;
export const MAX_IMAGES_PER_REQUEST = 3;
export interface ModelRequest {
  role: ModelRole;
  instructions: string;
  input: unknown;
  /** Only the extractor role may send images; they are attached after the JSON input. */
  images?: ModelImage[];
}
export type ModelTransport = (request: ModelRequest) => Promise<unknown>;

export function createUsageAccumulator() {
  const summary: AgentModelUsage = {
    calls: 0,
    reportedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
  return {
    summary,
    add: (usage: AgentModelUsage) => {
      for (const key of Object.keys(summary) as Array<keyof AgentModelUsage>)
        summary[key] += usage[key];
    },
  };
}
const tokenCount = z.number().int().nonnegative().refine(Number.isSafeInteger);
const usageSchema = z.object({
  prompt_tokens: tokenCount,
  completion_tokens: tokenCount,
  prompt_tokens_details: z
    .object({ cached_tokens: tokenCount.optional() })
    .optional(),
  completion_tokens_details: z
    .object({ reasoning_tokens: tokenCount.optional() })
    .optional(),
});
export interface ModelConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  reasoningEffort?: string;
  onUsage?: (usage: AgentModelUsage) => void;
}

/** Only server configuration controls the URL; model/user content cannot select tools or hosts. */
export function createModelTransport(
  config: ModelConfig,
  fetcher: typeof fetch = fetch,
): ModelTransport {
  return async (request) => {
    if (!config.baseUrl || !config.apiKey || !config.model) {
      throw new AgentFailure("unknown", "Model provider is not configured.");
    }
    let url: URL;
    try {
      url = new URL(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`);
    } catch {
      throw new AgentFailure(
        "validation_failed",
        "Model endpoint is not a valid URL.",
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new AgentFailure(
        "validation_failed",
        "Model endpoint must use HTTPS.",
      );
    }
    const maxOutputTokens = config.maxOutputTokens ?? 2400;
    if (
      !Number.isSafeInteger(maxOutputTokens) ||
      maxOutputTokens < 256 ||
      maxOutputTokens > 8192
    )
      throw new AgentFailure(
        "validation_failed",
        "Output-token limit must be between 256 and 8192.",
      );
    if (
      config.reasoningEffort &&
      !["none", "low", "medium", "high", "xhigh"].includes(
        config.reasoningEffort,
      )
    )
      throw new AgentFailure("validation_failed", "Unknown reasoning effort.");
    const serialized = JSON.stringify(request.input) ?? "null";
    if (serialized.length + request.instructions.length > 120_000)
      throw new AgentFailure(
        "validation_failed",
        "Model input exceeded the supported context budget.",
      );
    const images = request.images ?? [];
    if (
      images.length > MAX_IMAGES_PER_REQUEST ||
      (images.length > 0 && request.role !== "extractor") ||
      images.some(
        (image) =>
          !IMAGE_MEDIA_TYPES.includes(image.mediaType) ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64) ||
          image.base64.length > MAX_IMAGE_BASE64_CHARS,
      )
    )
      throw new AgentFailure("validation_failed", "Unsupported image input.");
    const usage: AgentModelUsage = {
      calls: 1,
      reportedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetcher(url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          response_format: { type: "json_object" },
          max_completion_tokens: maxOutputTokens,
          ...(config.reasoningEffort
            ? { reasoning_effort: config.reasoningEffort }
            : {}),
          messages: [
            { role: "system", content: request.instructions },
            {
              role: "user",
              content:
                images.length === 0
                  ? serialized
                  : [
                      { type: "text", text: serialized },
                      ...images.map((image) => ({
                        type: "image_url",
                        image_url: {
                          url: `data:${image.mediaType};base64,${image.base64}`,
                          detail: "low",
                        },
                      })),
                    ],
            },
          ],
        }),
      });
      if (!response.ok)
        throw new AgentFailure(
          "unknown",
          `Model provider returned HTTP ${response.status}.`,
        );
      // Bound response reads, including providers that ignore their output budget.
      const reader = response.body?.getReader();
      if (!reader)
        throw new AgentFailure(
          "validation_failed",
          "Model returned an empty response.",
        );
      const decoder = new TextDecoder();
      let body = "";
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 128_000) {
          await reader.cancel();
          throw new AgentFailure(
            "validation_failed",
            "Model response exceeded its limit.",
          );
        }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
      const raw: unknown = JSON.parse(body);
      const metadata = z.object({ usage: usageSchema }).safeParse(raw);
      if (metadata.success) {
        usage.reportedCalls = 1;
        usage.inputTokens = metadata.data.usage.prompt_tokens;
        usage.outputTokens = metadata.data.usage.completion_tokens;
        usage.cachedInputTokens = Math.min(
          usage.inputTokens,
          metadata.data.usage.prompt_tokens_details?.cached_tokens ?? 0,
        );
        usage.reasoningTokens = Math.min(
          usage.outputTokens,
          metadata.data.usage.completion_tokens_details?.reasoning_tokens ?? 0,
        );
      }
      const envelope = z
        .object({
          choices: z
            .array(
              z.object({
                finish_reason: z.string(),
                message: z.object({
                  content: z.string().nullable(),
                  refusal: z.string().nullable().optional(),
                }),
              }),
            )
            .min(1)
            .max(1),
        })
        .parse(raw);
      const choice = envelope.choices[0]!;
      if (choice.message.refusal)
        throw new AgentFailure("refused", "Model declined the request.");
      if (choice.finish_reason !== "stop" || !choice.message.content)
        throw new AgentFailure(
          "validation_failed",
          "Model response was incomplete.",
        );
      return JSON.parse(choice.message.content) as unknown;
    } catch (error) {
      if (error instanceof AgentFailure) throw error;
      if (controller.signal.aborted)
        throw new AgentFailure("provider_timeout", "Model request timed out.");
      if (error instanceof SyntaxError || error instanceof z.ZodError)
        throw new AgentFailure(
          "validation_failed",
          "Model returned invalid JSON.",
        );
      throw new AgentFailure("unknown", "Model provider could not be reached.");
    } finally {
      clearTimeout(timeout);
      config.onUsage?.(usage);
    }
  };
}

/** Retry malformed output once. Never echo private output or provider errors into repair prompts. */
export async function validatedModelCall<T>(
  transport: ModelTransport,
  request: ModelRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await transport({
        ...request,
        instructions:
          request.instructions +
          (attempt
            ? "\nThe previous response failed validation. Return only JSON matching the supplied schema; no additional fields."
            : ""),
      });
      const result = schema.safeParse(raw);
      if (result.success) return result.data;
    } catch (error) {
      if (
        !(error instanceof AgentFailure) ||
        error.code !== "validation_failed"
      )
        throw error;
    }
  }
  throw new AgentFailure(
    "validation_failed",
    "Model output failed validation twice.",
  );
}

export function configuredModel(
  onUsage?: (usage: AgentModelUsage) => void,
): ModelTransport {
  return createModelTransport({
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
    ...(process.env.LLM_MAX_OUTPUT_TOKENS
      ? { maxOutputTokens: Number(process.env.LLM_MAX_OUTPUT_TOKENS) }
      : {}),
    ...(process.env.LLM_REASONING_EFFORT
      ? { reasoningEffort: process.env.LLM_REASONING_EFFORT }
      : {}),
    onUsage,
  });
}
